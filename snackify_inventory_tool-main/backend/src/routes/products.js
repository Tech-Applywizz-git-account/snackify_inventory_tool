import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

const productSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['consumables', 'coffee_materials', 'washroom', 'beverages']),
  unit: z.enum(['pieces', 'packs', 'kg', 'liters', 'boxes']),
  cost_per_unit: z.number().nonnegative(),
  shelf_life_days: z.number().int().positive().nullable().optional(),
  supplier_hyperpure_id: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

// GET /api/products — list all (active by default)
router.get('/', async (req, res, next) => {
  try {
    const includeInactive = req.query.all === 'true';
    let q = supabaseAdmin.from('products').select('*').order('category').order('name');
    if (!includeInactive) q = q.eq('active', true);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(404).json({ error: error.message });
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// POST /api/products — create
router.post('/', requireRole('facility_manager', 'leadership'), async (req, res, next) => {
  try {
    const payload = productSchema.parse(req.body);
    const { data, error } = await supabaseAdmin.from('products').insert(payload).select().single();
    if (error) throw error;

    // create matching empty inventory row
    await supabaseAdmin.from('inventory').insert({
      product_id: data.id,
      current_stock: 0,
      min_threshold: 0,
    });

    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/products/:id — update
router.patch('/:id', requireRole('facility_manager', 'leadership'), async (req, res, next) => {
  try {
    const payload = productSchema.partial().parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('products')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// DELETE — soft-delete (mark inactive). Hard delete intentionally omitted.
router.delete('/:id', requireRole('facility_manager', 'leadership'), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('products')
      .update({ active: false })
      .eq('id', req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
