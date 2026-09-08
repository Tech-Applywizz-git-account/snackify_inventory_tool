import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { postLeaveAlertToTeams } from '../lib/teams.js';
import { requireRole } from '../middleware/auth.js';
import { attachTokenPrice, loadCatalog } from '../lib/tokens.js';

const router = Router();

// GET /api/cafeteria/items — all authenticated users
// Returns only employee-safe items (visible_to_employees = true or null for legacy rows).
// Finance, equipment, and internal-supply records are excluded.
router.get('/items', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('cafeteria_items')
      .select('*')
      .eq('available', true)
      .neq('visible_to_employees', false)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    const catalog = await loadCatalog().catch(() => []);
    res.json((data || []).map((row) => attachTokenPrice(row, catalog)));
  } catch (e) {
    next(e);
  }
});

// POST /api/cafeteria/items — leadership only
router.post('/items', requireRole('leadership', 'admin', 'office_boy'), async (req, res, next) => {
  try {
    const {
      item_name,
      display_name,
      category = 'food',
      emoji = '🍽️',
      description = '',
      tags = [],
      coin_price,
      stock_quantity = 0,
      frontend_name,
      sandwich_type = 'regular',
    } = req.body;
    const itemName = String(item_name || '').trim();
    const frontName = String(frontend_name || display_name || itemName).trim();
    const coinPrice = Number(coin_price);
    const stockQuantity = Number(stock_quantity);

    if (!itemName || !frontName || !category) {
      return res.status(400).json({ error: 'item_name, frontend_name, and category are required' });
    }
    if (!Number.isInteger(coinPrice) || coinPrice < 0) {
      return res.status(400).json({ error: 'coin_price must be a non-negative integer' });
    }
    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
      return res.status(400).json({ error: 'stock_quantity must be a non-negative integer' });
    }

    const skuCode = `CAF_${itemName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
    const { data, error } = await supabaseAdmin
      .from('cafeteria_items')
      .insert({
        item_name: itemName,
        display_name: String(display_name || frontName).trim(),
        frontend_name: frontName,
        category,
        emoji,
        description,
        tags,
        available: true,
        orderable: true,
        stock_today: stockQuantity,
        stock_servings: stockQuantity,
        sandwich_type,
        visible_to_employees: true,
      })
      .select()
      .single();
    if (error) throw error;

    const { error: tokenError } = await supabaseAdmin.from('token_items').upsert(
      {
        sku_code: skuCode,
        display_name: frontName,
        kind: category === 'meal' ? 'meal' : 'snack',
        tokens: coinPrice,
        aliases: [itemName, frontName],
        cafeteria_item_id: data.id,
        active: true,
      },
      { onConflict: 'sku_code' }
    );
    if (tokenError) throw tokenError;

    const catalog = await loadCatalog().catch(() => []);
    res.status(201).json(attachTokenPrice(data, catalog));
  } catch (e) {
    next(e);
  }
});

// PATCH /api/cafeteria/items/:id
// stock_today + stock_note: office_boy / facility_manager / leadership
// all other fields: leadership only
router.patch(
  '/items/:id',
  requireRole('office_boy', 'facility_manager', 'leadership'),
  async (req, res, next) => {
    try {
      const isLeadership = ['leadership'].includes(req.user.role);
      // Non-leadership can only update stock fields
      const stockOnly = ['stock_today', 'stock_note', 'stock_servings'];
      const fullAllowed = [
        'item_name',
        'display_name',
        'category',
        'emoji',
        'description',
        'available',
        'orderable',
        'tags',
        'sort_order',
        'stock_today',
        'stock_note',
        'stock_servings',
        'servings_per_unit',
        'unit_label',
        'pack_weight',
        'supplier',
        'sides_option',
        'dependencies',
      ];
      const allowed = isLeadership ? fullAllowed : stockOnly;
      const update = Object.fromEntries(
        Object.entries(req.body).filter(([k]) => allowed.includes(k))
      );
      const { data, error } = await supabaseAdmin
        .from('cafeteria_items')
        .update(update)
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e) {
      next(e);
    }
  }
);

// ── GET /api/cafeteria/self-pickup-status ─────────────────────────────────────
// Returns whether OB is on leave right now (determines self-pickup mode)
router.get('/self-pickup-status', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('v_today_leave')
      .select('id, ob_user_id, ob_name, leave_type, half_day_slot, leave_date')
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    if (data) {
      res.json({
        is_self_pickup_day: true,
        ob_name: data.ob_name,
        leave_type: data.leave_type,
        half_day_slot: data.half_day_slot || null,
        message:
          data.leave_type === 'full_day'
            ? `${data.ob_name} is on leave today — Self pickup only`
            : `${data.ob_name} is on leave this ${data.half_day_slot} — Self pickup only`,
      });
    } else {
      res.json({ is_self_pickup_day: false });
    }
  } catch (e) {
    next(e);
  }
});

// ── POST /api/cafeteria/ob-leave — OB applies leave (self-approval) ──────────
router.post('/ob-leave', requireRole('office_boy', 'facility_manager'), async (req, res, next) => {
  try {
    const { leave_date, leave_type, half_day_slot, reason } = req.body;
    if (!leave_date || !leave_type) {
      return res.status(400).json({ error: 'leave_date and leave_type are required' });
    }
    if (leave_type === 'half_day' && !half_day_slot) {
      return res
        .status(400)
        .json({ error: 'half_day_slot (morning/afternoon) required for half day leave' });
    }

    const { data, error } = await supabaseAdmin
      .from('ob_leave')
      .insert({
        ob_user_id: req.user.id,
        leave_date,
        leave_type,
        half_day_slot: leave_type === 'half_day' ? half_day_slot : null,
        reason: reason || null,
      })
      .select()
      .single();
    if (error) throw error;

    // Notify leadership via Teams
    const obName = req.user.preferred_name || req.user.full_name || 'Office Boy';
    postLeaveAlertToTeams({
      ob_name: obName,
      leave_date: leave_date,
      leave_type: leave_type,
      half_day_slot: half_day_slot || null,
      reason: reason || null,
    }).catch(() => {});

    // Push to all employees if it's today
    const today = new Date().toISOString().slice(0, 10);
    if (leave_date === today) {
      const { sendPushToUsers } = await import('./push.js');
      const { data: empRows } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('role', 'employee');
      if (empRows?.length) {
        const slotTxt = leave_type === 'full_day' ? 'today' : `this ${half_day_slot}`;
        sendPushToUsers(
          empRows.map((u) => u.id),
          {
            title: '🏃 Self-Pickup Mode Active',
            body: `${obName} is on leave ${slotTxt}. Come collect your orders from the pantry.`,
            url: '/',
            tag: 'self-pickup-day',
          }
        ).catch(() => {});
      }
    }

    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
});

// ── GET /api/cafeteria/ob-leave — OB views their own leave records ────────────
router.get(
  '/ob-leave',
  requireRole('office_boy', 'facility_manager', 'leadership'),
  async (req, res, next) => {
    try {
      const isLeadership = req.user.role === 'leadership';
      let q = supabaseAdmin
        .from('ob_leave')
        .select('*, profiles(full_name)')
        .order('leave_date', { ascending: false })
        .limit(30);
      if (!isLeadership) q = q.eq('ob_user_id', req.user.id);
      const { data, error } = await q;
      if (error) throw error;
      res.json(data || []);
    } catch (e) {
      next(e);
    }
  }
);

// ── DELETE /api/cafeteria/ob-leave/:id — OB cancels own leave ────────────────
router.delete(
  '/ob-leave/:id',
  requireRole('office_boy', 'facility_manager'),
  async (req, res, next) => {
    try {
      const { error } = await supabaseAdmin
        .from('ob_leave')
        .delete()
        .eq('id', req.params.id)
        .eq('ob_user_id', req.user.id); // Can only delete own leave
      if (error) throw error;
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  }
);

export default router;
