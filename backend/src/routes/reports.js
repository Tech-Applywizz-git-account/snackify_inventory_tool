import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';
import { sendDailyConsumptionReportEmail } from '../lib/microsoftGraph.js';

const router = Router();

function getISTDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function istDayRange(date) {
  const [year, month, day] = date.split('-').map(Number);
  return {
    from: new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 19800000).toISOString(),
    to: new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0) - 19800000).toISOString(),
  };
}

async function buildDailyConsumptionReport(reportDate) {
  const { from, to } = istDayRange(reportDate);
  const [{ data: items, error: itemsError }, { data: usage, error: usageError }] = await Promise.all([
    supabaseAdmin
      .from('cafeteria_items')
      .select('id, item_name, display_name, frontend_name')
      .order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('token_usage')
      .select('lines, created_at')
      .eq('reason', 'spend')
      .gte('created_at', from)
      .lt('created_at', to),
  ]);
  if (itemsError) throw itemsError;
  if (usageError) throw usageError;

  const { data: tokenItems, error: tokenItemsError } = await supabaseAdmin
    .from('token_items')
    .select('id, display_name, cafeteria_item_id');
  if (tokenItemsError) throw tokenItemsError;

  const tokenMap = new Map((tokenItems || []).map((item) => [item.id, item]));
  const totals = new Map((items || []).map((item) => [item.id, { item_name: item.display_name || item.frontend_name || item.item_name, quantity: 0, orders: 0 }]));
  const fallback = new Map();

  for (const usageRow of usage || []) {
    for (const line of Array.isArray(usageRow.lines) ? usageRow.lines : []) {
      const quantity = Number(line.qty) || 0;
      const tokenItem = tokenMap.get(line.token_item_id);
      const cafeteriaId = tokenItem?.cafeteria_item_id;
      const key = cafeteriaId || `name:${String(line.name || line.item_name || 'Unknown').toLowerCase()}`;
      const current = totals.get(key) || fallback.get(key) || {
        item_name: line.name || line.item_name || 'Unknown item',
        quantity: 0,
        orders: 0,
      };
      current.quantity += quantity;
      current.orders += 1;
      if (totals.has(key)) totals.set(key, current);
      else fallback.set(key, current);
    }
  }

  return [...totals.values(), ...fallback.values()].map((row) => ({
    ...row,
    quantity: Number(row.quantity),
  }));
}

// POST /api/reports/daily-consumption-email — leadership/admin only
router.post('/daily-consumption-email', requireRole('leadership', 'admin'), async (req, res, next) => {
  try {
    const reportDate = String(req.body?.date || getISTDateParts());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const rows = await buildDailyConsumptionReport(reportDate);
    const { data: subscribers, error: subscriberError } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('consumer_report', true)
      .not('email', 'is', null);
    if (subscriberError) throw subscriberError;
    const recipients = [...new Set((subscribers || []).map((subscriber) => subscriber.email).filter(Boolean))];
    await sendDailyConsumptionReportEmail(reportDate, rows, recipients);
    res.json({ ok: true, date: reportDate, items: rows.length, recipients: recipients.length });
  } catch (e) {
    next(e);
  }
});

// GET /api/reports/monthly-expenses
router.get('/monthly-expenses', requireRole('finance', 'leadership'), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('monthly_expenses')
      .select('*')
      .order('month', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// POST /api/reports/monthly-expenses
router.post('/monthly-expenses', requireRole('leadership'), async (req, res, next) => {
  try {
    const { month, label, amount, category = 'rental', notes } = req.body;
    if (!month || !label || !amount) {
      return res.status(400).json({ error: 'month, label, and amount are required' });
    }
    const { data, error } = await supabaseAdmin
      .from('monthly_expenses')
      .insert({
        month,
        label,
        amount: Number(amount),
        category,
        notes: notes || null,
        created_by: req.user.id,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/reports/monthly-expenses/:id
router.delete('/monthly-expenses/:id', requireRole('leadership'), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from('monthly_expenses').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// GET /api/reports/spending?from=YYYY-MM-DD&to=YYYY-MM-DD — finance
router.get('/spending', requireRole('finance', 'leadership'), async (req, res, next) => {
  try {
    const from = req.query.from || null;
    const to = req.query.to || null;

    let q = supabaseAdmin.from('v_monthly_spending').select('*');
    if (from) q = q.gte('month', from);
    if (to) q = q.lte('month', to);

    const { data, error } = await q.order('month', { ascending: false });
    if (error) throw error;

    const totals = {};
    let grandTotal = 0;
    for (const row of data) {
      const cat = row.category;
      totals[cat] = (totals[cat] || 0) + Number(row.total_spent);
      grandTotal += Number(row.total_spent);
    }

    res.json({
      rows: data,
      by_category: totals,
      grand_total: Number(grandTotal.toFixed(2)),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/reports/dashboard — inventory snapshot for operational roles
router.get(
  '/dashboard',
  requireRole('facility_manager', 'finance', 'leadership'),
  async (_req, res, next) => {
    try {
      const { data: statusRows, error: statusErr } = await supabaseAdmin
        .from('v_inventory_status')
        .select('*');
      if (statusErr) throw statusErr;

      const summary = {
        total_products: statusRows.length,
        in_stock: statusRows.filter((r) => r.stock_status === 'ok').length,
        low: statusRows.filter((r) => r.stock_status === 'low').length,
        out_of_stock: statusRows.filter((r) => r.stock_status === 'out_of_stock').length,
        expiring_soon: statusRows.filter((r) => r.expiry_status === 'expiring_soon').length,
        expired: statusRows.filter((r) => r.expiry_status === 'expired').length,
      };

      const byCategory = {};
      for (const r of statusRows) {
        byCategory[r.category] ??= { in_stock: 0, low: 0, out: 0 };
        if (r.stock_status === 'ok') byCategory[r.category].in_stock++;
        else if (r.stock_status === 'low') byCategory[r.category].low++;
        else byCategory[r.category].out++;
      }

      res.json({ summary, by_category: byCategory, items: statusRows });
    } catch (e) {
      next(e);
    }
  }
);

export default router;
