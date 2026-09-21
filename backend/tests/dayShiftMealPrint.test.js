import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDayMealBookings, resolveBookingCabin } from '../src/routes/cron.js';

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