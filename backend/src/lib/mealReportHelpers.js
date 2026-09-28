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

  const bookedCount =
    counts.veg + counts.non_veg + counts.egg + Object.values(others).reduce((sum, count) => sum + count, 0);
  return { counts, others, bookedCount, skippedCount: counts.skip };
}

export function buildNightShiftReportData(bookings, preferences, dateLabel, activeProfiles = []) {
  const nightShiftUserIds = new Set(
    (preferences || [])
      .filter((preference) => preference.shift === 'night')
      .map((preference) => preference.user_id)
  );
  const nightShiftBookings = filterNightMealBookings(bookings, preferences);
  const { counts, others, bookedCount, skippedCount } = countMealBookings(nightShiftBookings);

  const bookedUserIds = new Set(
    (nightShiftBookings || []).map((booking) => booking.user_id).filter(Boolean)
  );
  const nightShiftProfiles = (activeProfiles || []).filter((profile) => nightShiftUserIds.has(profile.id));
  const unbookedUsers = nightShiftProfiles.filter((profile) => !bookedUserIds.has(profile.id));
  const unbookedNames = unbookedUsers
    .map((profile) => profile.full_name || profile.email || 'Unknown')
    .sort((a, b) => a.localeCompare(b));

  return {
    counts,
    others,
    bookedCount,
    skippedCount,
    totalNotBooked: unbookedUsers.length,
    unbookedNames,
    dateLabel,
  };
}

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

  return [
    ...new Set(
      (activeProfiles || [])
        .filter((profile) => profile.email && allowedRoles.has(profile.role))
        .map((profile) => profile.email)
    ),
  ];
}
