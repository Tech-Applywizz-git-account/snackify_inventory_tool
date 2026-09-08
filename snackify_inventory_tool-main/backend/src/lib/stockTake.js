// Feature #8: Photo Stock-take (advisory only).
//
// runStockTake()  — vision-count a shelf photo, match to products, build a diff
//                   vs inventory.current_stock, and persist a 'pending' row.
// applyStockTake() — on leadership Confirm, write ONE 'adjust' transaction per
//                   changed item and set current_stock to the counted value.
//
// AI counts are NEVER auto-applied. Shelf counting is unreliable (stacking /
// occlusion), so a human confirms every time. Everything is persisted in
// stock_takes so a server restart between photo and Confirm is safe.

import { visionCompletion } from './openai.js';

const VISION_SYSTEM =
  'You are a pantry shelf auditor. Count the distinct, clearly visible product ' +
  'units on the shelf in the photo. Be conservative: if items are stacked, ' +
  'occluded, or you are unsure, do not guess. Return ONLY a JSON array of ' +
  '{ "item_name": string, "count": number }. If the photo is blurry, empty, or ' +
  'not a pantry shelf, return [].';

const VISION_USER =
  'Count each distinct pantry product visible on this shelf. ' +
  'Return ONLY the JSON array, no markdown, no commentary.';

/** Strip ```json fences the model sometimes adds. */
function cleanJson(content) {
  return content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

/**
 * Vision-count a shelf photo, match to products, build a diff, and persist
 * a pending stock-take.
 *
 * @returns {{ id: string|null, diff: Array, unmatched: string[], counts: Array }}
 */
export async function runStockTake(supabaseAdmin, { photoUrls, createdBy, createdByName }) {
  const imageUrl = photoUrls?.[0];
  if (!imageUrl) {
    return { id: null, diff: [], unmatched: [], counts: [] };
  }

  // 1. Ask the model to count visible units.
  let counts = [];
  try {
    const { content } = await visionCompletion({
      system: VISION_SYSTEM,
      user: VISION_USER,
      imageUrl,
    });
    const parsed = JSON.parse(cleanJson(content));
    if (Array.isArray(parsed)) {
      counts = parsed
        .map((c) => ({
          item_name: String(c.item_name || '').trim(),
          count: Number(c.count),
        }))
        .filter((c) => c.item_name && Number.isFinite(c.count) && c.count >= 0);
    }
  } catch (e) {
    // Bad JSON / blurry photo → treat as "nothing counted". Caller messages the user.
    console.error('[StockTake] vision parse failed:', e.message);
    counts = [];
  }

  if (counts.length === 0) {
    return { id: null, diff: [], unmatched: [], counts: [] };
  }

  // 2. Match each counted item to a product and compare with current_stock.
  const diff = [];
  const unmatched = [];

  for (const { item_name, count } of counts) {
    const { data: prod } = await supabaseAdmin
      .from('products')
      .select('id, name, unit')
      .ilike('name', `%${item_name}%`)
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    if (!prod) {
      unmatched.push(item_name);
      continue;
    }

    const { data: inv } = await supabaseAdmin
      .from('inventory')
      .select('current_stock')
      .eq('product_id', prod.id)
      .maybeSingle();

    const system = inv ? Number(inv.current_stock) || 0 : 0;
    diff.push({
      product_id: prod.id,
      name: prod.name,
      unit: prod.unit || 'units',
      system,
      counted: count,
      delta: count - system,
    });
  }

  // 3. Persist the pending stock-take (audit trail + callback key).
  const { data: saved, error } = await supabaseAdmin
    .from('stock_takes')
    .insert({
      created_by: createdBy,
      created_by_name: createdByName,
      photo_urls: photoUrls,
      ai_counts: counts,
      diff,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error || !saved) {
    console.error('[StockTake] insert failed:', error?.message);
    return { id: null, diff, unmatched, counts };
  }

  return { id: saved.id, diff, unmatched, counts };
}

/**
 * Apply a confirmed stock-take. Idempotent: the status guard means a double-tap
 * on Confirm can never double-apply.
 *
 * @returns {{ alreadyDone?: boolean, applied?: number, skipped?: number }}
 */
export async function applyStockTake(supabaseAdmin, { stockTakeId, confirmedBy }) {
  // Atomically claim the row: only a 'pending' row flips to 'confirmed'.
  const { data: claimed } = await supabaseAdmin
    .from('stock_takes')
    .update({
      status: 'confirmed',
      confirmed_by: confirmedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', stockTakeId)
    .eq('status', 'pending')
    .select('id, diff')
    .maybeSingle();

  if (!claimed) {
    // Already confirmed/discarded, or not found — nothing to do.
    return { alreadyDone: true };
  }

  const diff = Array.isArray(claimed.diff) ? claimed.diff : [];
  let applied = 0;
  let skipped = 0;

  for (const row of diff) {
    if (!row.product_id || !Number.isFinite(Number(row.delta)) || Number(row.delta) === 0) {
      skipped += 1;
      continue;
    }

    // Set stock to the counted value (the human-confirmed source of truth).
    const { error: invErr } = await supabaseAdmin
      .from('inventory')
      .update({ current_stock: row.counted, last_updated_by: confirmedBy })
      .eq('product_id', row.product_id);

    if (invErr) {
      console.error('[StockTake] inventory update failed:', invErr.message);
      skipped += 1;
      continue;
    }

    // One audit transaction per changed item.
    const { error: txErr } = await supabaseAdmin.from('transactions').insert({
      product_id: row.product_id,
      type: 'adjust',
      quantity: Number(row.delta),
      facility_manager_id: confirmedBy,
      notes: 'photo stock-take adjustment',
    });

    if (txErr) console.error('[StockTake] transaction log failed:', txErr.message);
    applied += 1;
  }

  return { applied, skipped };
}

/** Mark a stock-take discarded. Writes nothing to inventory. Idempotent. */
export async function discardStockTake(supabaseAdmin, { stockTakeId, confirmedBy }) {
  const { data: claimed } = await supabaseAdmin
    .from('stock_takes')
    .update({
      status: 'discarded',
      confirmed_by: confirmedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', stockTakeId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  return claimed ? { discarded: true } : { alreadyDone: true };
}
