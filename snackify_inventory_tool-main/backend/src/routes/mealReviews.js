import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

const TIMEZONE = 'Asia/Kolkata';
// Defaults: 1:00 PM – 3:00 PM IST weekdays (override with env for ops/testing)
const WINDOW_START_HOUR = Number(process.env.MEAL_REVIEW_START_HOUR ?? 13);
const WINDOW_END_HOUR = Number(process.env.MEAL_REVIEW_END_HOUR ?? 15);
const REOPEN_AFTER_SECONDS = Number(process.env.MEAL_REVIEW_REOPEN_SECONDS ?? 120);
// Set MEAL_REVIEW_FORCE_OPEN=true on the API host to always show popup (testing only)
const FORCE_OPEN = String(process.env.MEAL_REVIEW_FORCE_OPEN || '').toLowerCase() === 'true';

export const MEAL_TYPES = [
  { value: 'veg', label: 'Veg' },
  { value: 'non_veg', label: 'Non-veg' },
];

export const VIBES = [
  { key: 'excellent', label: 'Excellent' },
  { key: 'good', label: 'Good' },
  { key: 'poor', label: 'Poor' },
  { key: 'very_bad', label: 'Very bad' },
];

const VIBE_KEYS = new Set(VIBES.map((v) => v.key));
const MEAL_TYPE_VALUES = new Set(MEAL_TYPES.map((t) => t.value));

function vibeLabel(key) {
  return VIBES.find((v) => v.key === key)?.label || key;
}

function getISTParts(dateObj = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(dateObj);
  const m = {};
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value;
  }
  return {
    year: parseInt(m.year, 10),
    month: parseInt(m.month, 10) - 1,
    day: parseInt(m.day, 10),
    hour: parseInt(m.hour, 10) % 24,
    minute: parseInt(m.minute, 10),
    second: parseInt(m.second, 10),
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getISTDateString(dateObj = new Date()) {
  const p = getISTParts(dateObj);
  return `${p.year}-${pad2(p.month + 1)}-${pad2(p.day)}`;
}

function isWorkingDayIST(dateObj = new Date()) {
  const p = getISTParts(dateObj);
  // Use noon UTC of that calendar day to avoid DST edge cases (IST has none)
  const dow = new Date(Date.UTC(p.year, p.month, p.day, 12)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/** Build an absolute Instant for an IST wall-clock time on a given IST date. */
function istWallTimeToUtcIso(year, month0, day, hour, minute = 0, second = 0) {
  // IST = UTC+5:30 → UTC = IST - 5:30
  const utcMs = Date.UTC(year, month0, day, hour, minute, second) - (5 * 60 + 30) * 60 * 1000;
  return new Date(utcMs).toISOString();
}

function getWindowMeta(now = new Date()) {
  const p = getISTParts(now);
  const mealDate = `${p.year}-${pad2(p.month + 1)}-${pad2(p.day)}`;
  const workingDay = isWorkingDayIST(now);
  const fractionalHour = p.hour + p.minute / 60 + p.second / 3600;
  const inClockWindow =
    workingDay && fractionalHour >= WINDOW_START_HOUR && fractionalHour < WINDOW_END_HOUR;
  const inWindow = FORCE_OPEN || inClockWindow;

  let skip_reason = null;
  if (!inWindow) {
    if (!workingDay) skip_reason = 'weekend';
    else if (fractionalHour < WINDOW_START_HOUR) skip_reason = 'before_window';
    else skip_reason = 'after_window';
  }

  return {
    meal_date: mealDate,
    timezone: TIMEZONE,
    in_window: inWindow,
    force_open: FORCE_OPEN,
    skip_reason,
    ist_now: `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`,
    window_starts_at: istWallTimeToUtcIso(p.year, p.month, p.day, Math.floor(WINDOW_START_HOUR)),
    window_ends_at: istWallTimeToUtcIso(p.year, p.month, p.day, Math.floor(WINDOW_END_HOUR)),
    reopen_after_seconds: REOPEN_AFTER_SECONDS,
  };
}

function catalogPayload() {
  return {
    meal_types: MEAL_TYPES,
    rating_scale: { min: 1, max: 5 },
    vibes: VIBES,
  };
}

async function findReview(userId, mealDate) {
  const { data, error } = await supabaseAdmin
    .from('meal_reviews')
    .select('*')
    .eq('user_id', userId)
    .eq('meal_date', mealDate)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function shapeMyReview(row) {
  if (!row) return null;
  return {
    id: row.id,
    meal_date: row.meal_date,
    meal_type: row.meal_type,
    rating: row.rating,
    vibe: row.vibe,
    vibe_label: vibeLabel(row.vibe),
    comment: row.comment,
    created_at: row.created_at,
  };
}

// ── GET /api/meal-reviews/status ─────────────────────────────────────────────
router.get('/status', async (req, res, next) => {
  try {
    const window = getWindowMeta();
    const existing = await findReview(req.user.id, window.meal_date);
    const alreadyReviewed = Boolean(existing);

    res.json({
      ...window,
      already_reviewed: alreadyReviewed,
      show_popup: window.in_window && !alreadyReviewed,
      ...catalogPayload(),
      my_review: shapeMyReview(existing),
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/meal-reviews/me ─────────────────────────────────────────────────
router.get('/me', async (req, res, next) => {
  try {
    const date = (req.query.date || getISTDateString()).toString();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const existing = await findReview(req.user.id, date);
    res.json({ meal_date: date, review: shapeMyReview(existing) });
  } catch (e) {
    next(e);
  }
});

// ── POST /api/meal-reviews ───────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const schema = z.object({
      meal_type: z.string(),
      rating: z.number().int().min(1).max(5),
      vibe: z.string(),
      comment: z.string().optional().nullable(),
    });
    const body = schema.parse(req.body);

    if (!MEAL_TYPE_VALUES.has(body.meal_type)) {
      return res.status(400).json({ error: 'meal_type must be veg or non_veg' });
    }
    if (!VIBE_KEYS.has(body.vibe)) {
      return res.status(400).json({
        error: 'Invalid vibe',
        allowed: VIBES.map((v) => v.key),
      });
    }

    const window = getWindowMeta();
    if (!window.in_window) {
      return res.status(400).json({
        error: `Meal review is only open weekdays ${WINDOW_START_HOUR}:00–${WINDOW_END_HOUR}:00 IST`,
        ...window,
      });
    }

    const existing = await findReview(req.user.id, window.meal_date);
    if (existing) {
      return res.status(409).json({
        error: 'Already reviewed for this date',
        already_reviewed: true,
        review: shapeMyReview(existing),
      });
    }

    const comment =
      body.comment === undefined || body.comment === null
        ? null
        : String(body.comment);

    const { data, error } = await supabaseAdmin
      .from('meal_reviews')
      .insert({
        user_id: req.user.id,
        meal_date: window.meal_date,
        meal_type: body.meal_type,
        rating: body.rating,
        vibe: body.vibe,
        comment,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const again = await findReview(req.user.id, window.meal_date);
        return res.status(409).json({
          error: 'Already reviewed for this date',
          already_reviewed: true,
          review: shapeMyReview(again),
        });
      }
      throw error;
    }

    res.status(201).json({ ok: true, review: shapeMyReview(data) });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: e.errors });
    }
    next(e);
  }
});

// ── GET /api/meal-reviews  (admin list) ──────────────────────────────────────
router.get('/', requireRole('leadership', 'finance'), async (req, res, next) => {
  try {
    const mealDate = (req.query.date || getISTDateString()).toString();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mealDate)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);

    const { data: reviews, error } = await supabaseAdmin
      .from('meal_reviews')
      .select('id, user_id, meal_date, meal_type, rating, vibe, comment, created_at')
      .eq('meal_date', mealDate)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const userIds = [...new Set((reviews || []).map((r) => r.user_id))];
    let profileMap = new Map();
    let emailMap = new Map();

    if (userIds.length) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, preferred_name, email')
        .in('id', userIds);
      profileMap = new Map((profiles || []).map((p) => [p.id, p]));

      try {
        const { data: usersList } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 500,
        });
        for (const u of usersList?.users || []) {
          if (userIds.includes(u.id)) emailMap.set(u.id, u.email || null);
        }
      } catch {
        // email enrichment is best-effort
      }
    }

    const shaped = (reviews || []).map((r) => {
      const p = profileMap.get(r.user_id);
      return {
        id: r.id,
        user_id: r.user_id,
        full_name: p?.full_name || null,
        preferred_name: p?.preferred_name || null,
        email: p?.email || emailMap.get(r.user_id) || null,
        meal_type: r.meal_type,
        rating: r.rating,
        vibe: r.vibe,
        vibe_label: vibeLabel(r.vibe),
        comment: r.comment,
        created_at: r.created_at,
      };
    });

    res.json({
      meal_date: mealDate,
      count: shaped.length,
      reviews: shaped,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
