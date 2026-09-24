import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNightShiftReportData,
  countMealBookings,
  filterDayMealBookings,
  filterNightMealBookings,
  getISTDateString,
  getNextWorkingMealDate,
  resolveBookingCabin,
} from '../src/routes/cron.js';

test('11 AM meal printing excludes night-shift bookings', () => {
  const bookings = [
    { id: 'day-booking', user_id: 'day-user' },
    { id: 'night-booking', user_id: 'night-user' },
    { id: 'default-day-booking', user_id: 'default-day-user' },
  ];
  const preferences = [
    { user_id: 'day-user', shift: 'morning' },
    { user_id: 'night-user', shift: 'night' },
  ];

  assert.deepEqual(
    filterDayMealBookings(bookings, preferences).map((booking) => booking.id),
    ['day-booking', 'default-day-booking']
  );
});

test('assigned cabin setting takes precedence over a stale booking cabin', () => {
  assert.equal(resolveBookingCabin('Pantry Counter', 'Anusha Cabin'), 'Anusha Cabin');
  assert.equal(resolveBookingCabin('Pantry Counter', null), 'Pantry Counter');
});

test('normalizes renamed cabins for existing bookings and settings', () => {
  assert.equal(resolveBookingCabin('Rama Krishna Cabin', null), 'R.K Cabin');
  assert.equal(resolveBookingCabin('Manisha Cabin', null), 'Durga Sri Manisha Cabin');
  assert.equal(resolveBookingCabin(null, 'Rama Krishna Cabin'), 'R.K Cabin');
  assert.equal(resolveBookingCabin(null, 'Manisha Cabin'), 'Durga Sri Manisha Cabin');
});

test('night-shift report includes only explicitly booked night-shift users', () => {
  const bookings = [
    { user_id: 'day-user', choice: 'veg' },
    { user_id: 'night-user', choice: 'non_veg' },
    { user_id: 'night-skip-user', choice: 'skip' },
  ];
  const preferences = [
    { user_id: 'day-user', shift: 'morning' },
    { user_id: 'night-user', shift: 'night' },
    { user_id: 'night-skip-user', shift: 'night' },
  ];

  const result = countMealBookings(filterNightMealBookings(bookings, preferences));

  assert.deepEqual(result.counts, { veg: 0, non_veg: 1, egg: 0, skip: 1 });
  assert.equal(result.bookedCount, 1);
  assert.equal(result.skippedCount, 1);
});

test('night-shift count reflects unique registered users even if the same user has duplicate booking rows', () => {
  const bookings = [
    { user_id: 'night-user-1', choice: 'veg' },
    { user_id: 'night-user-1', choice: 'veg' },
    { user_id: 'night-user-2', choice: 'non_veg' },
    { user_id: 'night-user-3', choice: 'skip' },
    { user_id: 'night-user-3', choice: 'skip' },
  ];
  const preferences = [
    { user_id: 'night-user-1', shift: 'night' },
    { user_id: 'night-user-2', shift: 'night' },
    { user_id: 'night-user-3', shift: 'night' },
  ];

  const result = countMealBookings(filterNightMealBookings(bookings, preferences));

  assert.deepEqual(result.counts, { veg: 1, non_veg: 1, egg: 0, skip: 1 });
  assert.equal(result.bookedCount, 2);
  assert.equal(result.skippedCount, 1);
});

test('night-shift report payload excludes day-shift users and includes email-ready totals', () => {
  const bookings = [
    { user_id: 'day-user', choice: 'veg' },
    { user_id: 'night-user-1', choice: 'veg' },
    { user_id: 'night-user-1', choice: 'non_veg' },
    { user_id: 'night-user-2', choice: 'skip' },
    { user_id: 'night-user-2', choice: 'skip' },
  ];
  const preferences = [
    { user_id: 'day-user', shift: 'morning' },
    { user_id: 'night-user-1', shift: 'night' },
    { user_id: 'night-user-2', shift: 'night' },
  ];

  const result = buildNightShiftReportData(bookings, preferences, 'Thursday, 25 September 2026');

  assert.deepEqual(result.counts, { veg: 0, non_veg: 1, egg: 0, skip: 1 });
  assert.equal(result.bookedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.totalNotBooked, 0);
  assert.equal(result.unbookedNames.length, 0);
});

test('night-shift report resolves the current report date in IST', () => {
  const utcDate = new Date('2026-09-21T18:45:00.000Z');

  assert.equal(getISTDateString(utcDate), '2026-09-22');
});

test('night-shift report sent today counts the next working day meal', () => {
  const mondayNight = new Date('2026-09-21T16:45:00.000Z');
  const fridayNight = new Date('2026-09-25T16:45:00.000Z');

  assert.equal(getNextWorkingMealDate(mondayNight), '2026-09-22');
  assert.equal(getNextWorkingMealDate(fridayNight), '2026-09-28');
});