import { Router } from 'express';
import { chatCompletion } from '../lib/openai.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

router.use(requireRole('leadership', 'finance'));

// --- helper: ISO date for N days ago
function nDaysAgo(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

const INR = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

// Pull the data we want GPT to summarize.
async function gatherWeekData() {
  const thisStart = nDaysAgo(7);
  const prevStart = nDaysAgo(14);
  const end = today();

  // 1. Transactions last 14 days (split by week in JS)
  const { data: txns, error: txErr } = await supabaseAdmin
    .from('transactions')
    .select('product_id, type, quantity, total_cost, occurred_at, products(name, category)')
    .gte('occurred_at', prevStart)
    .order('occurred_at', { ascending: false });
  if (txErr) throw txErr;

  // 2. Current inventory + status
  const { data: inv, error: invErr } = await supabaseAdmin
    .from('v_inventory_status')
    .select(
      'product_name, category, current_stock, min_threshold, expiry_date, stock_status, expiry_status, unit'
    );
  if (invErr) throw invErr;

  // ---- aggregate
  const tally = (rows) => {
    const byCat = {};
    let total = 0;
    for (const r of rows) {
      if (r.type !== 'add') continue;
      const cost = Number(r.total_cost || 0);
      total += cost;
      const cat = r.products?.category || 'other';
      byCat[cat] = (byCat[cat] || 0) + cost;
    }
    return { total, byCat };
  };

  const thisWeek = tally(txns.filter((t) => t.occurred_at >= thisStart));
  const prevWeek = tally(txns.filter((t) => t.occurred_at < thisStart));

  // Top consumed products this week (sum of 'remove' quantity)
  const removed = {};
  for (const t of txns.filter((t) => t.occurred_at >= thisStart && t.type === 'remove')) {
    const name = t.products?.name || t.product_id;
    removed[name] = (removed[name] || 0) + Number(t.quantity);
  }
  const topConsumed = Object.entries(removed)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => ({ name, qty }));

  const low = inv.filter((r) => r.stock_status === 'low' || r.stock_status === 'out_of_stock');
  const expiring = inv.filter(
    (r) => r.expiry_status === 'expiring_soon' || r.expiry_status === 'expired'
  );

  return {
    period_start: thisStart,
    period_end: end,
    this_week: thisWeek,
    prev_week: prevWeek,
    top_consumed: topConsumed,
    low_stock: low.map((r) => ({
      name: r.product_name,
      stock: r.current_stock,
      unit: r.unit,
      status: r.stock_status,
    })),
    expiring: expiring.map((r) => ({
      name: r.product_name,
      expiry: r.expiry_date,
      status: r.expiry_status,
    })),
    txn_count: txns.filter((t) => t.occurred_at >= thisStart).length,
  };
}

function buildPrompt(d) {
  const wow =
    d.prev_week.total > 0
      ? `${(((d.this_week.total - d.prev_week.total) / d.prev_week.total) * 100).toFixed(0)}%`
      : 'n/a';

  return [
    `Weekly pantry inventory data for Applyways office (single location).`,
    ``,
    `Period: ${d.period_start} to ${d.period_end}`,
    `Total restock spend this week: ${INR(d.this_week.total)}`,
    `Total restock spend prior week: ${INR(d.prev_week.total)}  (WoW change: ${wow})`,
    ``,
    `Spend by category this week:`,
    ...Object.entries(d.this_week.byCat).map(([c, v]) => `  - ${c}: ${INR(v)}`),
    ``,
    `Top 5 most-consumed products this week:`,
    ...d.top_consumed.map((p) => `  - ${p.name}: ${p.qty} units consumed`),
    ``,
    `Items low or out of stock right now (${d.low_stock.length}):`,
    ...d.low_stock.slice(0, 12).map((r) => `  - ${r.name}: ${r.stock} ${r.unit} (${r.status})`),
    ``,
    `Items expiring soon or expired (${d.expiring.length}):`,
    ...d.expiring.slice(0, 12).map((r) => `  - ${r.name}: ${r.expiry} (${r.status})`),
    ``,
    `Transactions logged this week: ${d.txn_count}`,
  ].join('\n');
}

const SYSTEM_PROMPT = `You are an executive assistant writing a weekly pantry summary for the COO of Applyways.
Keep it tight: 4 to 6 short bullet points. Indian English, INR currency, no fluff, no headings, no emoji.
Lead with the most important number or fact. Call out anomalies (big WoW spend changes, items expiring,
items out of stock). End with 1 sharp recommendation if there's something the COO should action this week.
If data is empty or near-zero, say so plainly in one line.`;

// GET /api/reports/ai-summary  (?refresh=true to bypass cache)
router.get('/ai-summary', async (req, res, next) => {
  try {
    const refresh = req.query.refresh === 'true';

    // 1. Check cache (latest summary for current week start)
    const periodStart = nDaysAgo(7);
    const periodEnd = today();

    if (!refresh) {
      const { data: cached } = await supabaseAdmin
        .from('ai_summaries')
        .select('*')
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd)
        .maybeSingle();
      if (cached) {
        return res.json({ ...cached, from_cache: true });
      }
    }

    // 2. Gather data + ask GPT
    const data = await gatherWeekData();
    const userPrompt = buildPrompt(data);
    const { content, model, usage } = await chatCompletion({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      model: 'gpt-4o-mini',
    });

    // 3. Store
    const { data: stored, error: storeErr } = await supabaseAdmin
      .from('ai_summaries')
      .upsert(
        {
          period_start: periodStart,
          period_end: periodEnd,
          content,
          model,
          prompt_tokens: usage.prompt_tokens ?? null,
          completion_tokens: usage.completion_tokens ?? null,
          created_by: req.user.id,
        },
        { onConflict: 'period_start,period_end' }
      )
      .select()
      .single();
    if (storeErr) throw storeErr;

    res.json({ ...stored, from_cache: false });
  } catch (e) {
    next(e);
  }
});

// GET /api/reports/ai-summary/history  - last 12 weekly summaries
router.get('/ai-summary/history', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_summaries')
      .select('id, period_start, period_end, content, model, created_at')
      .order('period_start', { ascending: false })
      .limit(12);
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

export default router;
