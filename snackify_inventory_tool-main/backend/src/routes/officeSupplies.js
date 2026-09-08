import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

const officeSupplySchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  unit: z.enum(['pieces', 'packs', 'kg', 'liters', 'boxes']),
  cost_per_unit: z.number().nonnegative().optional(),
  current_stock: z.number().nonnegative().optional(),
});

// GET /api/office-supplies
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('office_supplies')
      .select('*')
      .eq('active', true)
      .order('category')
      .order('name');
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// POST /api/office-supplies
router.post('/', requireRole('facility_manager', 'leadership'), async (req, res, next) => {
  try {
    const payload = officeSupplySchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('office_supplies')
      .insert({
        name: payload.name,
        category: payload.category,
        unit: payload.unit,
        cost_per_unit: payload.cost_per_unit || 0,
        current_stock: payload.current_stock || 0,
        min_threshold: 0,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/office-supplies/:id
router.patch('/:id', requireRole('facility_manager', 'leadership'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.category !== undefined) updates.category = req.body.category;
    if (req.body.unit !== undefined) updates.unit = req.body.unit;
    if (req.body.cost_per_unit !== undefined) updates.cost_per_unit = Number(req.body.cost_per_unit);
    if (req.body.current_stock !== undefined) updates.current_stock = Number(req.body.current_stock);

    const { data, error } = await supabaseAdmin
      .from('office_supplies')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/office-supplies/:id
router.delete('/:id', requireRole('facility_manager', 'leadership'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('office_supplies')
      .delete()
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;
