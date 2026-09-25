import { Router } from 'express';
import { computeForecasts, getActionableForecasts } from '../lib/forecast.js';
import { getAIDecision } from '../lib/recommendations.js';
import { checkAndNotifyLowStock, sendDailyStockDigest } from '../lib/stockAlerts.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { postAIReminderToTeams } from '../lib/teams.js';
import { sendPushToUsers } from './push.js';
import { sendMealBookingReminderEmail, sendMealSkipReminderEmail, sendMealNightReportEmail, sendMealBookingConfirmationEmail } from '../lib/microsoftGraph.js';
import { ensureMonthGrant } from '../lib/tokens.js';

const router = Router();

// ── Cabin print order config ──────────────────────────────────────────────────
// Each cabin is printed with a 2-minute gap so office boy can separate batches.
// Change order or delays here without touching any other code.
const CABIN_PRINT_ORDER = [
  { name: 'Balaji Cabin', abbr: 'BALAJI', delayMinutes: 0 },
  { name: 'R.K Cabin', abbr: 'RK', delayMinutes: 2 },
  { name: 'Durga Sri Manisha Cabin', abbr: 'MAN', delayMinutes: 4 },
  { name: 'Anusha Cabin', abbr: 'ANU', delayMinutes: 6 },
  { name: 'Marketing Cabin', abbr: 'MKT', delayMinutes: 8 },
  { name: 'Resume Cabin', abbr: 'RES', delayMinutes: 10 },
];

// Exported so mealPrint.js can use the same cabin list
export { CABIN_PRINT_ORDER };

export function getCabinName(bookingCabin, preferredLocation) {
  const cabinNames = {
    'Rama Krishna Cabin': 'R.K Cabin',
    'RK Cabin': 'R.K Cabin',
    'Manisha Cabin': 'Durga Sri Manisha Cabin',
    'Durga Sri Manisha Cabin': 'Durga Sri Manisha Cabin',
  };
  if (bookingCabin) return cabinNames[bookingCabin] || bookingCabin;
  const locationToCabin = {
    'Balaji Cabin': 'Balaji Cabin',
    'RK Cabin': 'R.K Cabin',
    'Rama Krishna Cabin': 'R.K Cabin',
    'Manisha Cabin': 'Durga Sri Manisha Cabin',
    'Durga Sri Manisha Cabin': 'Durga Sri Manisha Cabin',
    'Resume Cabin': 'Resume Cabin',
    'Tech Team': 'Anusha Cabin',
    'Marketing Team': 'Marketing Cabin',
  };
  return locationToCabin[preferredLocation] || preferredLocation || 'Unassigned';
}

export function resolveBookingCabin(bookingCabin, assignedCabin) {
  const cabin = assignedCabin || bookingCabin || 'Unassigned';
  return {
    'Rama Krishna Cabin': 'R.K Cabin',
    'RK Cabin': 'R.K Cabin',
    'Manisha Cabin': 'Durga Sri Manisha Cabin',
  }[cabin] || cabin;
}

export function filterDayMealBookings(bookings, preferences) {
  const nightShiftUserIds = new Set(
    (preferences || [])
      .filter((preference) => preference.shift === 'night')
      .map((preference) => preference.user_id)
  );

  return (bookings || []).filter((booking) => !nightShiftUserIds.has(booking.user_id));
}

export function filterNightMealBookings(bookings, preferences) {
  const nightShiftUserIds = new Set(
    (preferences || [])
      .filter((preference) => preference.shift === 'night')
      .map((preference) => preference.user_id)
  );

  return (bookings || []).filter((booking) => nightShiftUserIds.has(booking.user_id));
}

export function countMealBookings(bookings) {
  const counts = { veg: 0, non_veg: 0, egg: 0, skip: 0 };
  const others = {};
  const latestBookingByUser = new Map();
  let anonymousIndex = 0;

  for (const booking of bookings || []) {
    if (!booking || !booking.choice) continue;

    const userKey = booking.user_id ?? `__anonymous__${anonymousIndex++}`;
    latestBookingByUser.set(userKey, booking.choice);
  }

  for (const choice of latestBookingByUser.values()) {
    if (choice in counts) {
      counts[choice]++;
    } else {
      others[choice] = (others[choice] || 0) + 1;
    }
  }

  const bookedCount = counts.veg + counts.non_veg + counts.egg + Object.values(others).reduce((sum, count) => sum + count, 0);
  return { counts, others, bookedCount, skippedCount: counts.skip };
}

export function buildNightShiftReportData(bookings, preferences, dateLabel) {
  const nightShiftBookings = filterNightMealBookings(bookings, preferences);
  const { counts, others, bookedCount, skippedCount } = countMealBookings(nightShiftBookings);

  return {
    counts,
    others,
    bookedCount,
    skippedCount,
    totalNotBooked: 0,
    unbookedNames: [],
    dateLabel,
  };
}

// ── Helper: get IST date string "YYYY-MM-DD" ─────────────────────────────────
export function getISTDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getNextWorkingMealDate(date = new Date()) {
  const istDate = getISTDateString(date);
  const [year, month, day] = istDate.split('-').map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));

  while (nextDate.getUTCDay() === 0 || nextDate.getUTCDay() === 6) {
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  }

  return [
    nextDate.getUTCFullYear(),
    String(nextDate.getUTCMonth() + 1).padStart(2, '0'),
    String(nextDate.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function getReportRecipientEmails(activeProfiles) {
  const allowedRoles = new Set(['leadership', 'office_boy', 'facility_manager', 'admin']);

  return [...new Set(
    (activeProfiles || [])
      .filter((profile) => profile.email && allowedRoles.has(profile.role))
      .map((profile) => profile.email)
  )];
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
    // Fetch all non-skip bookings for today, including cabin_name if already resolved
    const { data: bookings, error: bookErr } = await supabaseAdmin
      .from('meal_bookings')
      .select('id, user_id, choice, meal_date, cabin_name')
      .eq('meal_date', mealDate)
      .neq('choice', 'skip');

    if (bookErr) throw bookErr;
    if (!bookings || bookings.length === 0) {
      console.log(`[Cron] No bookings for ${mealDate} — skipping print job creation`);
      return res.json({ ok: true, jobsCreated: 0, message: 'No bookings found' });
    }

    // Fetch all employee cafeteria preferences to map user_id -> cabin
    const { data: prefs, error: prefsErr } = await supabaseAdmin
      .from('employee_cafeteria_preferences')
      .select('user_id, shift, cabin, preferred_location');

    if (prefsErr) throw prefsErr;

    const cabinMap = {};
    for (const p of prefs || []) {
      cabinMap[p.user_id] = getCabinName(p.cabin, p.preferred_location);
    }

    const dayMealBookings = filterDayMealBookings(bookings, prefs);

    // User settings are authoritative; the booking value is only a fallback for users without settings.
    const byCabin = {};
    for (const b of dayMealBookings) {
      const cabin = resolveBookingCabin(b.cabin_name, cabinMap[b.user_id]);
      if (!byCabin[cabin]) byCabin[cabin] = [];
      byCabin[cabin].push(b);
    }

    // Build 11:00 AM IST as UTC for scheduled_for base time
    // 11:00 AM IST = 05:30 UTC
    const basePrintTimeUTC = new Date(`${mealDate}T05:30:00.000Z`);

    const printJobs = [];
    const tokenUpdates = [];
    const processedCabins = new Set();

    // 1. Process standard cabins in print order
    for (const cabinConfig of CABIN_PRINT_ORDER) {
      processedCabins.add(cabinConfig.name);
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

    // 2. Process non-standard/unlisted cabins and locations (e.g. Pantry Counter, Unassigned, etc.)
    for (const cabinName of Object.keys(byCabin)) {
      if (processedCabins.has(cabinName)) continue;

      const cabinBookings = byCabin[cabinName] || [];
      if (cabinBookings.length === 0) continue;

      // Generate custom configuration on-the-fly for custom/fallback locations
      const fallbackAbbr = cabinName === 'Pantry Counter' ? 'PTRY' :
                           cabinName === 'Unassigned' ? 'UNASG' :
                           cabinName.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 6) || 'GEN';
      
      // Delay for custom/fallback locations (printed 12 minutes after the base time)
      const delayMinutes = 12;
      const scheduledFor = new Date(
        basePrintTimeUTC.getTime() + delayMinutes * 60 * 1000
      );

      cabinBookings.forEach((booking, idx) => {
        const tokenNumber = generateTokenNumber(mealDate, fallbackAbbr, idx + 1);
        tokenUpdates.push({
          id: booking.id,
          token_number: tokenNumber,
          cabin_name: cabinName,
        });
      });

      printJobs.push({
        meal_date: mealDate,
        cabin_name: cabinName,
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
    .select('telegram_chat_id, profiles!user_id!inner(role)')
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

// POST /api/cron/meal-booking-night-shift-report
// Called by pg_cron at 10:15 PM IST. Reports the next working day's
// night-shift meal bookings after today's 10:00 PM booking cutoff.
router.post('/meal-booking-night-shift-report', async (req, res, next) => {
  try {
    const secret = req.query.secret || req.body?.secret || req.headers['x-cron-secret'];
    const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';

    if (secret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // The report is sent today, but night bookings store tomorrow's meal_date.
    // This runs after the 10:00 PM IST night booking cutoff.
    const reportDate = getISTDateString();
    const reportDay = new Date(`${reportDate}T00:00:00Z`).getUTCDay();
    if (reportDay === 0 || reportDay === 6) {
      return res.json({
        ok: true,
        skipped: true,
        reason: 'Weekend: the Friday night report already covers Monday; no duplicate report is sent',
        reportDate,
      });
    }
    const mealDate = getNextWorkingMealDate();
    if (!mealDate) {
      return res.json({
        ok: true,
        skipped: true,
        reason: 'The next day is not a working day; no night-shift booking window closed today',
        reportDate,
      });
    }

    const [{ data: bookings, error: bookingsErr }, { data: preferences, error: preferencesErr }] = await Promise.all([
      supabaseAdmin
        .from('meal_bookings')
        .select('user_id, choice')
        .eq('meal_date', mealDate),
      supabaseAdmin
        .from('employee_cafeteria_preferences')
        .select('user_id, shift'),
    ]);

    if (bookingsErr) throw bookingsErr;
    if (preferencesErr) throw preferencesErr;

    const dateLabel = new Date(`${mealDate}T00:00:00+05:30`).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const reportData = buildNightShiftReportData(bookings, preferences, dateLabel);
    const { counts, others, bookedCount, skippedCount } = reportData;

    const { data: activeProfiles, error: profilesErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, role')
      .eq('active', true);

    if (profilesErr) throw profilesErr;

    const uniqueReportRecipients = getReportRecipientEmails(activeProfiles);

    if (uniqueReportRecipients.length > 0) {
      sendMealNightReportEmail(uniqueReportRecipients, {
        mealDate: dateLabel,
        totalBooked: bookedCount,
        totalSkipped: skippedCount,
        totalNotBooked: 0,
        vegCount: counts.veg,
        nonVegCount: counts.non_veg,
        eggCount: counts.egg,
        others,
        unbookedNames: [],
      }).catch((e) => console.error('[MealNightReport] Email sending failed:', e.message));
    }

    const { data: mappings, error: mapErr } = await supabaseAdmin
      .from('telegram_user_map')
      .select('telegram_chat_id, profiles!user_id!inner(role)')
      .in('profiles.role', ['office_boy', 'facility_manager', 'leadership', 'admin']);

    if (mapErr) throw mapErr;

    const chatIds = [...new Set(mappings?.map((mapping) => mapping.telegram_chat_id).filter(Boolean) || [])];

    let msg = `🌙 *Night Shift Meal Count*\n`;
    msg += `🕙 Reported: *${reportDate} at 10:15 PM IST*\n`;
    msg += `📅 Date: *${dateLabel}*\n\n`;
    msg += `🟢 *Veg*: ${counts.veg}\n`;
    msg += `🔴 *Non-Veg*: ${counts.non_veg}\n`;
    msg += `🥚 *Egg*: ${counts.egg}\n`;
    for (const [choice, count] of Object.entries(others)) {
      msg += `🍱 *${choice}*: ${count}\n`;
    }
    msg += `\nTotal Night Shift Bookings: *${bookedCount}*`;
    if (skippedCount > 0) msg += `\nSkipped: *${skippedCount}*`;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken || chatIds.length === 0) {
      return res.json({
        ok: true,
        reportDate,
        mealDate,
        totalBookings: bookedCount,
        totalSkipped: skippedCount,
        chatCount: chatIds.length,
        sent: 0,
        message: !botToken ? 'Telegram bot token not set' : 'No registered Telegram chats found',
      });
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const results = await Promise.allSettled(
      chatIds.map((chatId) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }),
        }).then(async (response) => {
          if (!response.ok) throw new Error(`Telegram error ${response.status}: ${await response.text()}`);
          return response.json();
        })
      )
    );

    const succeeded = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - succeeded;
    console.log(`[NightShiftReport] Report for ${mealDate} sent to ${succeeded} chats, failed to ${failed} chats.`);

    res.json({ ok: failed === 0, reportDate, mealDate, totalBookings: bookedCount, totalSkipped: skippedCount, succeeded, failed });
  } catch (e) {
    next(e);
  }
});

// POST /api/cron/meal-booking-reminder
// Called by pg_cron at 3:30 PM IST everyday.
router.post('/meal-booking-reminder', async (req, res, next) => {
  try {
    const secret = req.query.secret || req.body?.secret || req.headers['x-cron-secret'];
    const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';

    if (secret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 1. Calculate tomorrow in IST
    const now = new Date();
    const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const currentHour = istNow.getHours();
    const currentMinute = istNow.getMinutes();
    const isNightShiftReminderWindow = [18, 19, 20, 21, 22].includes(currentHour);
    const isFinal = currentHour === 22;
    const isDayShiftFinal = currentHour > 17 || (currentHour === 17 && currentMinute >= 15);
    const isFinalReminder = isNightShiftReminderWindow ? isFinal : isDayShiftFinal;

    const istTomorrow = new Date(istNow);
    istTomorrow.setDate(istTomorrow.getDate() + 1);

    const yyyy = istTomorrow.getFullYear();
    const mm = String(istTomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(istTomorrow.getDate()).padStart(2, '0');
    const tomorrowStr = `${yyyy}-${mm}-${dd}`;

    // 2. Check if tomorrow is a working day (Mon-Fri)
    const tomorrowDay = istTomorrow.getDay(); // 0=Sun, 6=Sat
    const isTomorrowWorkingDay = tomorrowDay >= 1 && tomorrowDay <= 5;

    if (!isTomorrowWorkingDay) {
      return res.json({
        ok: true,
        skipped: true,
        reason: `Tomorrow (${tomorrowStr}) is not a working day. Reminders are only sent for working days.`,
      });
    }

    // 3. Query active profiles with emails and their shift preferences.
    const { data: profiles, error: profilesErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .eq('active', true)
      .not('email', 'is', null);

    if (profilesErr) throw profilesErr;

    const { data: shiftPreferences, error: shiftPreferencesErr } = await supabaseAdmin
      .from('employee_cafeteria_preferences')
      .select('user_id, shift');

    if (shiftPreferencesErr) throw shiftPreferencesErr;

    const shiftByUserId = new Map(
      (shiftPreferences || [])
        .filter((preference) => preference && preference.user_id)
        .map((preference) => [preference.user_id, preference.shift || 'morning'])
    );

    const nightShiftUserIds = new Set(
      [...shiftByUserId.entries()]
        .filter(([, shift]) => shift === 'night')
        .map(([userId]) => userId)
    );

    const targetProfiles = isNightShiftReminderWindow
      ? profiles.filter((profile) => nightShiftUserIds.has(profile.id))
      : profiles.filter((profile) => !nightShiftUserIds.has(profile.id));

    if (targetProfiles.length === 0) {
      return res.json({
        ok: true,
        message: isNightShiftReminderWindow
          ? 'No active night-shift users are pending for tomorrow.'
          : 'All active day-shift users have already booked their meals for tomorrow.',
        emailsSent: 0,
      });
    }

    // 4. Query meal bookings for tomorrow, including exact booking timestamps so
    // late-evening bookings can suppress later reminder sends for the same user.
    const { data: bookings, error: bookingsErr } = await supabaseAdmin
      .from('meal_bookings')
      .select('user_id, booked_at')
      .eq('meal_date', tomorrowStr);

    if (bookingsErr) throw bookingsErr;

    const bookedUserIds = new Set((bookings || []).filter((booking) => booking?.user_id).map((booking) => booking.user_id));

    const bookingByUser = new Map();
    for (const booking of bookings || []) {
      if (!booking?.user_id || !booking?.booked_at) continue;
      const existingBooking = bookingByUser.get(booking.user_id);
      if (!existingBooking || new Date(booking.booked_at) > new Date(existingBooking.booked_at)) {
        bookingByUser.set(booking.user_id, booking);
      }
    }

    function isLateNightBookingAfterCurrentTime(booking) {
      if (!booking?.booked_at || !isNightShiftReminderWindow) return false;

      const bookedAt = new Date(booking.booked_at);
      const istBookedAt = new Date(bookedAt.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const bookedHour = istBookedAt.getHours();
      const bookedMinute = istBookedAt.getMinutes();
      const bookedAfterSixPM = bookedHour >= 18;

      if (!bookedAfterSixPM) return false;

      return currentHour > bookedHour || (currentHour === bookedHour && currentMinute >= bookedMinute);
    }

    // 5. Filter users who haven't booked, while respecting the strict time-based
    // night-shift rule: a booking after 6 PM suppresses any later reminder run.
    const nonBookedUsers = targetProfiles.filter((p) => {
      if (bookedUserIds.has(p.id)) return false;
      if (!isNightShiftReminderWindow) return true;
      return !isLateNightBookingAfterCurrentTime(bookingByUser.get(p.id));
    });

    if (nonBookedUsers.length === 0) {
      return res.json({
        ok: true,
        message: isNightShiftReminderWindow
          ? 'All active night-shift users have already booked their meals for tomorrow.'
          : 'All active day-shift users have already booked their meals for tomorrow.',
        emailsSent: 0,
      });
    }

    // Send emails sequentially and wait for completion so the cron caller knows
    // which users were actually sent or failed. Retry Graph failures briefly.
    let sent = 0;
    let failed = 0;
    for (const user of nonBookedUsers) {
      try {
        // Re-check immediately before sending because users can book while this
        // worker is processing the earlier recipients.
        const { data: latestBooking, error: latestBookingErr } = await supabaseAdmin
          .from('meal_bookings')
          .select('id, booked_at')
          .eq('user_id', user.id)
          .eq('meal_date', tomorrowStr)
          .maybeSingle();

        if (latestBookingErr) throw latestBookingErr;
        if (latestBooking) {
          const isLateNightBookingAfterCurrentTime = (() => {
            if (!isNightShiftReminderWindow) return false;
            const latestBookedAt = new Date(latestBooking.booked_at);
            const istBookedAt = new Date(latestBookedAt.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
            const bookedHour = istBookedAt.getHours();
            const bookedMinute = istBookedAt.getMinutes();
            const bookedAfterSixPM = bookedHour >= 18;
            if (!bookedAfterSixPM) return false;
            return currentHour > bookedHour || (currentHour === bookedHour && currentMinute >= bookedMinute);
          })();

          if (isLateNightBookingAfterCurrentTime) {
            console.log(`[MealReminder] Skipping ${user.email}; late night booking after 6 PM already exists for ${tomorrowStr}`);
            continue;
          }

          console.log(`[MealReminder] Skipping ${user.email}; meal already booked for ${tomorrowStr}`);
          continue;
        }

        let lastError;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            await sendMealBookingReminderEmail(user.email, tomorrowStr, isFinalReminder);
            lastError = null;
            break;
          } catch (e) {
            lastError = e;
            if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
          }
        }
        if (lastError) throw lastError;

        console.log(`[MealReminder] Email sent successfully to ${user.email} (${user.full_name}) for ${tomorrowStr} (isFinal: ${isFinal})`);
        sent++;
      } catch (e) {
        console.error(`[MealReminder] Failed to send email to ${user.email}:`, e.message);
        failed++;
      }
      // Delay between recipients to avoid Microsoft Graph concurrency throttling.
      await new Promise((r) => setTimeout(r, 400));
    }

    console.log(`[MealReminder] Done. Sent: ${sent}, Failed: ${failed}, Total: ${nonBookedUsers.length}`);
    return res.json({
      ok: failed === 0,
      message: `Meal reminders processed. Sent: ${sent}, failed: ${failed}.`,
      tomorrow: tomorrowStr,
      queuedCount: nonBookedUsers.length,
      emailsSent: sent,
      emailsFailed: failed,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/cron/meal-booking-night-report
// Called by pg_cron at 8:30 PM IST everyday (15:00 UTC).
router.post('/meal-booking-night-report', async (req, res, next) => {
  try {
    const secret = req.query.secret || req.body?.secret || req.headers['x-cron-secret'];
    const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';

    if (secret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 1. Calculate target report date in IST (tomorrow, or Monday if today is Friday)
    const now = new Date();
    const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

    const todayDay = istNow.getDay();
    const isTest = !!(req.query.testEmail || req.body?.testEmail);

    // Skip Saturday (6) and Sunday (0) unless it's a manual test run
    if ((todayDay === 0 || todayDay === 6) && !isTest) {
      return res.json({
        ok: true,
        skipped: true,
        reason: 'Today is a weekend. Night reports are only sent on working days (Monday-Friday).',
      });
    }

    const isFriday = todayDay === 5;
    const daysToAdd = isFriday ? 3 : 1;

    const istTomorrow = new Date(istNow);
    istTomorrow.setDate(istTomorrow.getDate() + daysToAdd);

    const yyyy = istTomorrow.getFullYear();
    const mm = String(istTomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(istTomorrow.getDate()).padStart(2, '0');
    const tomorrowStr = `${yyyy}-${mm}-${dd}`;

    // 2. Check if tomorrow is a working day (Mon-Fri)
    const tomorrowDay = istTomorrow.getDay(); // 0=Sun, 6=Sat
    const isTomorrowWorkingDay = tomorrowDay >= 1 && tomorrowDay <= 5;

    if (!isTomorrowWorkingDay && !isTest) {
      return res.json({
        ok: true,
        skipped: true,
        reason: `Tomorrow (${tomorrowStr}) is not a working day. Night reports are only sent for working days.`,
      });
    }

    // 3. Query ALL meal bookings for tomorrow (including skips)
    const { data: bookings, error: bookingsErr } = await supabaseAdmin
      .from('meal_bookings')
      .select('user_id, choice')
      .eq('meal_date', tomorrowStr);

    if (bookingsErr) throw bookingsErr;

    // 4. Query active profiles to calculate not booked and list unbooked names
    const { data: activeProfiles, error: profilesErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('active', true);

    if (profilesErr) throw profilesErr;

    const { data: shiftPreferences, error: shiftPreferencesErr } = await supabaseAdmin
      .from('employee_cafeteria_preferences')
      .select('user_id, shift');

    if (shiftPreferencesErr) throw shiftPreferencesErr;

    const dayShiftUserIds = new Set(
      (shiftPreferences || [])
        .filter((preference) => preference.shift !== 'night')
        .map((preference) => preference.user_id)
    );
    const dayShiftProfiles = activeProfiles.filter((profile) => dayShiftUserIds.has(profile.id));
    const dayShiftBookings = (bookings || []).filter((booking) => dayShiftUserIds.has(booking.user_id));

    // Count only day-shift bookings for the catering report.
    const counts = {
      veg: 0,
      non_veg: 0,
      egg: 0,
      skip: 0,
    };
    const others = {};

    for (const booking of dayShiftBookings) {
      if (booking.choice in counts) {
        counts[booking.choice]++;
      } else {
        others[booking.choice] = (others[booking.choice] || 0) + 1;
      }
    }

    // Booked count (excluding skip)
    const bookedCount = counts.veg + counts.non_veg + counts.egg + Object.values(others).reduce((a, b) => a + b, 0);
    const skippedCount = counts.skip;

    const bookedUserIds = new Set(dayShiftBookings.map((booking) => booking.user_id).filter(Boolean));
    
    // Unbooked users are active profiles who did not book at all (no row in meal_bookings for tomorrow)
    const unbookedUsers = dayShiftProfiles.filter((profile) => !bookedUserIds.has(profile.id));
    const notBookedCount = unbookedUsers.length;
    const unbookedNames = unbookedUsers.map((u) => u.full_name);

    // 5. Send Email Summary Report to leadership, office_boy, and facility_manager
    // Parse tomorrowStr at midnight IST to avoid timezone shift double-conversion bugs
    const parsedTomorrow = new Date(`${tomorrowStr}T00:00:00+05:30`);
    const dateLabel = parsedTomorrow.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    let uniqueReportRecipients;
    if (req.query.testEmail || req.body?.testEmail) {
      uniqueReportRecipients = [req.query.testEmail || req.body.testEmail];
    } else {
      uniqueReportRecipients = getReportRecipientEmails(activeProfiles);
    }

    if (uniqueReportRecipients.length > 0) {
      sendMealNightReportEmail(uniqueReportRecipients, {
        mealDate: dateLabel,
        totalBooked: bookedCount,
        totalSkipped: skippedCount,
        totalNotBooked: notBookedCount,
        vegCount: counts.veg,
        nonVegCount: counts.non_veg,
        eggCount: counts.egg,
        others,
        unbookedNames,
      }).catch((e) => console.error('[MealNightReport] Email sending failed:', e.message));
    }

    // 6. Format and send Telegram messages (retaining original behavior)
    // Telegram stats exclude skips
    const telegramTotal = bookedCount;

    // Fetch mappings for office_boy, facility_manager, leadership, and admin
    const { data: mappings, error: mapErr } = await supabaseAdmin
      .from('telegram_user_map')
      .select('telegram_chat_id, profiles!user_id!inner(role)')
      .in('profiles.role', ['office_boy', 'facility_manager', 'leadership', 'admin']);

    if (mapErr) throw mapErr;

    const chatIds = [...new Set(mappings?.map((m) => m.telegram_chat_id).filter(Boolean) || [])];
    
    if (chatIds.length === 0) {
      return res.json({
        ok: true,
        message: 'Email report queued. No registered Telegram chats found for office_boy, facility_manager, or leadership.',
        tomorrow: tomorrowStr,
        totalBooked: bookedCount,
        skipped: skippedCount,
        notBooked: notBookedCount,
      });
    }

    let msg = `📋 *Meal Bookings Report*\n`;
    msg += `📅 Date: *${dateLabel}*\n\n`;
    msg += `🟢 *Veg*: ${counts.veg}\n`;
    msg += `🔴 *Non-Veg*: ${counts.non_veg}\n`;
    msg += `🥚 *Egg*: ${counts.egg}\n`;

    // Append any other choices if they exist
    for (const [choice, count] of Object.entries(others)) {
      msg += `🍱 *${choice}*: ${count}\n`;
    }

    msg += `\nTotal Bookings: *${telegramTotal}*`;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.warn('[MealNightReport] TELEGRAM_BOT_TOKEN not set, skipping actual send');
      return res.json({
        ok: true,
        message: 'Telegram bot token not set. Message that would have been sent: ' + msg.replace(/\n/g, ' '),
        chatCount: chatIds.length,
        tomorrow: tomorrowStr,
        totalBookings: telegramTotal,
        counts: { veg: counts.veg, non_veg: counts.non_veg, egg: counts.egg, ...others },
      });
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const results = await Promise.allSettled(
      chatIds.map((cid) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: cid, text: msg, parse_mode: 'Markdown' }),
        }).then(async (r) => {
          if (!r.ok) {
            const body = await r.text();
            throw new Error(`Telegram error ${r.status}: ${body}`);
          }
          return r.json();
        })
      )
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    console.log(`[MealNightReport] Report sent to ${succeeded} chats, failed to ${failed} chats.`);

    res.json({
      ok: true,
      tomorrow: tomorrowStr,
      totalBookings: bookedCount,
      totalSkipped: skippedCount,
      totalNotBooked: notBookedCount,
      counts: { veg: counts.veg, non_veg: counts.non_veg, egg: counts.egg, ...others },
      succeeded,
      failed,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/cron/meal-skip-reminder
// Called by pg_cron at 7:00 PM IST everyday.
router.post('/meal-skip-reminder', async (req, res, next) => {
  try {
    const secret = req.query.secret || req.body?.secret || req.headers['x-cron-secret'];
    const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';

    if (secret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 1. Calculate tomorrow in IST
    const now = new Date();
    const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    
    const istTomorrow = new Date(istNow);
    istTomorrow.setDate(istTomorrow.getDate() + 1);

    const yyyy = istTomorrow.getFullYear();
    const mm = String(istTomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(istTomorrow.getDate()).padStart(2, '0');
    const tomorrowStr = `${yyyy}-${mm}-${dd}`;

    // 2. Check if tomorrow is a working day (Mon-Fri)
    const tomorrowDay = istTomorrow.getDay(); // 0=Sun, 6=Sat
    const isTomorrowWorkingDay = tomorrowDay >= 1 && tomorrowDay <= 5;

    if (!isTomorrowWorkingDay) {
      return res.json({
        ok: true,
        skipped: true,
        reason: `Tomorrow (${tomorrowStr}) is not a working day. Skip reminders are only sent for working days.`,
      });
    }

    // 3. Query all users who have booked a meal for tomorrow (Veg, Non-Veg, etc., not skipped)
    const { data: bookings, error: bookingsErr } = await supabaseAdmin
      .from('meal_bookings')
      .select('user_id')
      .eq('meal_date', tomorrowStr)
      .neq('choice', 'skip');

    if (bookingsErr) throw bookingsErr;

    if (!bookings || bookings.length === 0) {
      return res.json({
        ok: true,
        message: 'No users have booked meals for tomorrow.',
        emailsSent: 0,
      });
    }

    const bookedUserIds = bookings.map((b) => b.user_id);

    // 4. Query active profiles with emails for those who booked
    const { data: profiles, error: profilesErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .eq('active', true)
      .in('id', bookedUserIds)
      .not('email', 'is', null);

    if (profilesErr) throw profilesErr;

    if (profiles.length === 0) {
      return res.json({
        ok: true,
        message: 'No active booked users have email addresses configured.',
        emailsSent: 0,
      });
    }

    // Respond immediately to prevent cron timeout
    res.json({
      ok: true,
      message: `Sending skip reminders to ${profiles.length} users.`,
      tomorrow: tomorrowStr,
      queuedCount: profiles.length,
    });

    // 5. Send emails sequentially in the background (fire-and-forget)
    (async () => {
      let sent = 0;
      let failed = 0;
      for (const user of profiles) {
        try {
          await sendMealSkipReminderEmail(user.email, tomorrowStr);
          console.log(`[MealSkipReminder] Skip reminder email sent successfully to ${user.email} (${user.full_name}) for ${tomorrowStr}`);
          sent++;
        } catch (e) {
          console.error(`[MealSkipReminder] Failed to send skip reminder email to ${user.email}:`, e.message);
          failed++;
        }
        // 400ms delay between each email to stay within Microsoft Graph concurrency limits
        await new Promise((r) => setTimeout(r, 400));
      }
      console.log(`[MealSkipReminder] Done. Sent: ${sent}, Failed: ${failed}, Total: ${profiles.length}`);
    })();
  } catch (e) {
    next(e);
  }
});

// POST /api/cron/meal-booking-confirmation
// Called by pg_cron at 8:20 PM IST everyday.
router.post('/meal-booking-confirmation', async (req, res, next) => {
  try {
    const secret = req.query.secret || req.body?.secret || req.headers['x-cron-secret'];
    const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';

    if (secret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 1. Calculate tomorrow in IST
    const now = new Date();
    const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    
    const istTomorrow = new Date(istNow);
    istTomorrow.setDate(istTomorrow.getDate() + 1);

    const yyyy = istTomorrow.getFullYear();
    const mm = String(istTomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(istTomorrow.getDate()).padStart(2, '0');
    const tomorrowStr = `${yyyy}-${mm}-${dd}`;

    // 2. Check if tomorrow is a working day (Mon-Fri)
    const tomorrowDay = istTomorrow.getDay(); // 0=Sun, 6=Sat
    const isTomorrowWorkingDay = tomorrowDay >= 1 && tomorrowDay <= 5;

    if (!isTomorrowWorkingDay) {
      return res.json({
        ok: true,
        skipped: true,
        reason: `Tomorrow (${tomorrowStr}) is not a working day. Booking confirmations are only sent for working days.`,
      });
    }

    // 3. Query all tomorrow's meal bookings (excluding skip)
    const { data: bookings, error: bookingsErr } = await supabaseAdmin
      .from('meal_bookings')
      .select('id, user_id, choice')
      .eq('meal_date', tomorrowStr)
      .neq('choice', 'skip')
      .is('confirmation_email_sent_at', null);

    if (bookingsErr) throw bookingsErr;

    if (!bookings || bookings.length === 0) {
      return res.json({
        ok: true,
        message: 'No users have booked meals for tomorrow.',
        emailsSent: 0,
      });
    }

    const bookedUserIds = bookings.map((b) => b.user_id);

    // 4. Query active profiles with emails for those who booked
    const { data: profiles, error: profilesErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .eq('active', true)
      .in('id', bookedUserIds)
      .not('email', 'is', null);

    if (profilesErr) throw profilesErr;

    if (profiles.length === 0) {
      return res.json({
        ok: true,
        message: 'No active booked users have email addresses configured.',
        emailsSent: 0,
      });
    }

    const bookingMap = new Map(bookings.map((b) => [b.user_id, b]));

    // Respond immediately to prevent cron timeout
    res.json({
      ok: true,
      message: `Sending booking confirmations to ${profiles.length} users.`,
      tomorrow: tomorrowStr,
      queuedCount: profiles.length,
    });

    // 5. Send emails sequentially in the background (fire-and-forget)
    (async () => {
      let sent = 0;
      let failed = 0;
      for (const user of profiles) {
        try {
          const booking = bookingMap.get(user.id);
          const choice = booking?.choice || 'unknown';
          await sendMealBookingConfirmationEmail(user.email, user.full_name, choice, tomorrowStr);
          await supabaseAdmin
            .from('meal_bookings')
            .update({ confirmation_email_sent_at: new Date().toISOString() })
            .eq('id', booking.id);
          console.log(`[MealBookingConfirmation] Confirmation email sent successfully to ${user.email} (${user.full_name}) for ${tomorrowStr}`);
          sent++;
        } catch (e) {
          console.error(`[MealBookingConfirmation] Failed to send confirmation email to ${user.email}:`, e.message);
          failed++;
        }
        // 400ms delay between each email to stay within Microsoft Graph concurrency limits
        await new Promise((r) => setTimeout(r, 400));
      }
      console.log(`[MealBookingConfirmation] Done. Sent: ${sent}, Failed: ${failed}, Total: ${profiles.length}`);
    })();
  } catch (e) {
    next(e);
  }
});

async function monthlyTokenGrant(req, res, next) {
  try {
    const secret = req.query.secret || req.body?.secret || req.headers['x-cron-secret'];
    const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';
    const fromVercelCron = String(req.headers['x-vercel-cron'] || '') === '1';
    if (!fromVercelCron && secret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const force = req.query.force === '1' || req.body?.force;
    const ist = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const clock = Object.fromEntries(ist.map((p) => [p.type, p.value]));
    if (!force && !(Number(clock.day) === 1 && Number(clock.hour) >= 8)) {
      return res.json({
        ok: true,
        skipped: true,
        reason: 'Runs on the 1st of the month at/after 8:00 AM IST',
      });
    }
    const { data: users, error } = await supabaseAdmin.from('profiles').select('id');
    if (error) throw error;
    let granted = 0;
    for (const u of users || []) {
      const r = await ensureMonthGrant(u.id);
      if (r?.granted) granted += 1;
    }
    res.json({ ok: true, granted, total: (users || []).length, monthly_grant: 4000 });
  } catch (e) {
    next(e);
  }
}

router.post('/monthly-token-grant', monthlyTokenGrant);
router.get('/monthly-token-grant', monthlyTokenGrant);

export default router;
