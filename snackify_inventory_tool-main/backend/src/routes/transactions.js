import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

const txnSchema = z.object({
  product_id: z.string().uuid(),
  type: z.enum(['add', 'remove', 'waste', 'adjust']),
  quantity: z.number().positive(),
  unit_cost: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

// GET /api/transactions
router.get(
  '/',
  requireRole('facility_manager', 'finance', 'leadership'),
  async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      let q = supabaseAdmin
        .from('transactions')
        .select('*, products(name, category, unit)')
        .order('occurred_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (req.query.product_id) q = q.eq('product_id', req.query.product_id);
      if (req.query.type) q = q.eq('type', req.query.type);

      const { data, error } = await q;
      if (error) throw error;
      res.json(data);
    } catch (e) {
      next(e);
    }
  }
);

// POST /api/transactions
router.post('/', requireRole('facility_manager', 'leadership'), async (req, res, next) => {
  try {
    const payload = txnSchema.parse(req.body);

    let unitCost = payload.unit_cost;
    if (unitCost === undefined) {
      const { data: product, error: pErr } = await supabaseAdmin
        .from('products')
        .select('cost_per_unit')
        .eq('id', payload.product_id)
        .single();
      if (pErr) throw pErr;
      unitCost = Number(product.cost_per_unit);
    }
    const totalCost = Number((payload.quantity * unitCost).toFixed(2));

    const { data, error } = await supabaseAdmin
      .from('transactions')
      .insert({
        ...payload,
        unit_cost: unitCost,
        total_cost: totalCost,
        facility_manager_id: req.user.id,
      })
      .select()
      .single();
    if (error) throw error;

    // Reflect in inventory.
    // add => +qty, remove/waste => -qty, adjust => set absolute.
    const { data: invRow, error: invErr } = await supabaseAdmin
      .from('inventory')
      .select('current_stock')
      .eq('product_id', payload.product_id)
      .single();
    if (invErr) throw invErr;

    let newStock;
    if (payload.type === 'adjust') {
      newStock = Math.max(0, payload.quantity);
    } else {
      const sign = payload.type === 'add' ? 1 : -1;
      const cur = Number(invRow.current_stock);
      newStock = Math.max(0, cur + sign * payload.quantity);
    }

    await supabaseAdmin
      .from('inventory')
      .update({ current_stock: newStock, last_updated_by: req.user.id })
      .eq('product_id', payload.product_id);

    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
});

export default router;
