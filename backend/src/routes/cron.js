import { Router } from 'express';
import { computeForecasts, getActionableForecasts } from '../lib/forecast.js';
import { getAIDecision } from '../lib/recommendations.js';
import { checkAndNotifyLowStock, sendDailyStockDigest } from '../lib/stockAlerts.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { postAIReminderToTeams } from '../lib/teams.js';
import { sendPushToUsers } from './push.js';

const router = Router();

// ── Cabin print order config ──────────────────────────────────────────────────
// Each cabin is printed with a 2-minute gap so office boy can separate batches.
// Change order or delays here without touching any other code.
const CABIN_PRINT_ORDER = [
  { name: 'Balaji Cabin', abbr: 'BALAJI', delayMinutes: 0 },
  { name: 'Rama Krishna Cabin', abbr: 'RK', delayMinutes: 2 },
  { name: 'Manisha Cabin', abbr: 'MAN', delayMinutes: 4 },
  { name: 'Tech Cabin', abbr: 'TECH', delayMinutes: 6 },
  { name: 'Marketing Cabin', abbr: 'MKT', delayMinutes: 8 },
  { name: 'Resume Cabin', abbr: 'RES', delayMinutes: 10 },
];

// Exported so mealPrint.js can use the same cabin list
export { CABIN_PRINT_ORDER };

// ── Helper: get IST date string "YYYY-MM-DD" ─────────────────────────────────
function getISTDateString() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toISOString()
    .slice(0, 10);
}

// ── Helper: check if today is a working day (Mon-Fri) ────────────────────────
function isWorkingDayToday() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  return day >= 1 && day <= 5;
}

// ── Helper: generate token number ─────────────────────────────────────────────
// Format: "28MAY-TECH-012"
function generateTokenNumber(mealDate, cabinAbbr, sequenceNum) {
  const d = new Date(`${mealDate}T00:00:00+05:30`);
  const day = String(d.getDate()).padStart(2, '0');
  const monthNames = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  const month = monthNames[d.getMonth()];
  const seq = String(sequenceNum).padStart(3, '0');
  return `${day}${month}-${cabinAbbr}-${seq}`;
}

router.post('/ai-reminders', async (req, res) => {
  const secret = req.query.secret || req.body?.secret || req.headers['x-cron-secret'];
  const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';

  if (secret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Fetch opted-in employee reminder policies
  const { data: rawOptedIn, error: err } = await supabaseAdmin
    .from('employee_cafeteria_preferences')
    .select('user_id')
    .eq('reminder_enabled', true);

  if (err) {
    console.error('[Cron] failed to load preferences:', err.message);
    return res.status(500).json({ error: err.message });
  }

  if (!rawOptedIn?.length) return res.json({ sent: 0 });

  // Fetch profiles for the opted-in users to get their full names
  const userIds = rawOptedIn.map((o) => o.user_id).filter(Boolean);
  const { data: profiles, error: profilesErr } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds);

  if (profilesErr) {
    console.error('[Cron] failed to load profiles:', profilesErr.message);
    return res.status(500).json({ error: profilesErr.message });
  }

  const nameMap = {};
  if (profiles) {
    profiles.forEach((p) => {
      nameMap[p.id] = p.full_name;
    });
  }

  const optedIn = rawOptedIn.map(({ user_id }) => ({
    user_id,
    profiles: {
      full_name: nameMap[user_id] || 'Team Member',
    },
  }));

  // Respond immediately — don't block on GPT calls
  res.json({ queued: optedIn.length });

  // Fire and forget
  await Promise.allSettled(
    optedIn.map(async ({ user_id, profiles }) => {
      try {
        const _employeeName = profiles?.full_name || 'Team Member';
        const decision = await getAIDecision(user_id);
        if (!decision?.send_notification) return;

        await Promise.allSettled([
          sendPushToUsers([user_id], {
            title: decision.title,
            body: decision.message,
            url: '/request',
            tag: `reminder-${user_id}`,
          }),
          postAIReminderToTeams(user_id, decision),
        ]);
      } catch (e) {
        console.error('[Cron] employee', user_id, e.message);
      }
    })
  );
});

// ── POST /api/cron/schedule-meal-print ───────────────────────────────────────
// Called by pg_cron at 10:59 AM IST every working day.
// Generates tokens for all bookings grouped by cabin and inserts meal_print_jobs.
// Print agent listens to meal_print_jobs and prints each batch at scheduled_for time.
router.post('/schedule-meal-print', async (req, res) => {
  const secret = req.query.secret || req.body?.secret || req.headers['x-cron-secret'];
  const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';

  if (secret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Only run on working days (Mon-Fri IST)
  if (!isWorkingDayToday()) {
    return res.json({ ok: true, skipped: true, reason: 'Not a working day' });
  }

  const mealDate = getISTDateString();
  console.log(`[Cron] schedule-meal-print for ${mealDate}`);

  try {
    // Fetch all non-skip bookings for today, joined with cafeteria preferences for cabin
    const { data: bookings, error: bookErr } = await supabaseAdmin
      .from('meal_bookings')
      .select(`
        id,
        user_id,
        choice,
        meal_date,
        employee_cafeteria_preferences!inner(cabin)
      `)
      .eq('meal_date', mealDate)
      .neq('choice', 'skip');

    if (bookErr) throw bookErr;
    if (!bookings || bookings.length === 0) {
      console.log(`[Cron] No bookings for ${mealDate} — skipping print job creation`);
      return res.json({ ok: true, jobsCreated: 0, message: 'No bookings found' });
    }

    // Group bookings by cabin
    const byCabin = {};
    for (const b of bookings) {
      const cabin = b.employee_cafeteria_preferences?.cabin || 'Unassigned';
      if (!byCabin[cabin]) byCabin[cabin] = [];
      byCabin[cabin].push(b);
    }

    // Build 11:00 AM IST as UTC for scheduled_for base time
    // 11:00 AM IST = 05:30 UTC
    const basePrintTimeUTC = new Date(`${mealDate}T05:30:00.000Z`);

    const printJobs = [];
    const tokenUpdates = [];

    for (const cabinConfig of CABIN_PRINT_ORDER) {
      const cabinBookings = byCabin[cabinConfig.name] || [];
      if (cabinBookings.length === 0) continue; // Skip cabins with no bookings

      const scheduledFor = new Date(
        basePrintTimeUTC.getTime() + cabinConfig.delayMinutes * 60 * 1000
      );

      // Generate token numbers for each booking in this cabin
      cabinBookings.forEach((booking, idx) => {
        const tokenNumber = generateTokenNumber(mealDate, cabinConfig.abbr, idx + 1);
        tokenUpdates.push({
          id: booking.id,
          token_number: tokenNumber,
          cabin_name: cabinConfig.name,
        });
      });

      printJobs.push({
        meal_date: mealDate,
        cabin_name: cabinConfig.name,
        print_type: 'cabin_batch',
        scheduled_for: scheduledFor.toISOString(),
        status: 'pending',
        token_count: cabinBookings.length,
      });
    }

    // Update each booking with token_number and cabin_name
    // Do this sequentially to avoid upsert conflicts
    for (const update of tokenUpdates) {
      await supabaseAdmin
        .from('meal_bookings')
        .update({ token_number: update.token_number, cabin_name: update.cabin_name })
        .eq('id', update.id);
    }

    // Insert all print jobs in one batch
    if (printJobs.length > 0) {
      const { error: jobErr } = await supabaseAdmin.from('meal_print_jobs').insert(printJobs);
      if (jobErr) throw jobErr;
    }

    console.log(
      `[Cron] Created ${printJobs.length} print jobs for ${mealDate} — ${tokenUpdates.length} tokens assigned`
    );
    res.json({
      ok: true,
      mealDate,
      jobsCreated: printJobs.length,
      tokensAssigned: tokenUpdates.length,
    });
  } catch (err) {
    console.error('[Cron] schedule-meal-print failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cron/stock-alerts — daily safety net or triggered checks
router.post('/stock-alerts', async (req, res, next) => {
  try {
    const secret = req.query.secret || req.body?.secret || req.headers['x-cron-secret'];
    const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';

    if (secret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await checkAndNotifyLowStock(supabaseAdmin, process.env.TELEGRAM_BOT_TOKEN);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/cron/stock-digest — Phase 1 days-of-cover daily digest.
// Schedule via pg_cron (e.g. 9:00 AM IST = 03:30 UTC). Sends ONE combined
// Telegram message to leadership; silent when nothing needs attention.
router.post('/stock-digest', async (req, res, next) => {
  try {
    const secret = req.query.secret || req.body?.secret || req.headers['x-cron-secret'];
    const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';

    if (secret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await sendDailyStockDigest(supabaseAdmin, process.env.TELEGRAM_BOT_TOKEN);
    res.json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
});

// POST /api/cron/weekly-forecast — compute predictive order suggestions.
// Schedule via pg_cron every Monday morning (e.g. 7:00 AM IST = 01:30 UTC).
// Idempotent: re-running the same week upserts, never duplicates.
router.post('/weekly-forecast', async (req, res, next) => {
  try {
    const secret = req.query.secret || req.body?.secret || req.headers['x-cron-secret'];
    const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';

    if (secret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Compute and upsert forecasts
    const { upserted, errors } = await computeForecasts(supabaseAdmin);

    if (errors.length) {
      console.warn('[Cron] weekly-forecast partial errors:', errors);
    }

    // Send digest to leadership if there are actionable items
    const actionable = await getActionableForecasts(supabaseAdmin);
    if (actionable.length > 0) {
      await sendWeeklyForecastDigest(actionable, process.env.TELEGRAM_BOT_TOKEN);
    }

    res.json({ ok: true, upserted, actionable: actionable.length, errors });
  } catch (e) {
    next(e);
  }
});

/** Send a Telegram digest of suggested orders to leadership. */
async function sendWeeklyForecastDigest(items, botToken) {
  if (!botToken || !items.length) return;

  const { data: mappings } = await supabaseAdmin
    .from('telegram_user_map')
    .select('telegram_chat_id, profiles!inner(role)')
    .eq('profiles.role', 'leadership');

  const chatIds = mappings?.map((m) => m.telegram_chat_id).filter(Boolean) || [];
  if (!chatIds.length) return;

  const dateLabel = new Date().toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'long',
  });

  const lines = items.map((r) => {
    const unit = r.unit || 'units';
    const flag = r.basis === 'daily_usage_fallback' ? ' _(est)_' : '';
    return `📦 *${r.product_name}* — order ~${r.suggested_order} ${unit}${flag}`;
  });

  const msg =
    `🔮 *Weekly order suggestions — ${dateLabel}*\n\n` +
    `${lines.join('\n')}\n\n` +
    `_These are AI predictions based on recent usage. Confirm before ordering._`;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await Promise.allSettled(
    chatIds.map((cid) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cid, text: msg, parse_mode: 'Markdown' }),
      })
    )
  );
}

export default router;
