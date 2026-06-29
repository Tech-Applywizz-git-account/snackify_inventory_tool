import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';
import { CABIN_PRINT_ORDER } from './cron.js';

const router = Router();

// ── IST helpers ────────────────────────────────────────────────────────────────
function getISTNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function getISTHour() {
  const ist = getISTNow();
  return ist.getHours() + ist.getMinutes() / 60;
}

function getISTDateString() {
  return getISTNow().toISOString().slice(0, 10);
}

// ── Reprint time-window enforcement ──────────────────────────────────────────
// Returns null if allowed, or an error string if not.
function checkReprintWindow(userRole) {
  const hour = getISTHour();
  if (userRole === 'facility_manager' || userRole === 'leadership') {
    return null; // Always allowed
  }
  if (userRole === 'office_boy') {
    if (hour < 11 || hour > 14) {
      return 'Reprinting is only allowed between 11:00 AM and 2:00 PM for office boy';
    }
    return null;
  }
  // Staff / employee
  if (hour < 11 || hour > 13.5) {
    return 'Reprinting is only allowed between 11:00 AM and 1:30 PM';
  }
  return null;
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

// ── GET /api/meal-print/my-token?date=YYYY-MM-DD ────────────────────────────
// Returns the logged-in employee's token for a given meal date.
// Used by the "My Meal Box" page to show token + print button.
router.get('/my-token', async (req, res, next) => {
  try {
    const date = req.query.date || getISTDateString();

    const booking = await findMealBooking(
      req.user.id,
      date,
      'id, meal_date, choice, token_number, cabin_name, print_count, last_printed_at, booked_at'
    );

    const hour = getISTHour();
    const canReprint = hour >= 11 && hour <= 13.5;

    res.json({
      booking: booking || null,
      canReprint,
      reprintWindowMessage: canReprint
        ? 'You can reprint your token until 1:30 PM'
        : hour < 11
          ? 'Reprint opens at 11:00 AM'
          : 'Reprint window has closed (after 1:30 PM)',
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/meal-print/status?date=YYYY-MM-DD ──────────────────────────────
// Returns cabin-wise print job status for a given date.
// Used by the Office Boy dashboard.
router.get(
  '/status',
  requireRole('office_boy', 'facility_manager', 'leadership', 'finance'),
  async (req, res, next) => {
    try {
      const date = req.query.date || getISTDateString();

      const { data: jobs, error: jobsErr } = await supabaseAdmin
        .from('meal_print_jobs')
        .select('*')
        .eq('meal_date', date)
        .order('scheduled_for');

      if (jobsErr) throw jobsErr;

      // Also get booking counts per cabin for display
      const { data: counts, error: countErr } = await supabaseAdmin
        .from('meal_bookings')
        .select('cabin_name, choice')
        .eq('meal_date', date)
        .neq('choice', 'skip');

      if (countErr) throw countErr;

      // Build cabin count map
      const cabinCounts = {};
      for (const b of counts || []) {
        if (!b.cabin_name) continue;
        if (!cabinCounts[b.cabin_name])
          cabinCounts[b.cabin_name] = { total: 0, veg: 0, non_veg: 0, egg: 0 };
        cabinCounts[b.cabin_name].total++;
        if (cabinCounts[b.cabin_name][b.choice] !== undefined) {
          cabinCounts[b.cabin_name][b.choice]++;
        }
      }

      // Merge cabin config with job status and counts
      const cabinStatus = CABIN_PRINT_ORDER.map((cabin) => {
        const job = (jobs || []).find((j) => j.cabin_name === cabin.name);
        const counts = cabinCounts[cabin.name] || { total: 0, veg: 0, non_veg: 0, egg: 0 };
        return {
          cabin_name: cabin.name,
          scheduled_time: job?.scheduled_for || null,
          status: job?.status || 'not_scheduled',
          job_id: job?.id || null,
          started_at: job?.started_at || null,
          completed_at: job?.completed_at || null,
          token_count: job?.token_count || counts.total,
          ...counts,
        };
      });

      const totalMeals = Object.values(cabinCounts).reduce((sum, c) => sum + c.total, 0);
      const printedCabins = (jobs || []).filter((j) => j.status === 'completed').length;

      res.json({
        date,
        cabins: cabinStatus,
        summary: {
          totalMeals,
          printedCabins,
          totalCabins: CABIN_PRINT_ORDER.length,
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

// ── POST /api/meal-print/trigger-cabin ──────────────────────────────────────
// Office boy manually triggers printing for a specific cabin.
// Creates a new meal_print_jobs row with scheduled_for = now.
// Body: { cabin_name: "Tech Cabin", date?: "YYYY-MM-DD" }
router.post(
  '/trigger-cabin',
  requireRole('office_boy', 'facility_manager', 'leadership'),
  async (req, res, next) => {
    try {
      const { cabin_name, date } = req.body;
      if (!cabin_name) return res.status(400).json({ error: 'cabin_name is required' });

      const mealDate = date || getISTDateString();

      // Check if a completed job already exists for this cabin+date
      const { data: existing } = await supabaseAdmin
        .from('meal_print_jobs')
        .select('id, status')
        .eq('meal_date', mealDate)
        .eq('cabin_name', cabin_name)
        .eq('print_type', 'cabin_batch')
        .maybeSingle();

      if (existing?.status === 'printing') {
        return res
          .status(409)
          .json({ error: 'This cabin is currently being printed. Please wait.' });
      }

      // Count bookings for this cabin
      const { count: tokenCount } = await supabaseAdmin
        .from('meal_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('meal_date', mealDate)
        .eq('cabin_name', cabin_name)
        .neq('choice', 'skip');

      if (!tokenCount || tokenCount === 0) {
        return res.status(400).json({ error: 'No bookings found for this cabin on this date' });
      }

      // Insert a new print job scheduled for right now
      const { data: job, error: jobErr } = await supabaseAdmin
        .from('meal_print_jobs')
        .insert({
          meal_date: mealDate,
          cabin_name,
          print_type: 'manual_cabin',
          scheduled_for: new Date().toISOString(),
          status: 'pending',
          token_count: tokenCount,
          requested_by: req.user.id,
        })
        .select()
        .single();

      if (jobErr) throw jobErr;

      console.log(
        `[MealPrint] Manual trigger for ${cabin_name} on ${mealDate} by ${req.user.full_name}`
      );
      res.json({ ok: true, job });
    } catch (e) {
      next(e);
    }
  }
);

// ── POST /api/meal-print/reprint-token ──────────────────────────────────────
// Reprint a single employee's token.
// Staff can only reprint their own. Office boy / FM / leadership can reprint anyone.
// Body: { user_id?: UUID, date?: "YYYY-MM-DD" }
// If user_id is omitted, reprints the calling user's own token.
router.post('/reprint-token', async (req, res, next) => {
  try {
    const { date } = req.body;
    const mealDate = date || getISTDateString();

    // Determine whose token to reprint
    let targetUserId = req.user.id; // default: own token
    if (req.body.user_id && req.body.user_id !== req.user.id) {
      // Reprinting someone else — only privileged roles allowed
      if (!['office_boy', 'facility_manager', 'leadership'].includes(req.user.role)) {
        return res.status(403).json({ error: 'You can only reprint your own token' });
      }
      targetUserId = req.body.user_id;
    }

    // Check reprint time window
    const windowError = checkReprintWindow(req.user.role);
    if (windowError) {
      return res.status(400).json({ error: windowError });
    }

    // Fetch the booking
    const booking = await findMealBooking(
      targetUserId,
      mealDate,
      'id, meal_date, choice, token_number, cabin_name, print_count, user_id'
    );
    if (!booking) return res.status(404).json({ error: 'No booking found for this date' });
    if (booking.choice === 'skip')
      return res.status(400).json({ error: 'Cannot reprint a skipped meal' });
    if (!booking.token_number)
      return res
        .status(400)
        .json({ error: 'Token not assigned yet. Printing starts at 11:00 AM.' });

    // Insert a reprint job — print agent handles the actual printing
    const { data: job, error: jobErr } = await supabaseAdmin
      .from('meal_print_jobs')
      .insert({
        meal_date: mealDate,
        cabin_name: booking.cabin_name,
        print_type: 'reprint',
        scheduled_for: new Date().toISOString(),
        status: 'pending',
        token_count: 1,
        requested_by: req.user.id,
        booking_user_id: targetUserId,
      })
      .select()
      .single();

    if (jobErr) throw jobErr;

    // Immediately update print_count and last_printed_by so the job tracks correctly
    await supabaseAdmin
      .from('meal_bookings')
      .update({
        print_count: (booking.print_count || 0) + 1,
        last_printed_at: new Date().toISOString(),
        last_printed_by: req.user.id,
      })
      .eq('id', booking.id);

    console.log(`[MealPrint] Reprint for ${targetUserId} on ${mealDate} by ${req.user.full_name}`);
    res.json({
      ok: true,
      job,
      booking: {
        ...booking,
        print_count: (booking.print_count || 0) + 1,
        is_duplicate: true,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/meal-print/cabin-bookings?date=...&cabin=... ───────────────────
// Office boy: list all bookings for a specific cabin on a date (for dashboard display)
router.get(
  '/cabin-bookings',
  requireRole('office_boy', 'facility_manager', 'leadership'),
  async (req, res, next) => {
    try {
      const { date, cabin } = req.query;
      if (!cabin) return res.status(400).json({ error: 'cabin query param required' });
      const mealDate = date || getISTDateString();

      const { data: bookings, error } = await supabaseAdmin
        .from('meal_bookings')
        .select(`
          id, choice, token_number, cabin_name, print_count, last_printed_at,
          profiles!inner(full_name, preferred_name, employee_code)
        `)
        .eq('meal_date', mealDate)
        .eq('cabin_name', cabin)
        .neq('choice', 'skip')
        .order('token_number');

      if (error) throw error;
      res.json(bookings || []);
    } catch (e) {
      next(e);
    }
  }
);

export default router;
