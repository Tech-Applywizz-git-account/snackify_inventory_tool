import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

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
