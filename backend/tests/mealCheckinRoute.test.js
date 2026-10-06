import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { afterEach, before, beforeEach, describe, it } from 'node:test';

process.env.MEAL_CHECKIN_QR_SECRET = 'route-test-secret-long-enough-to-sign-checkins';
process.env.MEAL_CHECKIN_SERVICE_CLOSE_IST = '00:00';

const [{ default: mealCheckinRouter }, { supabaseAdmin }, { createMealQrToken, istDateAndMinutes }] =
  await Promise.all([
    import('../src/features/mealCheckin/router.js'),
    import('../src/lib/supabase.js'),
    import('../src/features/mealCheckin/service.js'),
  ]);

const bookingId = 'a4fbb0b0-3be4-4d57-b42a-77cadd232f73';
const mealDate = istDateAndMinutes().date;
const booking = {
  id: bookingId,
  user_id: 'employee-test-user',
  choice: 'veg',
  meal_date: mealDate,
  profiles: { full_name: 'Test Employee', preferred_name: 'Test Employee', employee_code: 'EMP-TEST' },
};

describe('meal check-in routes with Supabase persistence', () => {
  let originalFrom;
  let server;
  let baseUrl;
  let actorRole = 'leadership';
  let checkins = [];

  before(async () => {
    originalFrom = supabaseAdmin.from;
  });

  beforeEach(async () => {
    actorRole = 'leadership';
    checkins = [];
    booking.meal_date = mealDate;
    supabaseAdmin.from = (table) => {
      let selectedFields = '';
      const filters = {};
      const inFilters = {};
      let upsertPayload = null;
      const chain = {
        select(fields) {
          selectedFields = fields;
          return chain;
        },
        eq(field, value) {
          filters[field] = value;
          return chain;
        },
        in(field, values) {
          inFilters[field] = values;
          return chain;
        },
        upsert(payload) {
          upsertPayload = payload;
          return chain;
        },
        order() {
          return chain;
        },
        async maybeSingle() {
          if (table === 'meal_bookings' && filters.id === bookingId) {
            const selectedBooking = Object.fromEntries(
              selectedFields.split(',').map((field) => [field.trim(), booking[field.trim()]])
            );
            return { data: selectedBooking, error: null };
          }
          if (table === 'profiles' && filters.id === booking.user_id) {
            return {
              data: {
                full_name: 'Test Employee',
                preferred_name: 'Test Employee',
                employee_code: 'EMP-TEST',
              },
              error: null,
            };
          }
          if (table === 'meal_checkins' && upsertPayload) {
            const existing = checkins.find(
              (row) => row.meal_booking_id === upsertPayload.meal_booking_id
            );
            if (existing) return { data: null, error: null };
            const inserted = {
              id: `checkin-${checkins.length + 1}`,
              ...upsertPayload,
              checked_in_at: new Date().toISOString(),
            };
            checkins.push(inserted);
            return { data: inserted, error: null };
          }
          if (table === 'meal_checkins') {
            const row = checkins.find((checkin) =>
              Object.entries(filters).every(([field, value]) => checkin[field] === value)
            );
            if (!row) return { data: null, error: null };
            const selectedRow = Object.fromEntries(
              selectedFields.split(',').map((field) => [field.trim(), row[field.trim()]])
            );
            return { data: selectedRow, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve, reject) {
          let rows = [];
          if (table === 'meal_bookings' && selectedFields === 'id, user_id, choice') {
            rows = [booking].filter((row) =>
              Object.entries(filters).every(([field, value]) => row[field] === value)
            );
          } else if (table === 'profiles') {
            rows = [{
              id: booking.user_id,
              full_name: 'Test Employee',
              preferred_name: 'Test Employee',
              employee_code: 'EMP-TEST',
            }].filter((profile) =>
              !inFilters.id || inFilters.id.includes(profile.id)
            );
          } else if (table === 'meal_checkins') {
            rows = checkins.filter((row) =>
              Object.entries(filters).every(([field, value]) => row[field] === value)
            );
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return chain;
    };

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: `${actorRole}-test-user`, role: actorRole };
      next();
    });
    app.use('/api/meal-checkin', mealCheckinRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}/api/meal-checkin`;
  });

  afterEach(async () => {
    supabaseAdmin.from = originalFrom;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('checks in a leadership-admin scan, rejects repeats, and refreshes counts', async () => {
    const initialResponse = await fetch(`${baseUrl}/summary?date=${mealDate}`);
    const initial = await initialResponse.json();
    assert.equal(initialResponse.status, 200);
    assert.equal(initial.booked, 1);
    assert.equal(initial.served, 0);
    assert.equal(initial.daily_servings.served, 0);
    assert.equal(initial.bookings[0].employee_name, 'Test Employee');
    assert.equal(initial.service_closed, true);
    assert.equal(initial.bookings[0].status, 'no_show');

    const token = createMealQrToken({
      bookingId,
      mealDate,
      secret: process.env.MEAL_CHECKIN_QR_SECRET,
    });

    const firstResponse = await fetch(`${baseUrl}/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, date: mealDate }),
    });
    const first = await firstResponse.json();
    assert.equal(firstResponse.status, 200);
    assert.equal(first.status, 'served');
    assert.equal(first.employee.name, 'Test Employee');
    assert.equal(first.employee.employee_code, 'EMP-TEST');
    assert.equal(first.employee.shift, 'day');

    const repeatResponse = await fetch(`${baseUrl}/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, date: mealDate }),
    });
    const repeat = await repeatResponse.json();
    assert.equal(repeatResponse.status, 200);
    assert.equal(repeat.status, 'already_served');
    assert.equal(repeat.already_served, true);

    const updatedResponse = await fetch(`${baseUrl}/summary?date=${mealDate}`);
    const updated = await updatedResponse.json();
    assert.equal(updated.served, 1);
    assert.equal(updated.daily_servings.served, 1);
    assert.deepEqual(updated.daily_servings.by_choice, { veg: 1, non_veg: 0, egg: 0 });
    assert.equal(updated.daily_servings.meal_date, mealDate);
    assert.equal(updated.booked, 1);
    assert.equal(updated.bookings[0].status, 'served');
    assert.equal(updated.bookings[0].checked_in_at, first.checked_in_at);
    assert.equal(checkins.length, 1);
    assert.equal(checkins[0].meal_booking_id, bookingId);
    assert.equal(checkins[0].checked_in_by, 'leadership-test-user');
  });

  it('allows vendor accounts to open meal check-in summaries', async () => {
    actorRole = 'vendor';

    const response = await fetch(`${baseUrl}/summary?date=${mealDate}`);
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.booked, 1);
  });

  it('allows office-boy and admin roles to access check-in summaries and scans', async () => {
    const token = createMealQrToken({
      bookingId,
      mealDate,
      secret: process.env.MEAL_CHECKIN_QR_SECRET,
    });

    for (const role of ['office_boy', 'admin']) {
      actorRole = role;

      const summaryResponse = await fetch(`${baseUrl}/summary?date=${mealDate}`);
      assert.equal(summaryResponse.status, 200, `${role} can view the check-in summary`);

      const scanResponse = await fetch(`${baseUrl}/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, date: mealDate }),
      });
      assert.equal(scanResponse.status, 200, `${role} can scan a meal token`);
    }
  });

  it('returns a summary for a previous service date', async () => {
    const previousDay = new Date(`${mealDate}T00:00:00.000Z`);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const previousDate = previousDay.toISOString().slice(0, 10);
    booking.meal_date = previousDate;
    checkins.push({
      meal_booking_id: bookingId,
      meal_date: previousDate,
      meal_choice: 'veg',
      checked_in_at: `${previousDate}T06:30:00.000Z`,
      checked_in_by: 'office-boy-test-user',
    });

    const response = await fetch(`${baseUrl}/summary?date=${previousDate}`);
    const summary = await response.json();

    assert.equal(response.status, 200);
    assert.equal(summary.meal_date, previousDate);
    assert.equal(summary.booked, 1);
    assert.equal(summary.served, 1);
    assert.equal(summary.daily_servings.meal_date, previousDate);
    assert.equal(summary.daily_servings.served, 1);
    assert.equal(summary.daily_servings.by_choice.veg, 1);
    assert.equal(summary.bookings[0].status, 'served');
    assert.equal(summary.bookings[0].checked_in_at, `${previousDate}T06:30:00.000Z`);
  });
});