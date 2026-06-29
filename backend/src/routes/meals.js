import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// ── Day-of-week meal options ──────────────────────────────────────────────────
// 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
const DAY_OPTIONS = {
  1: ['veg'], // Monday: Veg only
  2: ['veg', 'egg'], // Tuesday: Veg / Egg
  3: ['veg', 'non_veg'], // Wednesday: Veg / Non-Veg
  4: ['veg', 'egg'], // Thursday: Veg / Egg
  5: ['veg', 'non_veg'], // Friday: Veg / Non-Veg
};

function getISTParts(dateObj = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
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
      m[p.type] = p.value;
    }
    return {
      year: parseInt(m.year, 10),
      month: parseInt(m.month, 10) - 1, // 0-indexed
      day: parseInt(m.day, 10),
      hour: parseInt(m.hour, 10),
      minute: parseInt(m.minute, 10),
      second: parseInt(m.second, 10),
    };
  } catch (e) {
    console.error('Error formatting IST parts, falling back to local system:', e);
    return {
      year: dateObj.getFullYear(),
      month: dateObj.getMonth(),
      day: dateObj.getDate(),
      hour: dateObj.getHours(),
      minute: dateObj.getMinutes(),
      second: dateObj.getSeconds(),
    };
  }
}

function getMealDateDay(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCDay(); // 0=Sun ... 6=Sat
}

function isWorkingDay(dateStr) {
  const day = getMealDateDay(dateStr);
  return day >= 1 && day <= 5;
}

function getOptionsForDate(dateStr) {
  const day = getMealDateDay(dateStr);
  return DAY_OPTIONS[day] || [];
}

async function findMealBooking(userId, mealDate, columns = '*') {
  const { data, error } = await supabaseAdmin
    .from('meal_bookings')
    .select(columns)
    .eq('user_id', userId)
    .eq('meal_date', mealDate)
    .order('booked_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

// Get the next working day (Mon-Fri) from today in IST
function getNextWorkingDay(nowDate = new Date()) {
  const p = getISTParts(nowDate);
  const d = new Date(Date.UTC(p.year, p.month, p.day));
  d.setUTCDate(d.getUTCDate() + 1); // start from tomorrow
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1); // skip weekends
  }
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Determine what actions are allowed right now for a given meal_date
function getAllowedActions(mealDate, shift = 'morning', mockDate) {
  const parts = getISTParts(mockDate || new Date());
  const currentHour = parts.hour + parts.minute / 60;
  const _todayStr = `${parts.year}-${String(parts.month + 1).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;

  const [tYear, tMonth, tDay] = mealDate.split('-').map(Number);
  if (!tYear || !tMonth || !tDay) {
    return { canBook: false, canSkip: false, reason: 'error' };
  }

  const targetDateUTC = Date.UTC(tYear, tMonth - 1, tDay);
  const todayDateUTC = Date.UTC(parts.year, parts.month, parts.day);
  const diffDays = Math.round((targetDateUTC - todayDateUTC) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { canBook: false, canSkip: false, reason: 'past' };
  }

  if (shift === 'morning') {
    const nextWD = getNextWorkingDay(mockDate || new Date());
    if (mealDate !== nextWD) {
      return {
        canBook: false,
        canSkip: false,
        reason: mealDate < nextWD ? 'past' : 'future_locked',
      };
    }

    const targetDateObj = new Date(Date.UTC(tYear, tMonth - 1, tDay));
    const dow = targetDateObj.getUTCDay();
    const todayDay = new Date(Date.UTC(parts.year, parts.month, parts.day)).getUTCDay();

    // Weekend logic for Monday's meal: opens Friday at 9 AM, closes Sunday at 8 PM.
    if (dow === 1 && (todayDay === 5 || todayDay === 6 || todayDay === 0)) {
      if (todayDay === 5 && currentHour < 9) {
        return { canBook: false, canSkip: false, reason: 'not_open_yet' };
      }
      if (todayDay === 0) {
        if (currentHour >= 20) return { canBook: false, canSkip: false, reason: 'locked' };
        if (currentHour >= 18) return { canBook: false, canSkip: true, reason: 'skip_only' };
      }
      return { canBook: true, canSkip: true, reason: 'open' };
    }

    if (currentHour < 9) {
      return { canBook: false, canSkip: false, reason: 'not_open_yet' };
    }
    if (currentHour >= 20) {
      return { canBook: false, canSkip: false, reason: 'locked' };
    }
    if (currentHour >= 18) {
      return { canBook: false, canSkip: true, reason: 'skip_only' };
    }
    return { canBook: true, canSkip: true, reason: 'open' };
  } else {
    // Night Shift (Dinner) - books for same day's dinner
    if (diffDays === 1) {
      if (currentHour >= 20) {
        return { canBook: true, canSkip: true, reason: 'open' };
      }
      return { canBook: false, canSkip: false, reason: 'not_open_yet' };
    }

    if (diffDays === 0) {
      if (currentHour >= 17) {
        return { canBook: false, canSkip: false, reason: 'locked' };
      }
      if (currentHour >= 14) {
        return { canBook: false, canSkip: true, reason: 'skip_only' };
      }
      return { canBook: true, canSkip: true, reason: 'open' };
    }

    return { canBook: false, canSkip: false, reason: 'future_locked' };
  }
}

// ── GET /api/meals/options?date=2026-05-21 ────────────────────────────────────
// Returns what options are available for a date + current booking + cutoff status
router.get('/options', async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date query param required' });

    if (!isWorkingDay(date)) {
      return res.json({ working_day: false, options: [], booking: null });
    }

    const { data: prefs } = await supabaseAdmin
      .from('employee_cafeteria_preferences')
      .select('shift')
      .eq('user_id', req.user.id)
      .maybeSingle();
    const userShift = prefs?.shift || 'morning';

    const options = getOptionsForDate(date);
    const actions = getAllowedActions(date, userShift);

    // Get user's current booking
    const booking = await findMealBooking(req.user.id, date);

    res.json({
      working_day: true,
      meal_date: date,
      options, // ['veg'] or ['veg','egg'] or ['veg','non_veg']
      ...actions, // canBook, canSkip, reason
      booking: booking || null,
    });
  } catch (e) {
    next(e);
  }
});

// ── POST /api/meals/book ──────────────────────────────────────────────────────
// Body: { date: "2026-05-21", choice: "veg" | "non_veg" | "egg" | "skip" }
router.post('/book', async (req, res, next) => {
  try {
    const { date, choice } = req.body;
    if (!date || !choice) return res.status(400).json({ error: 'date and choice required' });

    // Validate working day
    if (!isWorkingDay(date)) {
      return res.status(400).json({ error: 'Not a working day' });
    }

    // Check date range
    const settings = await getSettings();
    if (date < settings.active_from || date > settings.active_until) {
      return res.status(400).json({ error: 'Meal booking not available for this date' });
    }

    const { data: prefs } = await supabaseAdmin
      .from('employee_cafeteria_preferences')
      .select('shift')
      .eq('user_id', req.user.id)
      .maybeSingle();
    const userShift = prefs?.shift || 'morning';

    const actions = getAllowedActions(date, userShift);

    if (choice === 'skip') {
      // Skip allowed if canSkip
      if (!actions.canSkip) {
        return res.status(400).json({ error: 'Booking is fully locked. Cannot skip anymore.' });
      }
    } else {
      // Booking (veg/non_veg/egg) allowed only if canBook
      if (!actions.canBook) {
        if (actions.canSkip) {
          return res
            .status(400)
            .json({ error: 'After 6 PM you can only skip. Cannot change meal type.' });
        }
        return res.status(400).json({ error: 'Booking is locked after 8 PM.' });
      }

      // Validate choice is valid for this day
      const validOptions = getOptionsForDate(date);
      if (!validOptions.includes(choice)) {
        return res.status(400).json({
          error: `${choice} is not available on this day. Options: ${validOptions.join(', ')}`,
        });
      }
    }

    const bookedAt = new Date().toISOString();
    const existing = await findMealBooking(req.user.id, date, 'id');
    let data;

    if (existing?.id) {
      const { data: updated, error } = await supabaseAdmin
        .from('meal_bookings')
        .update({ choice, booked_at: bookedAt })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      data = updated;
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from('meal_bookings')
        .insert({
          user_id: req.user.id,
          meal_date: date,
          choice,
          booked_at: bookedAt,
        })
        .select()
        .single();

      if (error) {
        if (error.code !== '23505') throw error;

        const retryExisting = await findMealBooking(req.user.id, date, 'id');
        if (!retryExisting?.id) throw error;

        const { data: retryUpdated, error: retryErr } = await supabaseAdmin
          .from('meal_bookings')
          .update({ choice, booked_at: bookedAt })
          .eq('id', retryExisting.id)
          .select()
          .single();
        if (retryErr) throw retryErr;
        data = retryUpdated;
      } else {
        data = inserted;
      }
    }

    const emoji = { veg: '🥬', non_veg: '🍗', egg: '🥚', skip: '🚫' };
    res.json({
      ok: true,
      booking: data,
      message:
        choice === 'skip'
          ? '🚫 Meal skipped for this day'
          : `${emoji[choice] || '🍱'} Booked ${choice} successfully!`,
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/meals/my-bookings?month=2026-05 ─────────────────────────────────
// Returns all bookings for the user in a month (for calendar view)
router.get('/my-bookings', async (req, res, next) => {
  try {
    const { month } = req.query; // "2026-05"
    if (!month) return res.status(400).json({ error: 'month query param required (YYYY-MM)' });

    const startDate = `${month}-01`;
    // Get last day of month
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

    const { data, error } = await supabaseAdmin
      .from('meal_bookings')
      .select('*')
      .eq('user_id', req.user.id)
      .gte('meal_date', startDate)
      .lte('meal_date', endDate)
      .order('meal_date');

    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    next(e);
  }
});

// ── GET /api/meals/summary?date=2026-05-21 ───────────────────────────────────
// FM + Finance: headcount summary for a date
router.get(
  '/summary',
  requireRole('facility_manager', 'finance', 'leadership'),
  async (req, res, next) => {
    try {
      const { date } = req.query;
      if (!date) return res.status(400).json({ error: 'date query param required' });

      const { data: bookings, error } = await supabaseAdmin
        .from('meal_bookings')
        .select('choice, user_id, profiles!inner(full_name, preferred_name)')
        .eq('meal_date', date);

      if (error) throw error;

      const settings = await getSettings();

      const summary = {
        date,
        veg: [],
        non_veg: [],
        egg: [],
        skip: [],
      };

      for (const b of bookings || []) {
        const name = b.profiles?.preferred_name || b.profiles?.full_name || 'Unknown';
        if (summary[b.choice]) {
          summary[b.choice].push(name);
        }
      }

      // Get total employee count for "not booked"
      const { count: totalEmployees } = await supabaseAdmin
        .from('profiles')
        .select('id', { count: 'exact', head: true });

      const bookedCount = (bookings || []).length;

      res.json({
        ...summary,
        veg_count: summary.veg.length,
        non_veg_count: summary.non_veg.length,
        egg_count: summary.egg.length,
        skip_count: summary.skip.length,
        not_booked: (totalEmployees || 0) - bookedCount,
        total_meals: summary.veg.length + summary.non_veg.length + summary.egg.length,
        cost: {
          veg: summary.veg.length * (settings.cost_per_veg || 80),
          non_veg: summary.non_veg.length * (settings.cost_per_non_veg || 120),
          egg: summary.egg.length * (settings.cost_per_egg || 100),
          total:
            summary.veg.length * (settings.cost_per_veg || 80) +
            summary.non_veg.length * (settings.cost_per_non_veg || 120) +
            summary.egg.length * (settings.cost_per_egg || 100),
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

// ── GET /api/meals/settings ───────────────────────────────────────────────────
router.get('/settings', async (_req, res, next) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (e) {
    next(e);
  }
});

async function getSettings() {
  const { data } = await supabaseAdmin.from('meal_settings').select('*').limit(1).single();
  return (
    data || {
      cutoff_time: '18:00',
      skip_cutoff_time: '20:00',
      cost_per_veg: 80,
      cost_per_non_veg: 120,
      cost_per_egg: 100,
      active_from: '2026-05-20',
      active_until: '2026-12-31',
    }
  );
}

// ── POST /api/meals/:date/rate ───────────────────────────────────────────────
// Rate a meal for a specific date (only today or yesterday allowed)
router.post('/:date/rate', async (req, res, next) => {
  try {
    const { date } = req.params;
    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 10) {
      return res.status(400).json({ error: 'Rating must be between 1 and 10' });
    }

    // Only allow rating for today or yesterday (IST)
    const parts = getISTParts();
    const todayDateUTC = Date.UTC(parts.year, parts.month, parts.day);

    const [mYear, mMonth, mDay] = date.split('-').map(Number);
    if (!mYear || !mMonth || !mDay) {
      return res.status(400).json({ error: 'Invalid meal date format' });
    }
    const mealDateUTC = Date.UTC(mYear, mMonth - 1, mDay);

    const diffDays = Math.round((mealDateUTC - todayDateUTC) / (1000 * 60 * 60 * 24));

    if (diffDays < -1) {
      return res.status(400).json({ error: 'Can only rate meals from today or yesterday' });
    }
    if (diffDays > 0) {
      return res.status(400).json({ error: 'Cannot rate a future meal' });
    }

    // Check booking exists and is not a skip
    const booking = await findMealBooking(req.user.id, date);

    if (!booking) {
      return res.status(404).json({ error: 'No meal booking found for this date' });
    }
    if (booking.choice === 'skip') {
      return res.status(400).json({ error: 'Cannot rate a skipped meal' });
    }

    const { data, error } = await supabaseAdmin
      .from('meal_bookings')
      .update({ rating: parseInt(rating, 10), feedback: feedback || null })
      .eq('user_id', req.user.id)
      .eq('meal_date', date)
      .select()
      .single();

    if (error) throw error;
    res.json({ ok: true, booking: data });
  } catch (e) {
    next(e);
  }
});

export default router;
