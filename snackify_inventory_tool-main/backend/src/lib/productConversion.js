import { chatCompletion } from './openai.js';
import { supabaseAdmin } from './supabase.js';

export function normalizeName(name = '') {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Fetch one approved master record whose aliases array contains the normalized name.
async function matchMaster(normalizedName) {
  const { data } = await supabaseAdmin
    .from('product_conversion_master')
    .select('*')
    .eq('active', true)
    .eq('approval_status', 'approved')
    .contains('aliases', [normalizedName])
    .limit(1);
  return data?.[0] ?? null;
}

const AI_SYSTEM = `You are a product classification assistant for an office inventory system.
Given vendor invoice items, classify each and suggest how it converts to stock.
Return ONLY valid JSON in this exact shape:
{
  "items": [
    {
      "raw_name": "<copy the item name exactly>",
      "classification": "<one of: direct_menu_stock | ingredient_or_dependency | recipe_stock | internal_supply | equipment_asset | finance_expense | unknown_pending_review>",
      "suggested_canonical_name": "<cleaned product name>",
      "suggested_purchase_unit": "<box|pack|kg|pcs|bottle|jar|etc>",
      "suggested_storage_unit": "<cup|gram|slice|liter|pcs|etc>",
      "suggested_units_per_purchase_unit": <number or null>,
      "suggested_employee_serving_unit": "<cup|slice|bottle|null>",
      "confidence": "<low|medium|high>",
      "reason": "<one sentence>"
    }
  ]
}
Rules:
- Return null for suggested_units_per_purchase_unit when you are not confident.
- Never set employee_orderable or visible_to_employees — those are set by admin approval only.`;

// Call AI once for all unmatched items. Returns map: normalizedName → suggestion.
async function batchAISuggestions(unmatchedItems) {
  if (!unmatchedItems.length) return {};
  const list = unmatchedItems
    .map((i) => `- "${i.item_name}" (qty: ${i.quantity ?? '?'} ${i.unit ?? ''})`)
    .join('\n');
  try {
    const { content } = await chatCompletion({
      system: AI_SYSTEM,
      user: `Classify these vendor invoice items:\n${list}`,
      model: 'gpt-4o-mini',
      temperature: 0.1,
      responseFormat: 'json_object',
    });
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
    const map = {};
    for (const s of arr) {
      if (s?.raw_name) map[normalizeName(s.raw_name)] = s;
    }
    return map;
  } catch {
    // AI failure is non-fatal — items remain pending_review
    return {};
  }
}

/**
 * Process raw invoice items against the master + AI fallback.
 *
 * Returns array parallel to rawItems, each with:
 *   { conversion_master_id, normalized_item_name, converted_quantity,
 *     conversion_status, ai_suggestion, conversion_error }
 */
export async function processInvoiceItems(rawItems) {
  if (!rawItems?.length) return [];

  const results = new Array(rawItems.length).fill(null);
  const unmatchedIndices = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    const normalized = normalizeName(item.item_name);
    const master = await matchMaster(normalized);

    if (master) {
      const qty = parseFloat(item.quantity) || 0;
      const converted =
        master.units_per_purchase_unit != null ? qty * master.units_per_purchase_unit : null;

      // No-stock classifications skip cafeteria update
      const noStock = ['internal_supply', 'equipment_asset', 'finance_expense'].includes(
        master.classification
      );

      results[i] = {
        conversion_master_id: master.id,
        normalized_item_name: normalized,
        converted_quantity: converted,
        conversion_status: noStock ? 'no_stock' : 'master_match',
        ai_suggestion: null,
        conversion_error: null,
      };
    } else {
      unmatchedIndices.push(i);
      results[i] = {
        conversion_master_id: null,
        normalized_item_name: normalized,
        converted_quantity: null,
        conversion_status: 'pending_review',
        ai_suggestion: null,
        conversion_error: null,
      };
    }
  }

  // Batch AI for all unmatched in one call
  if (unmatchedIndices.length) {
    const unmatchedItems = unmatchedIndices.map((i) => rawItems[i]);
    const suggestionMap = await batchAISuggestions(unmatchedItems);

    for (const i of unmatchedIndices) {
      const normalized = results[i].normalized_item_name;
      const aiRaw = suggestionMap[normalized] ?? null;
      if (aiRaw) {
        // ponytail: safety overrides — AI cannot auto-approve or make items visible
        results[i].ai_suggestion = {
          ...aiRaw,
          employee_orderable: false,
          visible_to_employees: false,
          status: 'pending_review',
        };
        results[i].conversion_status = 'ai_suggestion';
      }
      // else stays pending_review with null ai_suggestion
    }
  }

  return results;
}

/**
 * Save conversion results back to bill_items rows.
 * itemRows: array of { id } from bill_items insert.
 * conversions: parallel array from processInvoiceItems.
 */
export async function saveConversions(itemRows, conversions) {
  const updates = itemRows
    .map((row, i) => {
      const c = conversions[i];
      if (!c) return null;
      return supabaseAdmin
        .from('bill_items')
        .update({
          conversion_master_id: c.conversion_master_id,
          normalized_item_name: c.normalized_item_name,
          converted_quantity: c.converted_quantity,
          conversion_status: c.conversion_status,
          ai_suggestion: c.ai_suggestion,
          conversion_error: c.conversion_error,
          processed_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    })
    .filter(Boolean);

  // Fire all updates in parallel — non-fatal if any fail
  await Promise.allSettled(updates);
}
