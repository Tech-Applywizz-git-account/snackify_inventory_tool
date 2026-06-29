/**
 * forecast.js — weekly predictive ordering engine
 *
 * Algorithm:
 *   1. Pull all type='remove' transactions for each active product over 6 weeks.
 *   2. Bucket into ISO week totals (Mon–Sun, IST).
 *   3. If a product has ≥2 weeks of removal data:
 *        weighted avg = (last2wk avg * 0.6) + (prior weeks avg * 0.4)
 *        basis = 'history'
 *   4. Otherwise fall back to daily_usage * 7 (leadership-set estimate):
 *        basis = 'daily_usage_fallback'
 *   5. suggested_order = max(0, predicted_next - current_stock),
 *        capped at max_safe_order when available.
 *   6. Upserts one row per product into product_forecasts for the coming week_of.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

/** Return Monday of the week containing `date` as a "YYYY-MM-DD" string (IST). */
function getMondayIST(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  ist.setUTCDate(ist.getUTCDate() + diff);
  return ist.toISOString().slice(0, 10);
}

/** Return Monday of the *next* week (the week we are forecasting for). */
function getNextMondayIST() {
  const now = new Date();
  const thisMonday = getMondayIST(now);
  const d = new Date(`${thisMonday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/** Group remove transactions by ISO week (Mon–Sun IST) and sum quantities. */
function bucketByWeek(transactions) {
  const buckets = {};
  for (const t of transactions) {
    const monday = getMondayIST(new Date(t.occurred_at));
    buckets[monday] = (buckets[monday] || 0) + Number(t.quantity || 0);
  }
  return buckets; // { "2026-05-26": 14.5, "2026-06-02": 9.0, ... }
}

/**
 * Weighted average: recent 2 weeks get 60%, older weeks get 40%.
 * Returns null when `weeks` array is empty.
 */
function weightedAvg(weekEntries) {
  if (!weekEntries.length) return null;
  if (weekEntries.length === 1) return weekEntries[0][1];

  // Sort ascending by Monday date string so most-recent are last
  const sorted = [...weekEntries].sort((a, b) => a[0].localeCompare(b[0]));
  const recentVals = sorted.slice(-2).map(([, v]) => v);
  const olderVals = sorted.slice(0, -2).map(([, v]) => v);

  const recentAvg = recentVals.reduce((s, v) => s + v, 0) / recentVals.length;

  if (!olderVals.length) return recentAvg;
  const olderAvg = olderVals.reduce((s, v) => s + v, 0) / olderVals.length;

  return recentAvg * 0.6 + olderAvg * 0.4;
}

/**
 * Main export.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @returns {Promise<{ upserted: number, errors: string[] }>}
 */
export async function computeForecasts(supabaseAdmin) {
  const errors = [];

  // ── 1. Active products with inventory snapshot ───────────────────────────
  const { data: products, error: prodErr } = await supabaseAdmin
    .from('v_inventory_status')
    .select('product_id, product_name, unit, current_stock, daily_usage, max_safe_order');

  if (prodErr) {
    console.error('[Forecast] failed to fetch products:', prodErr.message);
    return { upserted: 0, errors: [prodErr.message] };
  }
  if (!products?.length) return { upserted: 0, errors: [] };

  // ── 2. All remove transactions over the last 6 weeks ────────────────────
  const sixWeeksAgo = new Date(Date.now() - 42 * 24 * 60 * 60 * 1000).toISOString();
  const { data: txns, error: txnErr } = await supabaseAdmin
    .from('transactions')
    .select('product_id, quantity, occurred_at')
    .eq('type', 'remove')
    .gte('occurred_at', sixWeeksAgo);

  if (txnErr) {
    console.error('[Forecast] failed to fetch transactions:', txnErr.message);
    return { upserted: 0, errors: [txnErr.message] };
  }

  // Group transactions by product
  const txnsByProduct = {};
  for (const t of txns || []) {
    if (!txnsByProduct[t.product_id]) txnsByProduct[t.product_id] = [];
    txnsByProduct[t.product_id].push(t);
  }

  // ── 3. Compute forecast per product ─────────────────────────────────────
  const weekOf = getNextMondayIST();
  const rows = [];

  for (const p of products) {
    try {
      const productTxns = txnsByProduct[p.product_id] || [];
      const buckets = bucketByWeek(productTxns);
      const weekEntries = Object.entries(buckets); // [ [monday, total], ... ]
      const weeksOfData = weekEntries.length;

      let predicted_next;
      let avg_weekly;
      let basis;

      if (weeksOfData >= 2) {
        // Sufficient history → weighted average
        const simpleAvg = weekEntries.reduce((s, [, v]) => s + v, 0) / weeksOfData;
        avg_weekly = Number(simpleAvg.toFixed(2));
        predicted_next = Number((weightedAvg(weekEntries) || simpleAvg).toFixed(2));
        basis = 'history';
      } else if (p.daily_usage != null && Number(p.daily_usage) > 0) {
        // Fall back to leadership-set daily_usage (5 working days Mon–Fri)
        const weeklyEstimate = Number(p.daily_usage) * 5;
        avg_weekly = Number(weeklyEstimate.toFixed(2));
        predicted_next = avg_weekly;
        basis = 'daily_usage_fallback';
      } else {
        // No data at all — skip this product
        continue;
      }

      const currentStock = Number(p.current_stock || 0);
      let suggested_order = Math.max(0, predicted_next - currentStock);

      // Cap by max_safe_order when available
      if (p.max_safe_order != null && Number(p.max_safe_order) > 0) {
        suggested_order = Math.min(suggested_order, Number(p.max_safe_order));
      }

      rows.push({
        product_id: p.product_id,
        week_of: weekOf,
        avg_weekly: avg_weekly,
        predicted_next: predicted_next,
        suggested_order: Number(suggested_order.toFixed(2)),
        basis,
        weeks_of_data: weeksOfData,
      });
    } catch (e) {
      console.error(`[Forecast] error for product ${p.product_id}:`, e.message);
      errors.push(`${p.product_name}: ${e.message}`);
    }
  }

  if (!rows.length) return { upserted: 0, errors };

  // ── 4. Upsert all rows ──────────────────────────────────────────────────
  const { error: upsertErr } = await supabaseAdmin
    .from('product_forecasts')
    .upsert(rows, { onConflict: 'product_id,week_of' });

  if (upsertErr) {
    console.error('[Forecast] upsert failed:', upsertErr.message);
    errors.push(upsertErr.message);
    return { upserted: 0, errors };
  }

  console.log(`[Forecast] upserted ${rows.length} forecast rows for week_of=${weekOf}`);
  return { upserted: rows.length, errors };
}

/** Returns forecasts that actually need ordering (suggested_order > 0). */
export async function getActionableForecasts(supabaseAdmin) {
  const { data, error } = await supabaseAdmin
    .from('v_latest_forecasts')
    .select('*')
    .gt('suggested_order', 0)
    .order('suggested_order', { ascending: false });

  if (error) {
    console.error('[Forecast] getActionable failed:', error.message);
    return [];
  }
  return data || [];
}
