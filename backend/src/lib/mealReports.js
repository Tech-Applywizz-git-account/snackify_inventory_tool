import { supabaseAdmin } from './supabase.js';
import { sendMealNightReportEmail } from './microsoftGraph.js';
import { getMailRecipients } from './mailRecipients.js';
import {
  buildNightShiftReportData,
  countMealBookings,
  filterDayMealBookings,
  getISTDateString,
  getReportRecipientEmails,
} from './mealReportHelpers.js';

function formatMealDateLabel(mealDate) {
  return new Date(`${mealDate}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

async function loadActiveReportContext(mealDate) {
  const [{ data: bookings, error: bookingsErr }, { data: preferences, error: preferencesErr }, { data: activeProfiles, error: profilesErr }] =
    await Promise.all([
      supabaseAdmin.from('meal_bookings').select('user_id, choice').eq('meal_date', mealDate),
      supabaseAdmin.from('employee_cafeteria_preferences').select('user_id, shift'),
      supabaseAdmin.from('profiles').select('id, email, role, full_name').eq('active', true),
    ]);

  if (bookingsErr) throw bookingsErr;
  if (preferencesErr) throw preferencesErr;
  if (profilesErr) throw profilesErr;

  const activeUserIds = new Set((activeProfiles || []).map((profile) => profile.id));
  const activeBookings = (bookings || []).filter((booking) => activeUserIds.has(booking.user_id));

  return { activeBookings, preferences: preferences || [], activeProfiles: activeProfiles || [] };
}

export function buildDayShiftReportPayload(activeBookings, preferences, activeProfiles, mealDate) {
  const nightShiftUserIds = new Set(
    (preferences || [])
      .filter((preference) => preference.shift === 'night')
      .map((preference) => preference.user_id)
  );
  const dayShiftProfiles = (activeProfiles || []).filter((profile) => !nightShiftUserIds.has(profile.id));
  const dayShiftBookings = filterDayMealBookings(activeBookings, preferences).filter((booking) =>
    dayShiftProfiles.some((profile) => profile.id === booking.user_id)
  );
  const { counts, others, bookedCount, skippedCount } = countMealBookings(dayShiftBookings);
  const bookedUserIds = new Set(dayShiftBookings.map((booking) => booking.user_id).filter(Boolean));
  const unbookedUsers = dayShiftProfiles.filter((profile) => !bookedUserIds.has(profile.id));
  const unbookedNames = unbookedUsers
    .map((user) => user.full_name || user.email || 'Unknown')
    .sort((a, b) => a.localeCompare(b));

  return {
    shift: 'day',
    mealDate,
    dateLabel: formatMealDateLabel(mealDate),
    totalBooked: bookedCount,
    totalSkipped: skippedCount,
    totalNotBooked: unbookedUsers.length,
    vegCount: counts.veg,
    nonVegCount: counts.non_veg,
    eggCount: counts.egg,
    others,
    unbookedNames,
    counts,
  };
}

export function buildNightShiftReportPayload(activeBookings, preferences, activeProfiles, mealDate) {
  const report = buildNightShiftReportData(activeBookings, preferences, formatMealDateLabel(mealDate), activeProfiles);
  return {
    shift: 'night',
    mealDate,
    dateLabel: report.dateLabel || formatMealDateLabel(mealDate),
    totalBooked: report.bookedCount,
    totalSkipped: report.skippedCount,
    totalNotBooked: report.totalNotBooked,
    vegCount: report.counts.veg,
    nonVegCount: report.counts.non_veg,
    eggCount: report.counts.egg,
    others: report.others,
    unbookedNames: report.unbookedNames,
    counts: report.counts,
  };
}

function buildTelegramMessage(payload, reportDate = getISTDateString()) {
  const isNight = payload.shift === 'night';
  let msg = isNight
    ? `🌙 *Night Shift Meal Bookings Report*\n`
    : `☀️ *Day Shift Meal Bookings Report*\n`;
  if (isNight) msg += `🕙 Reported: *${reportDate}*\n`;
  msg += `📅 Meal date: *${payload.dateLabel}*\n\n`;
  msg += `🟢 *Veg*: ${payload.vegCount}\n`;
  msg += `🔴 *Non-Veg*: ${payload.nonVegCount}\n`;
  msg += `🥚 *Egg*: ${payload.eggCount}\n`;
  for (const [choice, count] of Object.entries(payload.others || {})) {
    msg += `🍱 *${choice}*: ${count}\n`;
  }
  msg += `\nTotal ${isNight ? 'Night' : 'Day'} Shift Bookings: *${payload.totalBooked}*`;
  if (payload.totalSkipped > 0) msg += `\nSkipped: *${payload.totalSkipped}*`;
  msg += `\nNot Booked: *${payload.totalNotBooked}*`;
  return msg;
}

async function sendTelegramReport(msg) {
  const { data: mappings, error: mapErr } = await supabaseAdmin
    .from('telegram_user_map')
    .select('telegram_chat_id, profiles!user_id!inner(role)')
    .in('profiles.role', ['office_boy', 'facility_manager', 'leadership', 'admin']);
  if (mapErr) throw mapErr;

  const chatIds = [...new Set(mappings?.map((mapping) => mapping.telegram_chat_id).filter(Boolean) || [])];
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || chatIds.length === 0) {
    return { chatCount: chatIds.length, succeeded: 0, failed: 0, skipped: true };
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
  return { chatCount: chatIds.length, succeeded, failed: results.length - succeeded, skipped: false };
}

/**
 * Build and send a meal shift report by email + Telegram.
 * @param {{ mealDate: string, shift: 'day'|'night', testEmail?: string }} opts
 */
export async function sendMealShiftReport({ mealDate, shift, testEmail }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mealDate)) {
    const err = new Error('mealDate must be YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  if (shift !== 'day' && shift !== 'night') {
    const err = new Error('shift must be "day" or "night"');
    err.status = 400;
    throw err;
  }

  const { activeBookings, preferences, activeProfiles } = await loadActiveReportContext(mealDate);
  const payload =
    shift === 'night'
      ? buildNightShiftReportPayload(activeBookings, preferences, activeProfiles, mealDate)
      : buildDayShiftReportPayload(activeBookings, preferences, activeProfiles, mealDate);

  const fallbackTo = getReportRecipientEmails(activeProfiles);
  const { to, cc } = await getMailRecipients('meal_report', { fallbackTo });
  const emailTo = testEmail ? [testEmail] : to;

  if (emailTo.length > 0) {
    await sendMealNightReportEmail(emailTo, {
      shift,
      mealDate: payload.dateLabel,
      totalBooked: payload.totalBooked,
      totalSkipped: payload.totalSkipped,
      totalNotBooked: payload.totalNotBooked,
      vegCount: payload.vegCount,
      nonVegCount: payload.nonVegCount,
      eggCount: payload.eggCount,
      others: payload.others,
      unbookedNames: payload.unbookedNames,
      ccEmails: testEmail ? [] : cc,
    });
  }

  const telegram = await sendTelegramReport(buildTelegramMessage(payload));

  return {
    ok: true,
    mealDate,
    shift,
    dateLabel: payload.dateLabel,
    totalBooked: payload.totalBooked,
    totalSkipped: payload.totalSkipped,
    totalNotBooked: payload.totalNotBooked,
    emailsTo: emailTo.length,
    emailsCc: testEmail ? 0 : cc.length,
    telegram,
  };
}
