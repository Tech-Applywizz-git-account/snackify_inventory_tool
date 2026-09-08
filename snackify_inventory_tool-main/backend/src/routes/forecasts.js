import { Router } from 'express';
import { computeForecasts } from '../lib/forecast.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// GET /api/forecasts
// Returns the latest predictive-order suggestion per active product.
// Source of truth is the v_latest_forecasts view (one row per product,
// most recent week_of). Sorted so the items that need ordering most appear first.
router.get('/', requireRole('facility_manager', 'leadership'), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('v_latest_forecasts')
      .select('*')
      .order('suggested_order', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    next(e);
  }
});

// POST /api/forecasts/run
// Manually recompute forecasts on demand (e.g. after a bulk stock update).
// Leadership-only. Keeps CRON_SECRET server-side — the browser never sees it.
// Idempotent: re-running the same week upserts, never duplicates.
router.post('/run', requireRole('leadership'), async (_req, res, next) => {
  try {
    const { upserted, errors } = await computeForecasts(supabaseAdmin);
    res.json({ ok: true, upserted, errors });
  } catch (e) {
    next(e);
  }
});

export default router;
