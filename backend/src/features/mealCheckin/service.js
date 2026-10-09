import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isMealDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function mealQrSecret(env = process.env) {
  const secret = env.MEAL_CHECKIN_QR_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('Meal check-in signing secret is not configured.');
  }
  return secret;
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createMealQrToken({ bookingId, mealDate, secret }) {
  if (!UUID_PATTERN.test(bookingId || '') || !isMealDate(mealDate)) {
    throw new Error('A valid meal booking and date are required.');
  }
  if (!secret || secret.length < 32)
    throw new Error('Meal check-in signing secret is not configured.');
  const payload = Buffer.from(`${bookingId}|${mealDate}`).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyMealQrToken(token, secret) {
  if (typeof token !== 'string' || token.length > 1024 || !secret || secret.length < 32)
    return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const expected = Buffer.from(sign(parts[0], secret));
  const received = Buffer.from(parts[1]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  let decoded;
  try {
    decoded = Buffer.from(parts[0], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const [bookingId, mealDate, ...extra] = decoded.split('|');
  if (extra.length || !UUID_PATTERN.test(bookingId || '') || !isMealDate(mealDate)) return null;
  return { bookingId, mealDate };
}

export async function registerMealCheckin({
  token,
  selectedDate,
  todayDate,
  actorId,
  secret,
  repository,
}) {
  if (!isMealDate(selectedDate)) return { status: 'invalid_date' };
  const booking = verifyMealQrToken(token, secret);
  if (!booking) return { status: 'invalid_token' };
  if (booking.mealDate !== selectedDate || selectedDate !== todayDate) {
    return { status: 'wrong_date' };
  }
  return repository.checkInMeal({
    bookingId: booking.bookingId,
    mealDate: booking.mealDate,
    actorId,
  });
}

export function istDateAndMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function isMealServiceClosed(mealDate, now = new Date(), cutoff = '14:00') {
  if (!isMealDate(mealDate)) return false;
  const [hour, minute] = cutoff.split(':').map(Number);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 24 ||
    (hour === 24 && minute !== 0) ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error('Meal service cutoff must use HH:mm format, with 24:00 allowed for midnight.');
  }
  const today = istDateAndMinutes(now);
  const cutoffMinutes = hour * 60 + minute;
  return mealDate < today.date || (mealDate === today.date && today.minutes >= cutoffMinutes);
}

export function summarizeMealBookings(bookings, { mealDate, now = new Date(), cutoff = '14:00' }) {
  const eligible = (bookings || []).filter((booking) =>
    ['veg', 'non_veg', 'egg'].includes(booking.choice)
  );
  const served = eligible.filter((booking) => {
    const checkin = Array.isArray(booking.meal_checkins)
      ? booking.meal_checkins[0]
      : booking.meal_checkins;
    return Boolean(checkin?.checked_in_at);
  }).length;
  const closed = isMealServiceClosed(mealDate, now, cutoff);
  const booked = eligible.length;
  const notServed = Math.max(0, booked - served);
  const byChoice = { veg: 0, non_veg: 0, egg: 0 };

  for (const booking of eligible) byChoice[booking.choice] += 1;

  return {
    meal_date: mealDate,
    booked,
    served,
    not_yet_served: closed ? 0 : notServed,
    no_show: closed ? notServed : 0,
    attendance_percent: booked ? Math.round((served / booked) * 10000) / 100 : 0,
    service_closed: closed,
    by_choice: byChoice,
  };
}

export function summarizeDailyServings(checkins, mealDate) {
  const dailyServings = {
    meal_date: mealDate,
    served: 0,
    by_choice: { veg: 0, non_veg: 0, egg: 0 },
    last_served_at: null,
  };

  for (const checkin of checkins || []) {
    if (checkin.meal_date !== mealDate) continue;
    dailyServings.served += 1;
    if (checkin.meal_choice in dailyServings.by_choice) {
      dailyServings.by_choice[checkin.meal_choice] += 1;
    }
    if (
      checkin.checked_in_at &&
      (!dailyServings.last_served_at || checkin.checked_in_at > dailyServings.last_served_at)
    ) {
      dailyServings.last_served_at = checkin.checked_in_at;
    }
  }

  return dailyServings;
}

export function attachMealCheckins(bookings, checkins) {
  const byBookingId = new Map(
    (checkins || []).map((checkin) => [checkin.meal_booking_id, checkin])
  );
  return (bookings || []).map((booking) => {
    const checkin = byBookingId.get(booking.id);
    return { ...booking, meal_checkins: checkin ? [checkin] : [] };
  });
}

export function filterBookingsByShift(bookings, preferences, shift = 'all') {
  if (shift === 'all') return bookings || [];
  const nightShiftUserIds = new Set(
    (preferences || [])
      .filter((preference) => preference.shift === 'night')
      .map((preference) => preference.user_id)
  );
  return (bookings || []).filter((booking) =>
    shift === 'night'
      ? nightShiftUserIds.has(booking.user_id)
      : !nightShiftUserIds.has(booking.user_id)
  );
}

export function filterProfilesByShift(profiles, preferences, shift = 'all') {
  if (shift === 'all') return profiles || [];
  const nightShiftUserIds = new Set(
    (preferences || [])
      .filter((preference) => preference.shift === 'night')
      .map((preference) => preference.user_id)
  );
  return (profiles || []).filter((profile) =>
    shift === 'night' ? nightShiftUserIds.has(profile.id) : !nightShiftUserIds.has(profile.id)
  );
}
