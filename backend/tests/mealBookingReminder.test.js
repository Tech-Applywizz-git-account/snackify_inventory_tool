/**
 * Focused tests for the Meal Booking Reminder functionality.
 * Run: node --test backend/tests/mealBookingReminder.test.js
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { Readable, Writable, PassThrough } from 'node:stream';
import express from 'express';
import { supabaseAdmin } from '../src/lib/supabase.js';
import cronRouter from '../src/routes/cron.js';

describe('Meal Booking Reminder Cron Endpoint', () => {
  let originalFrom;
  let originalFetch;
  let fetchCalls = [];
  let dbQueries = [];
  let originalDate;

  beforeEach(() => {
    originalFrom = supabaseAdmin.from;
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    dbQueries = [];
    originalDate = globalThis.Date;

    // Mock fetch for token exchange and email sending
    globalThis.fetch = async (url, options = {}) => {
      fetchCalls.push({ url, options });

      if (url.includes('login.microsoftonline.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'mock-access-token',
            expires_in: 3600,
          }),
        };
      }

      if (url.includes('sendMail')) {
        return {
          ok: true,
          status: 202,
          text: async () => 'Accepted',
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    };
  });

  afterEach(() => {
    supabaseAdmin.from = originalFrom;
    globalThis.fetch = originalFetch;
    globalThis.Date = originalDate;
  });

  function makeMockChain(result) {
    const chain = {};
    for (const m of [
      'select', 'update', 'delete', 'upsert',
      'eq', 'neq', 'is', 'gt', 'lt', 'gte', 'lte',
      'order', 'limit', 'not', 'or', 'filter',
    ]) {
      chain[m] = () => chain;
    }
    chain.insert = () => chain;
    chain.not = () => chain;
    chain.maybeSingle = async () => ({ data: result, error: null });
    chain.single = async () => ({ data: result, error: null });
    chain.then = (resolve) => Promise.resolve({ data: result, error: null }).then(resolve);
    return chain;
  }

  async function postToApp(app, path, body, headers = {}) {
    const payload = JSON.stringify(body);
    const req = new Readable({
      read() {
        this.push(payload);
        this.push(null);
      },
    });
    req.url = path;
    req.method = 'POST';
    req.headers = Object.fromEntries(
      Object.entries({
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload).toString(),
        ...headers,
      }).map(([key, value]) => [key.toLowerCase(), value])
    );
    const socket = new PassThrough();
    req.connection = socket;
    req.socket = socket;

    const chunks = [];
    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (key, value) => {
      res.headers[key.toLowerCase()] = value;
    };
    res.getHeader = (key) => res.headers[key.toLowerCase()];
    res.getHeaders = () => res.headers;
    res.removeHeader = (key) => {
      delete res.headers[key.toLowerCase()];
    };
    res.writeHead = (status, maybeHeaders) => {
      res.statusCode = status;
      if (maybeHeaders) {
        for (const [key, value] of Object.entries(maybeHeaders)) {
          res.setHeader(key, value);
        }
      }
      return res;
    };

    const result = await new Promise((resolve, reject) => {
      res.end = (chunk) => {
        if (chunk) chunks.push(Buffer.from(chunk));
        resolve({
          status: res.statusCode,
          bodyText: Buffer.concat(chunks).toString('utf8'),
        });
      };
      res.on('error', reject);
      app.handle(req, res, reject);
    });

    return {
      status: result.status,
      body: result.bodyText ? JSON.parse(result.bodyText) : null,
    };
  }

  it('rejects requests with invalid or missing secret', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/cron', cronRouter);

    const res = await postToApp(app, '/api/cron/meal-booking-reminder', {}, {});

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Unauthorized' });
  });

  it('skips reminder when tomorrow is not a working day', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/cron', cronRouter);

    // Mock Date so today is Friday 2026-07-10. Tomorrow is Saturday (not working day)
    globalThis.Date = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) {
          return new originalDate('2026-07-10T15:30:00+05:30');
        }
        return new originalDate(...args);
      }
    };

    const res = await postToApp(
      app,
      '/api/cron/meal-booking-reminder',
      {},
      { 'x-cron-secret': 'app_wizz_cron_secret_change_in_production' }
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.skipped, true);
    assert.match(res.body.reason, /is not a working day/);
  });

  it('sends reminder emails only to active users who have not booked for tomorrow', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/cron', cronRouter);

    // Mock Date so today is Tuesday 2026-07-07. Tomorrow is Wednesday 2026-07-08 (working day)
    globalThis.Date = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) {
          return new originalDate('2026-07-07T15:30:00+05:30');
        }
        return new originalDate(...args);
      }
    };

    // Mock profiles database response
    const mockProfiles = [
      { id: 'user-1', email: 'alice@applywizz.ai', full_name: 'Alice' },
      { id: 'user-2', email: 'bob@applywizz.ai', full_name: 'Bob' },
      { id: 'user-3', email: 'charlie@applywizz.ai', full_name: 'Charlie' },
    ];

    // Mock meal bookings database response: Alice has already booked
    const mockBookings = [
      { user_id: 'user-1' },
    ];

    supabaseAdmin.from = (table) => {
      dbQueries.push(table);
      if (table === 'profiles') {
        return makeMockChain(mockProfiles);
      }
      if (table === 'meal_bookings') {
        return makeMockChain(mockBookings);
      }
      return makeMockChain([]);
    };

    const res = await postToApp(
      app,
      '/api/cron/meal-booking-reminder',
      {},
      { 'x-cron-secret': 'app_wizz_cron_secret_change_in_production' }
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.queuedCount, 2); // Bob and Charlie should be reminded
    assert.equal(res.body.tomorrow, '2026-07-08');

    // Wait slightly to allow the fire-and-forget Promise.allSettled to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify fetch calls for email sending
    const sendMailCalls = fetchCalls.filter((c) => c.url.includes('sendMail'));
    assert.equal(sendMailCalls.length, 2);

    // Verify recipient emails
    const recipients = sendMailCalls.map((c) => JSON.parse(c.options.body).message.toRecipients[0].emailAddress.address);
    assert.ok(recipients.includes('bob@applywizz.ai'));
    assert.ok(recipients.includes('charlie@applywizz.ai'));
    assert.ok(!recipients.includes('alice@applywizz.ai'));

    // Verify funny text is included
    const bodyContent = JSON.parse(sendMailCalls[0].options.body).message.body.content;
    assert.ok(bodyContent.includes('Because "I forgot" doesn\'t taste very good.'));
  });

  it('sends final reminder emails with a warning when triggered at or after 5:15 PM IST', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/cron', cronRouter);

    // Mock Date so today is Tuesday 2026-07-07 at 17:15:00 (5:15 PM IST)
    globalThis.Date = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) {
          return new originalDate('2026-07-07T17:15:00+05:30');
        }
        return new originalDate(...args);
      }
    };

    const mockProfiles = [
      { id: 'user-2', email: 'bob@applywizz.ai', full_name: 'Bob' },
    ];
    const mockBookings = [];

    supabaseAdmin.from = (table) => {
      dbQueries.push(table);
      if (table === 'profiles') {
        return makeMockChain(mockProfiles);
      }
      if (table === 'meal_bookings') {
        return makeMockChain(mockBookings);
      }
      return makeMockChain([]);
    };

    const res = await postToApp(
      app,
      '/api/cron/meal-booking-reminder',
      {},
      { 'x-cron-secret': 'app_wizz_cron_secret_change_in_production' }
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.queuedCount, 1);

    await new Promise((resolve) => setTimeout(resolve, 150));

    const sendMailCalls = fetchCalls.filter((c) => c.url.includes('sendMail'));
    assert.equal(sendMailCalls.length, 1);
    
    // Verify subject line contains "Final Reminder"
    const subject = JSON.parse(sendMailCalls[0].options.body).message.subject;
    assert.ok(subject.includes('Final Reminder'));

    // Verify funny text is included
    const bodyContent = JSON.parse(sendMailCalls[0].options.body).message.body.content;
    assert.ok(bodyContent.includes('Because "I forgot" doesn\'t taste very good.'));
  });
});
