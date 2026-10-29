/**
 * Pure helpers for shift-wise meal attendance PDF reports.
 * Day and night are built separately from the same raw inputs.
 */

const FOOD_CHOICES = new Set(['veg', 'non_veg', 'egg']);
const EXCLUDED_ROLES = new Set(['vendor']);

/**
 * Vendor QR check-in went live around 6–9 Oct 2026.
 * Attendance (served / booked-absent) is only reliable from this date onward.
 */
export const MEAL_CHECKIN_DATA_START = '2026-10-10';

export function clampAttendanceFromDate(fromDate, toDate = fromDate) {
  const from = fromDate < MEAL_CHECKIN_DATA_START ? MEAL_CHECKIN_DATA_START : fromDate;
  if (from > toDate) return null;
  return from;
}

/**
 * Meal dates that had food bookings but zero QR check-ins.
 * Those days inflate "did not collect" and are excluded from attendance counts.
 */
export function findDatesSkippedForNoScan({
  fromDate,
  toDate,
  bookings,
  checkins,
}) {
  const scanDates = new Set(
    (checkins || [])
      .filter((row) => row?.meal_date >= fromDate && row?.meal_date <= toDate)
      .map((row) => row.meal_date)
  );
  const bookedDates = new Set();
  for (const booking of bookings || []) {
    if (!FOOD_CHOICES.has(booking.choice)) continue;
    if (!booking.meal_date) continue;
    if (booking.meal_date < fromDate || booking.meal_date > toDate) continue;
    bookedDates.add(booking.meal_date);
  }
  return [...bookedDates]
    .filter((date) => !scanDates.has(date))
    .sort();
}

export function filterRowsToScanDates(rows, scanDates) {
  const allowed = scanDates instanceof Set ? scanDates : new Set(scanDates || []);
  if (allowed.size === 0) return [];
  return (rows || []).filter((row) => allowed.has(row.meal_date));
}

export function addDaysIso(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

/** Weekdays (Mon–Fri) from `from` through `to` inclusive (ISO YYYY-MM-DD). */
export function listWeekdays(from, to) {
  const days = [];
  let cursor = from;
  while (cursor <= to) {
    const weekday = new Date(`${cursor}T00:00:00.000Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }
  return days;
}

export function displayName(profile) {
  return profile?.preferred_name || profile?.full_name || profile?.email || 'Unknown';
}

export function isEmployeeProfile(profile) {
  return Boolean(profile?.active) && !EXCLUDED_ROLES.has(profile?.role);
}

export function shiftForUser(userId, preferences) {
  const pref = (preferences || []).find((row) => row.user_id === userId);
  return pref?.shift === 'night' ? 'night' : 'day';
}

export function profilesForShift(profiles, preferences, shift) {
  return (profiles || []).filter((profile) => {
    if (!isEmployeeProfile(profile)) return false;
    return shiftForUser(profile.id, preferences) === shift;
  });
}

/**
 * Irregular = active shift users who booked a food meal on fewer than half
 * of weekdays in [fromDate, toDate].
 */
export function findIrregularBookers({
  profiles,
  preferences,
  bookings,
  shift,
  fromDate,
  toDate,
  mealDate,
  lookbackDays = 14,
  minRate = 0.5,
  /** When set, only these meal dates count as possible booking days. */
  eligibleDates = null,
}) {
  const to = toDate || mealDate;
  const from =
    fromDate || addDaysIso(to, -(Math.max(1, lookbackDays) - 1));
  const weekdays = listWeekdays(from, to);
  const eligible =
    eligibleDates == null
      ? weekdays
      : weekdays.filter((date) => eligibleDates.includes(date) || eligibleDates.has?.(date));
  const possibleDays = eligible.length || 1;
  const eligibleSet = new Set(eligible);
  const roster = profilesForShift(profiles, preferences, shift);
  const foodByUser = new Map();

  for (const booking of bookings || []) {
    if (!FOOD_CHOICES.has(booking.choice)) continue;
    if (!booking.user_id || !booking.meal_date) continue;
    if (booking.meal_date < from || booking.meal_date > to) continue;
    if (!eligibleSet.has(booking.meal_date)) continue;
    if (shiftForUser(booking.user_id, preferences) !== shift) continue;
    if (!foodByUser.has(booking.user_id)) foodByUser.set(booking.user_id, new Set());
    foodByUser.get(booking.user_id).add(booking.meal_date);
  }

  return roster
    .map((profile) => {
      const bookedDays = foodByUser.get(profile.id)?.size || 0;
      const rate = bookedDays / possibleDays;
      return {
        user_id: profile.id,
        name: displayName(profile),
        email: profile.email || null,
        employee_code: profile.employee_code || null,
        booked_days: bookedDays,
        possible_days: possibleDays,
        booking_rate: Math.round(rate * 10000) / 100,
      };
    })
    .filter((row) => row.booking_rate < minRate * 100)
    .sort((a, b) => a.booking_rate - b.booking_rate || a.name.localeCompare(b.name));
}

/**
 * Build one shift report for a from→to meal date range (single day when from === to).
 * `balanced` = booked food meals that were not served (booked-absent / no-show).
 */
export function buildShiftAttendanceReport({
  shift,
  fromDate,
  toDate,
  mealDate,
  profiles,
  preferences,
  rangeBookings,
  rangeCheckins,
  dayBookings,
  dayCheckins,
  historyBookings,
  lookbackDays = 14,
  serviceClosed = true,
  skippedNoScanDates = null,
}) {
  const to = toDate || mealDate;
  const from = fromDate || to;
  const roster = profilesForShift(profiles, preferences, shift);
  const rosterIds = new Set(roster.map((profile) => profile.id));

  const rawBookings = rangeBookings || dayBookings || [];
  const rawCheckins = rangeCheckins || dayCheckins || [];

  const skippedDates =
    skippedNoScanDates ||
    findDatesSkippedForNoScan({
      fromDate: from,
      toDate: to,
      bookings: rawBookings,
      checkins: rawCheckins,
    });
  const skippedSet = new Set(skippedDates);
  const scanDates = [
    ...new Set(
      rawCheckins
        .filter((row) => row?.meal_date >= from && row?.meal_date <= to)
        .map((row) => row.meal_date)
    ),
  ].sort();

  const bookingsInRange = filterRowsToScanDates(
    rawBookings.filter(
      (booking) => booking.meal_date >= from && booking.meal_date <= to && !skippedSet.has(booking.meal_date)
    ),
    new Set(scanDates)
  );
  // If there are scan dates, only those days; if no scans at all, empty report (all days skipped).
  const checkinsInRange = filterRowsToScanDates(rawCheckins, new Set(scanDates));

  const shiftBookings = bookingsInRange.filter(
    (booking) => booking.user_id && rosterIds.has(booking.user_id)
  );
  const foodBookings = shiftBookings.filter((booking) => FOOD_CHOICES.has(booking.choice));
  const skipped = shiftBookings.filter((booking) => booking.choice === 'skip');
  // Any booking row (food or skip) counts as "responded" for not-booked roster.
  const respondedUserIds = new Set(shiftBookings.map((booking) => booking.user_id));
  const checkinByBooking = new Map(
    checkinsInRange.map((checkin) => [checkin.meal_booking_id, checkin])
  );

  const byChoice = { veg: 0, non_veg: 0, egg: 0 };
  const bookedAbsent = [];
  let served = 0;

  for (const booking of foodBookings) {
    if (booking.choice in byChoice) byChoice[booking.choice] += 1;
    const checkin = checkinByBooking.get(booking.id);
    const profile = roster.find((row) => row.id === booking.user_id);
    if (checkin?.checked_in_at) {
      served += 1;
    } else {
      bookedAbsent.push({
        user_id: booking.user_id,
        name: displayName(profile),
        email: profile?.email || null,
        employee_code: profile?.employee_code || null,
        choice: booking.choice,
        meal_date: booking.meal_date,
        status: serviceClosed ? 'no_show' : 'not_yet_served',
      });
    }
  }

  bookedAbsent.sort(
    (a, b) =>
      String(a.meal_date).localeCompare(String(b.meal_date)) || a.name.localeCompare(b.name)
  );

  const notBooked = roster
    .filter((profile) => !respondedUserIds.has(profile.id))
    .map((profile) => ({
      user_id: profile.id,
      name: displayName(profile),
      email: profile.email || null,
      employee_code: profile.employee_code || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const booked = foodBookings.length;
  const balanced = Math.max(0, booked - served);
  const history = filterRowsToScanDates(historyBookings || rawBookings, new Set(scanDates));

  return {
    shift,
    meal_date: from === to ? from : `${from}_to_${to}`,
    from_date: from,
    to_date: to,
    included_scan_dates: scanDates,
    skipped_no_scan_dates: skippedDates,
    lookback: {
      from,
      to,
      days: scanDates.length || listWeekdays(from, to).length,
      rule: 'Active users who booked a food meal on fewer than 50% of scanned working days (zero-scan days excluded)',
    },
    summary: {
      total_active: roster.length,
      booked,
      skipped: skipped.length,
      not_booked: notBooked.length,
      served,
      balanced,
      attendance_percent: booked ? Math.round((served / booked) * 10000) / 100 : 0,
      service_closed: serviceClosed,
      days_with_scanning: scanDates.length,
      days_skipped_no_scan: skippedDates.length,
    },
    by_choice: byChoice,
    irregular_bookers: findIrregularBookers({
      profiles,
      preferences,
      bookings: history,
      shift,
      fromDate: from,
      toDate: to,
      lookbackDays,
      eligibleDates: scanDates,
    }),
    booked_absent: bookedAbsent,
    not_booked: notBooked,
  };
}

export function buildMealAttendanceReports({
  fromDate,
  toDate,
  mealDate,
  lookbackDays = 14,
  profiles,
  preferences,
  rangeBookings,
  rangeCheckins,
  dayBookings,
  dayCheckins,
  historyBookings,
  dayServiceClosed = true,
  nightServiceClosed = true,
}) {
  const to = toDate || mealDate;
  const from = fromDate || to;
  const allBookings = rangeBookings || dayBookings || [];
  const allCheckins = rangeCheckins || dayCheckins || [];
  const skippedNoScanDates = findDatesSkippedForNoScan({
    fromDate: from,
    toDate: to,
    bookings: allBookings,
    checkins: allCheckins,
  });
  const shared = {
    fromDate: from,
    toDate: to,
    mealDate: to,
    lookbackDays,
    profiles,
    preferences,
    rangeBookings: allBookings,
    rangeCheckins: allCheckins,
    historyBookings: historyBookings || allBookings,
    skippedNoScanDates,
  };
  return {
    from_date: from,
    to_date: to,
    meal_date: from === to ? from : undefined,
    lookback_days: lookbackDays,
    skipped_no_scan_dates: skippedNoScanDates,
    included_scan_dates: [
      ...new Set(
        allCheckins
          .filter((row) => row?.meal_date >= from && row?.meal_date <= to)
          .map((row) => row.meal_date)
      ),
    ].sort(),
    day: buildShiftAttendanceReport({
      ...shared,
      shift: 'day',
      serviceClosed: dayServiceClosed,
    }),
    night: buildShiftAttendanceReport({
      ...shared,
      shift: 'night',
      serviceClosed: nightServiceClosed,
    }),
  };
}
