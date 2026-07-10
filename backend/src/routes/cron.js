import { Router } from 'express';
import { computeForecasts, getActionableForecasts } from '../lib/forecast.js';
import { getAIDecision } from '../lib/recommendations.js';
import { checkAndNotifyLowStock, sendDailyStockDigest } from '../lib/stockAlerts.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { postAIReminderToTeams } from '../lib/teams.js';
import { sendPushToUsers } from './push.js';
import { sendMealBookingReminderEmail, sendMealSkipReminderEmail, sendMealNightReportEmail, sendMealBookingConfirmationEmail } from '../lib/microsoftGraph.js';

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

export function getCabinName(bookingCabin, preferredLocation) {
  if (bookingCabin) return bookingCabin;
  const locationToCabin = {
    'Balaji Cabin': 'Balaji Cabin',
    'RK Cabin': 'Rama Krishna Cabin',
    'Manisha Cabin': 'Manisha Cabin',
    'Resume Cabin': 'Resume Cabin',
    'Tech Team': 'Tech Cabin',
    'Marketing Team': 'Marketing Cabin',
  };
  return locationToCabin[preferredLocation] || preferredLocation || 'Unassigned';
}

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
      .select('user_id, cabin, preferred_location');

    if (prefsErr) throw prefsErr;

    const cabinMap = {};
    for (const p of prefs || []) {
      cabinMap[p.user_id] = getCabinName(p.cabin, p.preferred_location);
    }

    // Group bookings by cabin (preferring already set cabin_name, falling back to preference mapping)
    const byCabin = {};
    for (const b of bookings) {
      const cabin = b.cabin_name || cabinMap[b.user_id] || 'Unassigned';
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
    const isFinal = currentHour >= 17; // 5:15 PM is 17:15

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

    // 3. Query active profiles with emails
    const { data: profiles, error: profilesErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .eq('active', true)
      .not('email', 'is', null);

    if (profilesErr) throw profilesErr;

    // 4. Query meal bookings for tomorrow
    const { data: bookings, error: bookingsErr } = await supabaseAdmin
      .from('meal_bookings')
      .select('user_id')
      .eq('meal_date', tomorrowStr);

    if (bookingsErr) throw bookingsErr;

    const bookedUserIds = new Set(bookings.map((b) => b.user_id));

    // 5. Filter users who haven't booked
    const nonBookedUsers = profiles.filter((p) => !bookedUserIds.has(p.id));

    if (nonBookedUsers.length === 0) {
      return res.json({
        ok: true,
        message: 'All active users have already booked their meals for tomorrow.',
        emailsSent: 0,
      });
    }

    // Respond immediately to prevent cron timeout
    res.json({
      ok: true,
      message: `Sending reminders to ${nonBookedUsers.length} users.`,
      tomorrow: tomorrowStr,
      queuedCount: nonBookedUsers.length,
    });

    // 6. Send emails sequentially in the background (fire-and-forget)
    // Sequential with delay to avoid Microsoft Graph MailboxConcurrency throttle (HTTP 429)
    (async () => {
      let sent = 0;
      let failed = 0;
      for (const user of nonBookedUsers) {
        try {
          await sendMealBookingReminderEmail(user.email, tomorrowStr, isFinal);
          console.log(`[MealReminder] Email sent successfully to ${user.email} (${user.full_name}) for ${tomorrowStr} (isFinal: ${isFinal})`);
          sent++;
        } catch (e) {
          console.error(`[MealReminder] Failed to send email to ${user.email}:`, e.message);
          failed++;
        }
        // 400ms delay between each email to stay within Microsoft Graph concurrency limits
        await new Promise((r) => setTimeout(r, 400));
      }
      console.log(`[MealReminder] Done. Sent: ${sent}, Failed: ${failed}, Total: ${nonBookedUsers.length}`);
    })();
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

    // Count categories
    const counts = {
      veg: 0,
      non_veg: 0,
      egg: 0,
      skip: 0,
    };
    const others = {};

    for (const b of bookings || []) {
      if (b.choice in counts) {
        counts[b.choice]++;
      } else {
        others[b.choice] = (others[b.choice] || 0) + 1;
      }
    }

    // Booked count (excluding skip)
    const bookedCount = counts.veg + counts.non_veg + counts.egg + Object.values(others).reduce((a, b) => a + b, 0);
    const skippedCount = counts.skip;

    // 4. Query active profiles to calculate not booked and list unbooked names
    const { data: activeProfiles, error: profilesErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('active', true);

    if (profilesErr) throw profilesErr;

    const bookedUserIds = new Set(bookings?.map((b) => b.user_id).filter(Boolean) || []);
    
    // Unbooked users are active profiles who did not book at all (no row in meal_bookings for tomorrow)
    const unbookedUsers = activeProfiles.filter((p) => !bookedUserIds.has(p.id));
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
      const reportRecipients = activeProfiles
        .filter((p) => p.email && ['leadership', 'office_boy', 'facility_manager'].includes(p.role))
        .map((p) => p.email);
      uniqueReportRecipients = [...new Set(reportRecipients)];
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

    // Fetch mappings for office_boy, facility_manager, and leadership
    const { data: mappings, error: mapErr } = await supabaseAdmin
      .from('telegram_user_map')
      .select('telegram_chat_id, profiles!user_id!inner(role)')
      .in('profiles.role', ['office_boy', 'facility_manager', 'leadership']);

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
      .select('user_id, choice')
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

    const choiceMap = new Map(bookings.map((b) => [b.user_id, b.choice]));

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
          const choice = choiceMap.get(user.id) || 'unknown';
          await sendMealBookingConfirmationEmail(user.email, user.full_name, choice, tomorrowStr);
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

export default router;
