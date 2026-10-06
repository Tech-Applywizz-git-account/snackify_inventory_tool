import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createMealQrToken,
  attachMealCheckins,
  filterBookingsByShift,
  isMealServiceClosed,
  registerMealCheckin,
  summarizeDailyServings,
  summarizeMealBookings,
  verifyMealQrToken,
} from '../src/features/mealCheckin/service.js';

const secret = 'meal-checkin-test-secret-which-is-long-enough';
const bookingId = 'a4fbb0b0-3be4-4d57-b42a-77cadd232f73';

describe('meal check-in domain', () => {
  it('signs an opaque booking/date token and rejects tampering', () => {
    const token = createMealQrToken({ bookingId, mealDate: '2026-10-02', secret });
    assert.deepEqual(verifyMealQrToken(token, secret), { bookingId, mealDate: '2026-10-02' });
    assert.equal(verifyMealQrToken(`${token}x`, secret), null);
    assert.equal(token.includes('employee'), false);
  });

  it('rejects invalid tokens and QR codes for a different service date', async () => {
    let calls = 0;
    const repository = { checkInMeal: async () => { calls += 1; return { status: 'served' }; } };
    const token = createMealQrToken({ bookingId, mealDate: '2026-10-02', secret });

    assert.deepEqual(await registerMealCheckin({
      token: 'invalid', selectedDate: '2026-10-02', todayDate: '2026-10-02', actorId: 'vendor', secret, repository,
    }), { status: 'invalid_token' });
    assert.deepEqual(await registerMealCheckin({
      token, selectedDate: '2026-10-03', todayDate: '2026-10-03', actorId: 'vendor', secret, repository,
    }), { status: 'wrong_date' });
    assert.deepEqual(await registerMealCheckin({
      token, selectedDate: '2026-10-02', todayDate: '2026-10-03', actorId: 'vendor', secret, repository,
    }), { status: 'wrong_date' });
    assert.equal(calls, 0);
  });

  it('returns the database eligibility and duplicate outcomes without recounting', async () => {
    const token = createMealQrToken({ bookingId, mealDate: '2026-10-02', secret });
    for (const expected of ['skipped', 'already_served']) {
      const result = await registerMealCheckin({
        token,
        selectedDate: '2026-10-02',
        todayDate: '2026-10-02',
        actorId: 'vendor',
        secret,
        repository: { checkInMeal: async () => ({ status: expected }) },
      });
      assert.equal(result.status, expected);
    }
  });

  it('counts only eligible bookings and defers no-shows until the cutoff', () => {
    const bookings = [
      { choice: 'veg', meal_checkins: [{ checked_in_at: '2026-10-02T06:00:00Z' }] },
      { choice: 'non_veg', meal_checkins: [] },
      { choice: 'egg', meal_checkins: null },
      { choice: 'skip', meal_checkins: null },
    ];
    const beforeClose = new Date('2026-10-02T07:00:00Z');
    const afterClose = new Date('2026-10-02T09:00:00Z');

    assert.equal(isMealServiceClosed('2026-10-02', beforeClose), false);
    assert.deepEqual(summarizeMealBookings(bookings, { mealDate: '2026-10-02', now: beforeClose }), {
      meal_date: '2026-10-02',
      booked: 3,
      served: 1,
      not_yet_served: 2,
      no_show: 0,
      attendance_percent: 33.33,
      service_closed: false,
      by_choice: { veg: 1, non_veg: 1, egg: 1 },
    });

    const closed = summarizeMealBookings(bookings, { mealDate: '2026-10-02', now: afterClose });
    assert.equal(closed.not_yet_served, 0);
    assert.equal(closed.no_show, 2);
    assert.equal(closed.service_closed, true);
  });

  it('keeps night-shift service open through the selected date and closes at next midnight', () => {
    const beforeMidnight = new Date('2026-10-02T18:29:00.000Z'); // 23:59 IST on Oct 2
    const atMidnight = new Date('2026-10-02T18:30:00.000Z'); // 00:00 IST on Oct 3

    assert.equal(isMealServiceClosed('2026-10-02', beforeMidnight, '24:00'), false);
    assert.equal(isMealServiceClosed('2026-10-02', atMidnight, '24:00'), true);
  });

  it('joins check-in records by booking id without relying on database relationships', () => {
    const bookings = [{ id: 'booking-a', choice: 'veg' }, { id: 'booking-b', choice: 'egg' }];
    const checkins = [{ meal_booking_id: 'booking-a', checked_in_at: '2026-10-02T06:00:00Z' }];
    assert.deepEqual(attachMealCheckins(bookings, checkins), [
      { id: 'booking-a', choice: 'veg', meal_checkins: [checkins[0]] },
      { id: 'booking-b', choice: 'egg', meal_checkins: [] },
    ]);
  });

  it('separates vendor report bookings by saved day and night shift', () => {
    const bookings = [
      { id: 'day-booking', user_id: 'day-user' },
      { id: 'night-booking', user_id: 'night-user' },
      { id: 'default-booking', user_id: 'default-user' },
    ];
    const preferences = [
      { user_id: 'day-user', shift: 'morning' },
      { user_id: 'night-user', shift: 'night' },
    ];

    assert.deepEqual(
      filterBookingsByShift(bookings, preferences, 'day').map(({ id }) => id),
      ['day-booking', 'default-booking']
    );
    assert.deepEqual(
      filterBookingsByShift(bookings, preferences, 'night').map(({ id }) => id),
      ['night-booking']
    );
    assert.deepEqual(filterBookingsByShift(bookings, preferences, 'all'), bookings);
  });

  it('summarizes persisted check-ins for the requested date', () => {
    assert.deepEqual(
      summarizeDailyServings(
        [
          { meal_date: '2026-10-02', meal_choice: 'veg', checked_in_at: '2026-10-02T06:00:00.000Z' },
          { meal_date: '2026-10-02', meal_choice: 'egg', checked_in_at: '2026-10-02T06:30:00.000Z' },
          { meal_date: '2026-10-03', meal_choice: 'non_veg', checked_in_at: '2026-10-03T06:00:00.000Z' },
        ],
        '2026-10-02'
      ),
      {
        meal_date: '2026-10-02',
        served: 2,
        by_choice: { veg: 1, non_veg: 0, egg: 1 },
        last_served_at: '2026-10-02T06:30:00.000Z',
      }
    );
  });
});