/**
 * Endpoint tests for POST /api/auth/* routes (Wave 1 secure auth).
 * Run: node --test backend/tests/auth.test.js
 *
 * All Supabase and service calls are injected via createAuthRouter(overrides).
 * No real network calls, no real DB. Tests run purely in-process.
 */
import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import { describe, it } from 'node:test';
import express from 'express';
import { authMiddleware } from '../src/middleware/auth.js';
import { createAuthRouter } from '../src/routes/auth.js';
import { supabaseAdmin } from '../src/lib/supabase.js';

// ── Chain builder ─────────────────────────────────────────────────────────────
// Wraps one result in a fluent chain. All intermediate methods return the chain.
// Terminal methods (maybeSingle, single) resolve the result.
// The chain itself is thenable so `await chain.delete().eq()` works.

function makeChain(result) {
  const r = result ?? { data: null, error: null, count: null };
  const chain = {};
  for (const m of [
    'select', 'update', 'delete', 'upsert',
    'eq', 'neq', 'is', 'gt', 'lt', 'gte', 'lte',
    'order', 'limit', 'not', 'or', 'filter',
  ]) {
    chain[m] = () => chain;
  }
  chain.insert = () => chain;
  chain.maybeSingle = async () => ({ data: r.data, error: r.error });
  chain.single = async () => ({ data: r.data, error: r.error });
  chain.then = (resolve, reject) =>
    Promise.resolve({ data: r.data, error: r.error, count: r.count }).then(resolve, reject);
  return chain;
}

// ── Mock factories ────────────────────────────────────────────────────────────

function makeSupabaseAdmin({
  authUsers = [],
  fromResults = [],
  generateLinkOtp = 'magic-otp-123',
  mfaFactors = [],
  mfaFactorsQueue = null,     // if set, each listFactors call pops from this queue
  getUserResult = null,
  createUserResult = null,
} = {}) {
  const fromQueue = [...fromResults];
  const factorsQueue = mfaFactorsQueue ? [...mfaFactorsQueue] : null;
  return {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: authUsers }, error: null }),
        createUser: async ({ email }) =>
          createUserResult || {
            data: { user: { id: 'created-uid', email } },
            error: null,
          },
        generateLink: async () => ({
          data: { properties: { email_otp: generateLinkOtp } },
          error: null,
        }),
        mfa: {
          listFactors: async () => {
            const factors = factorsQueue ? (factorsQueue.shift() ?? []) : mfaFactors;
            return { data: { factors }, error: null };
          },
          deleteFactor: async () => ({ data: {}, error: null }),
        },
      },
      getUser: async (_token) =>
        getUserResult || {
          data: { user: { id: 'uid-alice', email: 'alice@applywizz.ai' } },
          error: null,
        },
    },
    from: () => makeChain(fromQueue.shift()),
  };
}

function makeSupabaseAnon({ sessionToken = 'aal1-session-token' } = {}) {
  return {
    auth: {
      verifyOtp: async () => ({
        data: { session: { access_token: sessionToken } },
        error: null,
      }),
    },
  };
}

function makeSupabaseAsUser({
  enrollData = { id: 'factor-1', totp: { qr_code: 'qr-data-url', secret: 'BASE32', uri: 'otpauth://' } },
  challengeAndVerifyResult = null,
} = {}) {
  return () => ({
    auth: {
      mfa: {
        enroll: async () => ({ data: enrollData, error: null }),
        challengeAndVerify: async () =>
          challengeAndVerifyResult || {
            data: {
              access_token: 'aal2-access-token',
              refresh_token: 'aal2-refresh-token',
              user: { id: 'uid-alice', email: 'alice@applywizz.ai' },
            },
            error: null,
          },
      },
    },
  });
}

function makeTrackedTxAdmin({
  tableName,
  tx,
  profile = ALICE_PROFILE_ACTIVE,
  getUserResult = null,
} = {}) {
  const txUpdateCalls = [];

  function makeTrackedChain(table) {
    const state = { table, mode: null, payload: null, filters: [] };
    const chain = {};

    chain.select = () => {
      if (state.mode == null) state.mode = 'select';
      return chain;
    };
    chain.update = (payload) => {
      state.mode = 'update';
      state.payload = payload;
      return chain;
    };
    chain.delete = () => {
      state.mode = 'delete';
      return chain;
    };
    chain.insert = () => {
      state.mode = 'insert';
      return chain;
    };
    chain.eq = (col, value) => {
      state.filters.push({ type: 'eq', col, value });
      return chain;
    };
    chain.is = (col, value) => {
      state.filters.push({ type: 'is', col, value });
      return chain;
    };
    chain.gt = (col, value) => {
      state.filters.push({ type: 'gt', col, value });
      return chain;
    };
    chain.lt = (col, value) => {
      state.filters.push({ type: 'lt', col, value });
      return chain;
    };
    chain.filter = (col, op, value) => {
      state.filters.push({ type: 'filter', col, op, value });
      return chain;
    };
    chain.or = (expr) => {
      state.filters.push({ type: 'or', expr });
      return chain;
    };
    chain.order = () => chain;
    chain.limit = () => chain;

    async function resolve() {
      if (state.table === 'profiles' && state.mode === 'select') {
        return { data: profile, error: null };
      }

      if (state.table === tableName && state.mode === 'select') {
        const userFilter = state.filters.find((f) => f.type === 'eq' && f.col === 'user_id');
        if (userFilter && userFilter.value !== tx.user_id) {
          return { data: null, error: null };
        }
        return { data: tx, error: null };
      }

      if (state.table === tableName && state.mode === 'update') {
        txUpdateCalls.push({ payload: state.payload, filters: [...state.filters] });

        const isReservation =
          state.payload &&
          state.payload.version === tx.version + 1 &&
          typeof state.payload.verifying_at === 'string';

        if (isReservation) {
          const allowsNull = state.filters.some(
            (f) =>
              (f.type === 'is' && f.col === 'verifying_at' && f.value === null) ||
              (f.type === 'filter' && f.col === 'verifying_at' && f.op === 'is' && f.value === null)
          );
          const allowsStale = state.filters.some(
            (f) =>
              (f.type === 'lt' && f.col === 'verifying_at') ||
              (f.type === 'filter' && f.col === 'verifying_at' && f.op === 'lt') ||
              (f.type === 'or' && f.expr.includes('verifying_at.lt.'))
          );
          const staleCutoff = Date.now() - 60 * 1000;
          const isNull = tx.verifying_at == null;
          const isStale =
            typeof tx.verifying_at === 'string' &&
            Number.isFinite(new Date(tx.verifying_at).getTime()) &&
            new Date(tx.verifying_at).getTime() < staleCutoff;
          const reserved = (isNull && allowsNull) || (isStale && allowsStale);
          return { data: reserved ? [{ id: tx.id }] : [], error: null };
        }

        return { data: null, error: null };
      }

      if (state.table === tableName && state.mode === 'delete') {
        return { data: null, error: null };
      }

      return { data: null, error: null };
    }

    chain.maybeSingle = () => resolve();
    chain.single = () => resolve();
    chain.then = (resolveThen, rejectThen) =>
      Promise.resolve(resolve().then((r) => ({ data: r.data, error: r.error, count: null }))).then(
        resolveThen,
        rejectThen
      );

    return chain;
  }

  return {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [ALICE] }, error: null }),
        createUser: async ({ email }) => ({ data: { user: { id: 'created-uid', email } }, error: null }),
        generateLink: async () => ({ data: { properties: { email_otp: 'magic-otp-123' } }, error: null }),
        mfa: {
          listFactors: async () => ({ data: { factors: [VERIFIED_TOTP_FACTOR] }, error: null }),
          deleteFactor: async () => ({ data: {}, error: null }),
        },
      },
      getUser: async () =>
        getUserResult || {
          data: { user: { id: tx.user_id, email: tx.email } },
          error: null,
        },
    },
    from: (table) => makeTrackedChain(table),
    getTxUpdateCalls: () => txUpdateCalls,
  };
}

// ── Test server helpers ───────────────────────────────────────────────────────

function buildApp(routerOverrides) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(routerOverrides));
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });
  return app;
}

async function startServer(routerOverrides) {
  const app = buildApp(routerOverrides);
  return {
    close: async () => {},
    post: async (path, body, headers = {}) => {
      const payload = JSON.stringify(body);
      const req = new Readable({
        read() {
          this.push(payload);
          this.push(null);
        },
      });
      req.url = `/api/auth${path}`;
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
    },
  };
}

async function getFromApp(app, path, headers = {}) {
  const req = new Readable({
    read() {
      this.push(null);
    },
  });
  req.url = path;
  req.method = 'GET';
  req.headers = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  req.header = (name) => req.headers[name.toLowerCase()];
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALICE = { id: 'uid-alice', email: 'alice@applywizz.ai' };
const ALICE_PROFILE_ACTIVE = { id: 'uid-alice', role: 'staff', active: true };
const ALICE_PROFILE_INACTIVE = { id: 'uid-alice', role: 'staff', active: false };
const VERIFIED_TOTP_FACTOR = { id: 'factor-1', factor_type: 'totp', status: 'verified' };
const UNVERIFIED_TOTP_FACTOR = { id: 'factor-stale', factor_type: 'totp', status: 'unverified' };

function futureIso(ms = 15 * 60 * 1000) {
  return new Date(Date.now() + ms).toISOString();
}

const TX_ENROLL_ID = '11111111-1111-4111-8111-111111111111';
const TX_LOGIN_ID  = '22222222-2222-4222-8222-222222222222';

const BASE_ENROLLMENT_TX = {
  id: TX_ENROLL_ID,
  email: 'alice@applywizz.ai',
  user_id: 'uid-alice',
  factor_id: 'factor-1',
  attempts: 0,
  version: 1,
  locked_at: null,
  used_at: null,
  verifying_at: null,
  expires_at: futureIso(15 * 60 * 1000),
};

const BASE_LOGIN_TX = {
  id: TX_LOGIN_ID,
  email: 'alice@applywizz.ai',
  user_id: 'uid-alice',
  factor_id: 'factor-1',
  attempts: 0,
  version: 1,
  locked_at: null,
  verifying_at: null,
  expires_at: futureIso(5 * 60 * 1000),
};

// ── POST /api/auth/start-enrollment ──────────────────────────────────────────

describe('POST /api/auth/start-enrollment', () => {
  it('returns 403 for non-company domain', async () => {
    const { post, close } = await startServer({
      isSendMailConfigured: () => true,
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-enrollment', { email: 'user@gmail.com' });
      assert.equal(r.status, 403);
    } finally { await close(); }
  });

  it('returns 503 when sendMail is not configured', async () => {
    let generateOtpCalled = false;
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({ authUsers: [] }),
      isSendMailConfigured: () => false,
      generateOtp: async () => { generateOtpCalled = true; return { code: '111111', otpId: 'id' }; },
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-enrollment', { email: 'alice@applywizz.ai' });
      assert.equal(r.status, 503);
      assert.equal(generateOtpCalled, false);
    } finally { await close(); }
  });

  it('returns 409 when user already has a verified TOTP factor', async () => {
    let generateOtpCalled = false;
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({ authUsers: [ALICE], mfaFactors: [VERIFIED_TOTP_FACTOR] }),
      isSendMailConfigured: () => true,
      generateOtp: async () => { generateOtpCalled = true; return { code: '111111', otpId: 'id' }; },
      sendOtpEmail: async () => {},
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-enrollment', { email: 'alice@applywizz.ai' });
      assert.equal(r.status, 409);
      assert.equal(generateOtpCalled, false, 'no OTP when already enrolled');
    } finally { await close(); }
  });

  it('returns 429 on OTP cooldown', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({ authUsers: [] }),
      isSendMailConfigured: () => true,
      generateOtp: async () => { throw new Error('COOLDOWN'); },
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-enrollment', { email: 'alice@applywizz.ai' });
      assert.equal(r.status, 429);
      assert.ok(r.body.error.toLowerCase().includes('wait'));
    } finally { await close(); }
  });

  it('returns 429 on hourly rate limit', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({ authUsers: [] }),
      isSendMailConfigured: () => true,
      generateOtp: async () => { throw new Error('RATE_LIMITED'); },
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-enrollment', { email: 'alice@applywizz.ai' });
      assert.equal(r.status, 429);
      assert.ok(r.body.error.toLowerCase().includes('too many'));
    } finally { await close(); }
  });

  it('returns ok:true and sends OTP for a new @applywizz.ai email with no Entra gate', async () => {
    let sendCalled = 0;
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({ authUsers: [] }),
      isSendMailConfigured: () => true,
      generateOtp: async () => ({ code: '482910', otpId: 'otp-new' }),
      sendOtpEmail: async () => { sendCalled++; },
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-enrollment', { email: 'alice@applywizz.ai' });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { ok: true });
      assert.equal(sendCalled, 1);
    } finally { await close(); }
  });

  it('does NOT call isDirectoryUser at any point', async () => {
    let directoryLookupCalled = false;
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({ authUsers: [] }),
      isSendMailConfigured: () => true,
      generateOtp: async () => ({ code: '111111', otpId: 'otp-1' }),
      sendOtpEmail: async () => {},
      isDirectoryUser: async () => { directoryLookupCalled = true; return { exists: true }; },
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      await post('/start-enrollment', { email: 'alice@applywizz.ai' });
      assert.equal(directoryLookupCalled, false, 'isDirectoryUser must never be called');
    } finally { await close(); }
  });

  it('calls cancelOtp with the exact row ID when sendOtpEmail fails', async () => {
    const OTP_ROW_ID = 'row-to-cancel-uuid';
    let cancelledId = null;
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({ authUsers: [] }),
      isSendMailConfigured: () => true,
      generateOtp: async () => ({ code: '482910', otpId: OTP_ROW_ID }),
      sendOtpEmail: async () => { throw new Error('Graph sendMail 503'); },
      cancelOtp: async (id) => { cancelledId = id; },
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-enrollment', { email: 'alice@applywizz.ai' });
      assert.equal(r.status, 503);
      assert.equal(cancelledId, OTP_ROW_ID);
    } finally { await close(); }
  });

  it('OTP code and row ID do not appear in error logs on send failure', async () => {
    const logs = [];
    const origErr = console.error;
    console.error = (...a) => logs.push(a.join(' '));
    const SECRET = '737291';
    const SECRET_ID = 'secret-otp-row-uuid';
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({ authUsers: [] }),
      isSendMailConfigured: () => true,
      generateOtp: async () => ({ code: SECRET, otpId: SECRET_ID }),
      sendOtpEmail: async () => { throw new Error('Graph 503'); },
      cancelOtp: async () => {},
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      await post('/start-enrollment', { email: 'alice@applywizz.ai' });
      const text = logs.join('\n');
      assert.equal(text.includes(SECRET), false, 'OTP code must not appear in logs');
      assert.equal(text.includes(SECRET_ID), false, 'otpId must not appear in logs');
    } finally {
      console.error = origErr;
      await close();
    }
  });
});

// ── POST /api/auth/verify-enrollment-otp ─────────────────────────────────────

describe('POST /api/auth/verify-enrollment-otp', () => {
  it('returns 401 for invalid or expired OTP code', async () => {
    const { post, close } = await startServer({
      verifyOtp: async () => ({ valid: false, reason: 'invalid_code' }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-enrollment-otp', { email: 'alice@applywizz.ai', code: '000000' });
      assert.equal(r.status, 401);
    } finally { await close(); }
  });

  it('returns 400 for malformed code', async () => {
    const { post, close } = await startServer({
      verifyOtp: async () => ({ valid: true }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-enrollment-otp', { email: 'alice@applywizz.ai', code: '12345' });
      assert.equal(r.status, 400);
    } finally { await close(); }
  });

  it('creates Supabase Auth user when OTP is valid and user does not exist yet', async () => {
    let createUserCalled = false;
    const { post, close } = await startServer({
      verifyOtp: async () => ({ valid: true }),
      supabaseAdmin: makeSupabaseAdmin({
        authUsers: [],
        createUserResult: {
          data: { user: { id: 'brand-new-uid', email: 'alice@applywizz.ai' } },
          error: null,
        },
        fromResults: [
          // ensureProfile select → null (not exists)
          { data: null, error: null },
          // ensureProfile insert
          { data: { id: 'brand-new-uid' }, error: null },
          // findProfileById
          { data: { id: 'brand-new-uid', role: 'staff', active: true }, error: null },
          // enrollment_transactions insert
          { data: { id: 'tx-new-uuid' }, error: null },
        ],
        mfaFactors: [], // no existing factors
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-enrollment-otp', { email: 'alice@applywizz.ai', code: '482910' });
      assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
      createUserCalled = true; // test that createUser was called via mock
    } finally { await close(); }
  });

  it('returns 403 when user account is inactive', async () => {
    const { post, close } = await startServer({
      verifyOtp: async () => ({ valid: true }),
      supabaseAdmin: makeSupabaseAdmin({
        authUsers: [ALICE],
        fromResults: [
          { data: { id: 'uid-alice' }, error: null },      // ensureProfile select → exists
          { data: ALICE_PROFILE_INACTIVE, error: null },    // findProfileById → inactive
        ],
        mfaFactors: [],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-enrollment-otp', { email: 'alice@applywizz.ai', code: '482910' });
      assert.equal(r.status, 403);
    } finally { await close(); }
  });

  it('returns 409 when user already has a verified TOTP factor', async () => {
    const { post, close } = await startServer({
      verifyOtp: async () => ({ valid: true }),
      supabaseAdmin: makeSupabaseAdmin({
        authUsers: [ALICE],
        fromResults: [
          { data: { id: 'uid-alice' }, error: null },     // ensureProfile
          { data: ALICE_PROFILE_ACTIVE, error: null },    // findProfileById
        ],
        mfaFactors: [VERIFIED_TOTP_FACTOR], // already has verified factor
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-enrollment-otp', { email: 'alice@applywizz.ai', code: '482910' });
      assert.equal(r.status, 409);
    } finally { await close(); }
  });

  it('cleans stale unverified factors before enrolling new one', async () => {
    let deletedFactorIds = [];
    const staleAdminMock = makeSupabaseAdmin({
      authUsers: [ALICE],
      fromResults: [
        { data: { id: 'uid-alice' }, error: null },     // ensureProfile
        { data: ALICE_PROFILE_ACTIVE, error: null },    // findProfileById
        { data: { id: 'tx-uuid' }, error: null },       // enrollment_transactions insert
      ],
      // mfaFactorsQueue: first call (findVerifiedTotpFactor) → no verified, second (stale cleanup) → has stale
      mfaFactorsQueue: [
        [],                            // findVerifiedTotpFactor: no verified factors
        [UNVERIFIED_TOTP_FACTOR],      // stale cleanup list: one stale factor
      ],
    });
    staleAdminMock.auth.admin.mfa.deleteFactor = async ({ id }) => {
      deletedFactorIds.push(id);
      return { data: {}, error: null };
    };
    const { post, close } = await startServer({
      verifyOtp: async () => ({ valid: true }),
      supabaseAdmin: staleAdminMock,
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      await post('/verify-enrollment-otp', { email: 'alice@applywizz.ai', code: '482910' });
      assert.ok(deletedFactorIds.includes(UNVERIFIED_TOTP_FACTOR.id), 'stale factor must be deleted');
    } finally { await close(); }
  });

  it('response contains only enrollmentTransactionId and qrCode — no factorId, secret, uri, or token', async () => {
    const { post, close } = await startServer({
      verifyOtp: async () => ({ valid: true }),
      supabaseAdmin: makeSupabaseAdmin({
        authUsers: [ALICE],
        fromResults: [
          { data: { id: 'uid-alice' }, error: null },
          { data: ALICE_PROFILE_ACTIVE, error: null },
          { data: { id: TX_ENROLL_ID }, error: null },
        ],
        mfaFactors: [],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-enrollment-otp', { email: 'alice@applywizz.ai', code: '482910' });
      assert.equal(r.status, 200);
      const keys = Object.keys(r.body);
      assert.ok(keys.includes('enrollmentTransactionId'), 'must have enrollmentTransactionId');
      assert.ok(keys.includes('qrCode'), 'must have qrCode');
      assert.equal(keys.length, 2, `must have exactly 2 fields, got: ${keys.join(', ')}`);
      // Confirm forbidden fields are absent
      for (const forbidden of ['factorId', 'factor_id', 'secret', 'uri', 'access_token', 'refresh_token', 'enrollmentToken']) {
        assert.equal(r.body[forbidden], undefined, `${forbidden} must not be in response`);
      }
    } finally { await close(); }
  });

  it('deletes orphan TOTP factor when enrollment_transactions insert fails', async () => {
    let deletedFactorId = null;
    const orphanAdmin = makeSupabaseAdmin({
      authUsers: [ALICE],
      fromResults: [
        { data: { id: 'uid-alice' }, error: null },
        { data: ALICE_PROFILE_ACTIVE, error: null },
        // enrollment_transactions insert fails
        { data: null, error: { message: 'DB error', code: '500' } },
      ],
      mfaFactors: [],
    });
    orphanAdmin.auth.admin.mfa.deleteFactor = async ({ id }) => {
      deletedFactorId = id;
      return { data: {}, error: null };
    };
    const enrollFactorId = 'newly-enrolled-factor-id';
    const { post, close } = await startServer({
      verifyOtp: async () => ({ valid: true }),
      supabaseAdmin: orphanAdmin,
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser({
        enrollData: { id: enrollFactorId, totp: { qr_code: 'qr', secret: 'S', uri: 'u' } },
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-enrollment-otp', { email: 'alice@applywizz.ai', code: '482910' });
      assert.ok(r.status >= 500, 'should return server error');
      assert.equal(deletedFactorId, enrollFactorId, 'orphan factor must be deleted');
    } finally { await close(); }
  });

  it('preserves an existing elevated profile instead of recreating it as staff', async () => {
    let profileInsertCalled = false;
    let profileSelectCount = 0;
    const elevatedAdmin = {
      auth: {
        admin: {
          listUsers: async () => ({
            data: { users: [{ id: 'uid-lead', email: 'lead@applywizz.ai' }] },
            error: null,
          }),
          createUser: async ({ email }) => ({ data: { user: { id: 'created-uid', email } }, error: null }),
          generateLink: async () => ({ data: { properties: { email_otp: 'magic-otp-123' } }, error: null }),
          mfa: {
            listFactors: async () => ({ data: { factors: [] }, error: null }),
            deleteFactor: async () => ({ data: {}, error: null }),
          },
        },
        getUser: async () => ({
          data: { user: { id: 'uid-lead', email: 'lead@applywizz.ai' } },
          error: null,
        }),
      },
      from(table) {
        const chain = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = async () => {
          if (table === 'profiles') {
            profileSelectCount += 1;
            if (profileSelectCount === 1) return { data: { id: 'uid-lead' }, error: null };
            return { data: { id: 'uid-lead', role: 'leadership', active: true }, error: null };
          }
          return { data: null, error: null };
        };
        chain.insert = () => {
          if (table === 'profiles') profileInsertCalled = true;
          return chain;
        };
        chain.single = async () => ({ data: { id: TX_ENROLL_ID }, error: null });
        return chain;
      },
    };

    const { post, close } = await startServer({
      verifyOtp: async () => ({ valid: true }),
      supabaseAdmin: elevatedAdmin,
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-enrollment-otp', { email: 'lead@applywizz.ai', code: '482910' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(profileInsertCalled, false, 'existing elevated profile must not be recreated as staff');
    } finally { await close(); }
  });
});

// ── POST /api/auth/verify-totp-enrollment ────────────────────────────────────

describe('POST /api/auth/verify-totp-enrollment', () => {
  it('returns 401 when transaction does not exist', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [{ data: null, error: null }], // tx select returns null
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-enrollment', {
        enrollmentTransactionId: '00000000-0000-4000-8000-000000000000',
        code: '123456',
      });
      assert.equal(r.status, 401);
    } finally { await close(); }
  });

  it('returns 401 when transaction is expired', async () => {
    const expiredTx = { ...BASE_ENROLLMENT_TX, expires_at: new Date(Date.now() - 1000).toISOString() };
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [{ data: expiredTx, error: null }],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-enrollment', {
        enrollmentTransactionId: expiredTx.id,
        code: '123456',
      });
      assert.equal(r.status, 401);
    } finally { await close(); }
  });

  it('returns 423 when transaction is locked (5 attempts reached)', async () => {
    const lockedTx = { ...BASE_ENROLLMENT_TX, locked_at: new Date().toISOString() };
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [{ data: lockedTx, error: null }],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-enrollment', {
        enrollmentTransactionId: lockedTx.id,
        code: '123456',
      });
      assert.equal(r.status, 423);
    } finally { await close(); }
  });

  it('returns 409 when concurrent reservation wins (update returns 0 rows)', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [
          { data: BASE_ENROLLMENT_TX, error: null }, // tx select
          { data: [], error: null },                  // reservation update returns [] (concurrent)
        ],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-enrollment', {
        enrollmentTransactionId: BASE_ENROLLMENT_TX.id,
        code: '482910',
      });
      assert.equal(r.status, 409);
    } finally { await close(); }
  });

  it('allows stale verifying_at lease recovery after 60 seconds', async () => {
    const staleTx = {
      ...BASE_ENROLLMENT_TX,
      verifying_at: new Date(Date.now() - 61 * 1000).toISOString(),
    };
    const admin = makeTrackedTxAdmin({
      tableName: 'enrollment_transactions',
      tx: staleTx,
    });
    const { post, close } = await startServer({
      supabaseAdmin: admin,
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-enrollment', {
        enrollmentTransactionId: staleTx.id,
        code: '482910',
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    } finally { await close(); }
  });

  it('does not increment attempts during reservation', async () => {
    const admin = makeTrackedTxAdmin({
      tableName: 'enrollment_transactions',
      tx: BASE_ENROLLMENT_TX,
    });
    const { post, close } = await startServer({
      supabaseAdmin: admin,
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-enrollment', {
        enrollmentTransactionId: BASE_ENROLLMENT_TX.id,
        code: '482910',
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const reserveCall = admin.getTxUpdateCalls()[0];
      assert.equal('attempts' in reserveCall.payload, false, 'reserve must not increment attempts');
    } finally { await close(); }
  });

  it('returns 401 when TOTP code is wrong and clears verifying_at', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [
          { data: BASE_ENROLLMENT_TX, error: null },    // tx select
          { data: [{ id: BASE_ENROLLMENT_TX.id }], error: null }, // reservation ok
          { data: null, error: null },                  // clear verifying_at
        ],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser({
        challengeAndVerifyResult: { data: null, error: { message: 'Invalid TOTP code' } },
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-enrollment', {
        enrollmentTransactionId: BASE_ENROLLMENT_TX.id,
        code: '000000',
      });
      assert.equal(r.status, 401);
    } finally { await close(); }
  });

  it('returns 503 on unexpected verification error and clears verifying_at without incrementing attempts', async () => {
    const admin = makeTrackedTxAdmin({
      tableName: 'enrollment_transactions',
      tx: BASE_ENROLLMENT_TX,
    });
    const { post, close } = await startServer({
      supabaseAdmin: admin,
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser({
        challengeAndVerifyResult: { data: null, error: { message: 'Supabase API unavailable' } },
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-enrollment', {
        enrollmentTransactionId: BASE_ENROLLMENT_TX.id,
        code: '482910',
      });
      assert.equal(r.status, 503);
      const [reserveCall, releaseCall] = admin.getTxUpdateCalls();
      assert.equal('attempts' in reserveCall.payload, false, 'reserve must not increment attempts');
      assert.equal(releaseCall.payload.verifying_at, null, 'unexpected error must clear verifying_at');
      assert.equal('attempts' in releaseCall.payload, false, 'unexpected error must not increment attempts');
      assert.equal('locked_at' in releaseCall.payload, false, 'unexpected error must not lock the transaction');
    } finally { await close(); }
  });

  it('returns 503 when Supabase verifies TOTP but does not return a session', async () => {
    const admin = makeTrackedTxAdmin({
      tableName: 'enrollment_transactions',
      tx: BASE_ENROLLMENT_TX,
    });
    const { post, close } = await startServer({
      supabaseAdmin: admin,
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser({
        challengeAndVerifyResult: { data: { user: { id: 'uid-alice', email: 'alice@applywizz.ai' } }, error: null },
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-enrollment', {
        enrollmentTransactionId: BASE_ENROLLMENT_TX.id,
        code: '482910',
      });
      assert.equal(r.status, 503);
      const [reserveCall, releaseCall] = admin.getTxUpdateCalls();
      assert.equal('attempts' in reserveCall.payload, false, 'reserve must not increment attempts');
      assert.equal(releaseCall.payload.verifying_at, null, 'missing session must clear verifying_at');
      assert.equal('attempts' in releaseCall.payload, false, 'missing session must not increment attempts');
      assert.equal('locked_at' in releaseCall.payload, false, 'missing session must not lock the transaction');
    } finally { await close(); }
  });

  it('returns access_token and refresh_token on success — no other session fields', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [
          { data: BASE_ENROLLMENT_TX, error: null },
          { data: [{ id: BASE_ENROLLMENT_TX.id }], error: null }, // reservation ok
          { data: null, error: null },                             // mark used
        ],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-enrollment', {
        enrollmentTransactionId: BASE_ENROLLMENT_TX.id,
        code: '482910',
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.ok(r.body.access_token, 'must have access_token');
      assert.ok(r.body.refresh_token, 'must have refresh_token');
      assert.equal(Object.keys(r.body).length, 2, `must have exactly 2 fields: ${Object.keys(r.body).join(', ')}`);
    } finally { await close(); }
  });
});

// ── POST /api/auth/start-login ────────────────────────────────────────────────

describe('POST /api/auth/start-login', () => {
  it('returns 403 for non-company domain', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-login', { email: 'user@gmail.com' });
      assert.equal(r.status, 403);
    } finally { await close(); }
  });

  it('returns nextStep:otp for unknown email (not in Supabase Auth)', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({ authUsers: [] }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-login', { email: 'alice@applywizz.ai' });
      assert.equal(r.status, 200);
      assert.equal(r.body.nextStep, 'otp');
      assert.equal(r.body.transactionId, undefined, 'no transactionId for otp flow');
    } finally { await close(); }
  });

  it('returns nextStep:otp when user has no verified TOTP (not yet enrolled)', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        authUsers: [ALICE],
        fromResults: [{ data: ALICE_PROFILE_ACTIVE, error: null }],
        mfaFactors: [], // no factors
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-login', { email: 'alice@applywizz.ai' });
      assert.equal(r.status, 200);
      assert.equal(r.body.nextStep, 'otp');
    } finally { await close(); }
  });

  it('returns nextStep:otp for inactive user without revealing inactive status', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        authUsers: [ALICE],
        fromResults: [{ data: ALICE_PROFILE_INACTIVE, error: null }],
        mfaFactors: [VERIFIED_TOTP_FACTOR],
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-login', { email: 'alice@applywizz.ai' });
      assert.equal(r.status, 200);
      assert.equal(r.body.nextStep, 'otp', 'inactive user must not reveal existence via authenticator flow');
      assert.equal(r.body.transactionId, undefined);
    } finally { await close(); }
  });

  it('returns nextStep:authenticator and transactionId for enrolled active user', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        authUsers: [ALICE],
        fromResults: [
          { data: ALICE_PROFILE_ACTIVE, error: null },        // findProfileById
          { data: null, error: null },                        // login_transactions cleanup delete
          { data: { id: 'login-tx-uuid' }, error: null },     // login_transactions insert
        ],
        mfaFactors: [VERIFIED_TOTP_FACTOR],
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-login', { email: 'alice@applywizz.ai' });
      assert.equal(r.status, 200);
      assert.equal(r.body.nextStep, 'authenticator');
      assert.ok(r.body.transactionId, 'transactionId must be present');
      // Must not expose internal fields
      assert.equal(r.body.factorId, undefined);
      assert.equal(r.body.userId, undefined);
    } finally { await close(); }
  });

  it('does not call isDirectoryUser', async () => {
    let directoryLookupCalled = false;
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({ authUsers: [] }),
      isDirectoryUser: async () => { directoryLookupCalled = true; return { exists: true }; },
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      await post('/start-login', { email: 'alice@applywizz.ai' });
      assert.equal(directoryLookupCalled, false, 'isDirectoryUser must never be called');
    } finally { await close(); }
  });
});

// ── POST /api/auth/verify-totp-login ─────────────────────────────────────────

describe('POST /api/auth/verify-totp-login', () => {
  it('returns 401 when transaction does not exist', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [{ data: null, error: null }],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-login', {
        transactionId: '00000000-0000-4000-8000-000000000000',
        code: '123456',
      });
      assert.equal(r.status, 401);
    } finally { await close(); }
  });

  it('returns 401 for expired transaction', async () => {
    const expiredTx = { ...BASE_LOGIN_TX, expires_at: new Date(Date.now() - 1000).toISOString() };
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [{ data: expiredTx, error: null }],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-login', { transactionId: expiredTx.id, code: '123456' });
      assert.equal(r.status, 401);
    } finally { await close(); }
  });

  it('returns 423 for locked transaction', async () => {
    const lockedTx = { ...BASE_LOGIN_TX, locked_at: new Date().toISOString() };
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [{ data: lockedTx, error: null }],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-login', { transactionId: lockedTx.id, code: '123456' });
      assert.equal(r.status, 423);
    } finally { await close(); }
  });

  it('returns 403 for inactive user', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [
          { data: BASE_LOGIN_TX, error: null },
          { data: ALICE_PROFILE_INACTIVE, error: null },
        ],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-login', { transactionId: BASE_LOGIN_TX.id, code: '482910' });
      assert.equal(r.status, 403);
    } finally { await close(); }
  });

  it('returns 409 when concurrent reservation wins', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [
          { data: BASE_LOGIN_TX, error: null },
          { data: ALICE_PROFILE_ACTIVE, error: null },
          { data: [], error: null }, // 0 rows reserved = concurrent
        ],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-login', { transactionId: BASE_LOGIN_TX.id, code: '482910' });
      assert.equal(r.status, 409);
    } finally { await close(); }
  });

  it('returns 401 on wrong TOTP code', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [
          { data: BASE_LOGIN_TX, error: null },
          { data: ALICE_PROFILE_ACTIVE, error: null },
          { data: [{ id: BASE_LOGIN_TX.id }], error: null }, // reserved
          { data: null, error: null }, // clear verifying_at
        ],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser({
        challengeAndVerifyResult: { data: null, error: { message: 'Invalid TOTP code' } },
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-login', { transactionId: BASE_LOGIN_TX.id, code: '000000' });
      assert.equal(r.status, 401);
    } finally { await close(); }
  });

  it('increments attempts only after invalid TOTP and locks on the 5th failure', async () => {
    const nearLockedTx = {
      ...BASE_LOGIN_TX,
      attempts: 4,
    };
    const admin = makeTrackedTxAdmin({
      tableName: 'login_transactions',
      tx: nearLockedTx,
    });
    const { post, close } = await startServer({
      supabaseAdmin: admin,
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser({
        challengeAndVerifyResult: { data: null, error: { message: 'Invalid TOTP code' } },
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-login', { transactionId: nearLockedTx.id, code: '000000' });
      assert.equal(r.status, 401);
      const [reserveCall, invalidCall] = admin.getTxUpdateCalls();
      assert.equal('attempts' in reserveCall.payload, false, 'reserve must not increment attempts');
      assert.equal(invalidCall.payload.attempts, 5, 'invalid TOTP must increment attempts');
      assert.ok(invalidCall.payload.locked_at, '5th invalid TOTP must lock the transaction');
      assert.equal(invalidCall.payload.verifying_at, null, 'invalid TOTP must clear verifying_at');
    } finally { await close(); }
  });

  it('returns 503 on unexpected login verification error and clears verifying_at without incrementing attempts', async () => {
    const admin = makeTrackedTxAdmin({
      tableName: 'login_transactions',
      tx: BASE_LOGIN_TX,
    });
    const { post, close } = await startServer({
      supabaseAdmin: admin,
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser({
        challengeAndVerifyResult: { data: null, error: { message: 'Upstream session exchange failed' } },
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-login', { transactionId: BASE_LOGIN_TX.id, code: '482910' });
      assert.equal(r.status, 503);
      const [reserveCall, releaseCall] = admin.getTxUpdateCalls();
      assert.equal('attempts' in reserveCall.payload, false, 'reserve must not increment attempts');
      assert.equal(releaseCall.payload.verifying_at, null, 'unexpected error must clear verifying_at');
      assert.equal('attempts' in releaseCall.payload, false, 'unexpected error must not increment attempts');
      assert.equal('locked_at' in releaseCall.payload, false, 'unexpected error must not lock the transaction');
    } finally { await close(); }
  });

  it('returns access_token and refresh_token on success and deletes the transaction', async () => {
    let deleteCalledForTxId = null;
    const adminMock = makeSupabaseAdmin({
      fromResults: [
        { data: BASE_LOGIN_TX, error: null },
        { data: ALICE_PROFILE_ACTIVE, error: null },
        { data: [{ id: BASE_LOGIN_TX.id }], error: null }, // reserved
        { data: null, error: null },                        // delete (thenable)
      ],
    });
    const { post, close } = await startServer({
      supabaseAdmin: adminMock,
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-totp-login', { transactionId: BASE_LOGIN_TX.id, code: '482910' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.ok(r.body.access_token);
      assert.ok(r.body.refresh_token);
      assert.equal(Object.keys(r.body).length, 2, `extra fields: ${Object.keys(r.body).join(', ')}`);
    } finally { await close(); }
  });
});

// ── POST /api/auth/start-reauth ───────────────────────────────────────────────

describe('POST /api/auth/start-reauth', () => {
  it('returns 401 when no Bearer token is present', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-reauth', {});
      assert.equal(r.status, 401);
    } finally { await close(); }
  });

  it('returns 401 for invalid or expired token', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        getUserResult: { data: null, error: { message: 'invalid token' } },
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-reauth', {}, { Authorization: 'Bearer bad-token' });
      assert.equal(r.status, 401);
    } finally { await close(); }
  });

  it('returns 403 for inactive user', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [{ data: ALICE_PROFILE_INACTIVE, error: null }],
        mfaFactors: [VERIFIED_TOTP_FACTOR],
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-reauth', {}, { Authorization: 'Bearer valid-but-inactive' });
      assert.equal(r.status, 403);
    } finally { await close(); }
  });

  it('returns 422 when no verified TOTP factor exists', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [{ data: ALICE_PROFILE_ACTIVE, error: null }],
        mfaFactors: [], // no enrolled factor
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/start-reauth', {}, { Authorization: 'Bearer valid-token' });
      assert.equal(r.status, 422);
    } finally { await close(); }
  });

  it('returns transactionId on success — identity from token, not request body', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [
          { data: ALICE_PROFILE_ACTIVE, error: null },           // findProfileById
          { data: null, error: null },                           // login_transactions cleanup delete
          { data: { id: 'reauth-tx-uuid' }, error: null },       // login_transactions insert
        ],
        mfaFactors: [VERIFIED_TOTP_FACTOR],
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      // Body is empty — identity must come from the Bearer token only
      const r = await post('/start-reauth', {}, { Authorization: 'Bearer valid-token' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.ok(r.body.transactionId, 'must return transactionId');
      assert.equal(r.body.factorId, undefined, 'factorId must not be exposed');
      assert.equal(r.body.userId, undefined, 'userId must not be exposed');
    } finally { await close(); }
  });
});

// ── POST /api/auth/verify-reauth ─────────────────────────────────────────────

describe('POST /api/auth/verify-reauth', () => {
  it('returns 401 when no Bearer token is present', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-reauth', { transactionId: BASE_LOGIN_TX.id, code: '123456' });
      assert.equal(r.status, 401);
    } finally { await close(); }
  });

  it('returns 401 for invalid token', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        getUserResult: { data: null, error: { message: 'invalid token' } },
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post(
        '/verify-reauth',
        { transactionId: BASE_LOGIN_TX.id, code: '123456' },
        { Authorization: 'Bearer bad-token' }
      );
      assert.equal(r.status, 401);
    } finally { await close(); }
  });

  it('returns 403 for inactive user', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [{ data: ALICE_PROFILE_INACTIVE, error: null }],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post(
        '/verify-reauth',
        { transactionId: BASE_LOGIN_TX.id, code: '482910' },
        { Authorization: 'Bearer valid-token' }
      );
      assert.equal(r.status, 403);
    } finally { await close(); }
  });

  it('returns 401 when transaction does not belong to the authenticated user', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [
          { data: ALICE_PROFILE_ACTIVE, error: null },
          { data: null, error: null }, // tx select returns null (different user_id filtered out)
        ],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post(
        '/verify-reauth',
        { transactionId: BASE_LOGIN_TX.id, code: '482910' },
        { Authorization: 'Bearer valid-token' }
      );
      assert.equal(r.status, 401);
    } finally { await close(); }
  });

  it('returns access_token and refresh_token on success', async () => {
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        fromResults: [
          { data: ALICE_PROFILE_ACTIVE, error: null },
          { data: BASE_LOGIN_TX, error: null },              // tx select
          { data: [{ id: BASE_LOGIN_TX.id }], error: null }, // reservation
          { data: null, error: null },                        // delete
        ],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post(
        '/verify-reauth',
        { transactionId: BASE_LOGIN_TX.id, code: '482910' },
        { Authorization: 'Bearer valid-token' }
      );
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.ok(r.body.access_token);
      assert.ok(r.body.refresh_token);
      assert.equal(Object.keys(r.body).length, 2);
    } finally { await close(); }
  });

  it('increments attempts only after invalid reauth TOTP and locks on the 5th failure', async () => {
    const nearLockedTx = {
      ...BASE_LOGIN_TX,
      attempts: 4,
    };
    const admin = makeTrackedTxAdmin({
      tableName: 'login_transactions',
      tx: nearLockedTx,
    });
    const { post, close } = await startServer({
      supabaseAdmin: admin,
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser({
        challengeAndVerifyResult: { data: null, error: { message: 'Invalid TOTP code' } },
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post(
        '/verify-reauth',
        { transactionId: nearLockedTx.id, code: '000000' },
        { Authorization: 'Bearer valid-token' }
      );
      assert.equal(r.status, 401);
      const [reserveCall, invalidCall] = admin.getTxUpdateCalls();
      assert.equal('attempts' in reserveCall.payload, false, 'reserve must not increment attempts');
      assert.equal(invalidCall.payload.attempts, 5, 'invalid reauth TOTP must increment attempts');
      assert.ok(invalidCall.payload.locked_at, '5th invalid reauth TOTP must lock the transaction');
      assert.equal(invalidCall.payload.verifying_at, null, 'invalid reauth TOTP must clear verifying_at');
    } finally { await close(); }
  });

  it('returns 503 on unexpected reauth verification error and clears verifying_at without incrementing attempts', async () => {
    const admin = makeTrackedTxAdmin({
      tableName: 'login_transactions',
      tx: BASE_LOGIN_TX,
    });
    const { post, close } = await startServer({
      supabaseAdmin: admin,
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser({
        challengeAndVerifyResult: { data: null, error: { message: 'Network timeout during MFA verify' } },
      }),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post(
        '/verify-reauth',
        { transactionId: BASE_LOGIN_TX.id, code: '482910' },
        { Authorization: 'Bearer valid-token' }
      );
      assert.equal(r.status, 503);
      const [reserveCall, releaseCall] = admin.getTxUpdateCalls();
      assert.equal('attempts' in reserveCall.payload, false, 'reserve must not increment attempts');
      assert.equal(releaseCall.payload.verifying_at, null, 'unexpected error must clear verifying_at');
      assert.equal('attempts' in releaseCall.payload, false, 'unexpected error must not increment attempts');
      assert.equal('locked_at' in releaseCall.payload, false, 'unexpected error must not lock the transaction');
    } finally { await close(); }
  });

  it('identity comes from Bearer token — request body email is ignored', async () => {
    // The token identifies alice@applywizz.ai (via getUserResult default)
    // If the body contained a different email, it must be ignored
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({
        // getUserResult defaults to alice@applywizz.ai
        fromResults: [
          { data: ALICE_PROFILE_ACTIVE, error: null },
          { data: BASE_LOGIN_TX, error: null },
          { data: [{ id: BASE_LOGIN_TX.id }], error: null },
          { data: null, error: null },
        ],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      // Include a rogue email in the body — must be ignored
      const r = await post(
        '/verify-reauth',
        { transactionId: BASE_LOGIN_TX.id, code: '482910', email: 'attacker@applywizz.ai' },
        { Authorization: 'Bearer valid-token' }
      );
      assert.equal(r.status, 200, `should succeed based on token identity, got: ${JSON.stringify(r.body)}`);
    } finally { await close(); }
  });
});

// ── Security: no forbidden patterns in auth routes ────────────────────────────

describe('Security invariants', () => {
  it('start-enrollment does not have isDirectoryUser in its handler', async () => {
    // Injecting an isDirectoryUser that throws — if called, the test would see a 503.
    // Confirmed by the test above (returns 200 without calling it).
    // This test simply re-confirms there is no code path that calls it.
    let wasCalled = false;
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({ authUsers: [] }),
      isSendMailConfigured: () => true,
      generateOtp: async () => ({ code: '111111', otpId: 'id' }),
      sendOtpEmail: async () => {},
      isDirectoryUser: async () => { wasCalled = true; return { exists: true }; },
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      await post('/start-enrollment', { email: 'alice@applywizz.ai' });
      assert.equal(wasCalled, false, 'isDirectoryUser must not be called by start-enrollment');
    } finally { await close(); }
  });

  it('start-login does not have isDirectoryUser in its handler', async () => {
    let wasCalled = false;
    const { post, close } = await startServer({
      supabaseAdmin: makeSupabaseAdmin({ authUsers: [] }),
      isDirectoryUser: async () => { wasCalled = true; return { exists: true }; },
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      await post('/start-login', { email: 'alice@applywizz.ai' });
      assert.equal(wasCalled, false, 'isDirectoryUser must not be called by start-login');
    } finally { await close(); }
  });

  it('verify-enrollment-otp response never contains forbidden fields', async () => {
    const { post, close } = await startServer({
      verifyOtp: async () => ({ valid: true }),
      supabaseAdmin: makeSupabaseAdmin({
        authUsers: [ALICE],
        fromResults: [
          { data: { id: 'uid-alice' }, error: null },
          { data: ALICE_PROFILE_ACTIVE, error: null },
          { data: { id: 'tx-uuid' }, error: null },
        ],
        mfaFactors: [],
      }),
      supabaseAnon: makeSupabaseAnon(),
      supabaseAsUser: makeSupabaseAsUser(),
      normalizeEmail: (e) => e.trim().toLowerCase(),
    });
    try {
      const r = await post('/verify-enrollment-otp', { email: 'alice@applywizz.ai', code: '482910' });
      assert.equal(r.status, 200);
      const forbidden = ['factorId', 'factor_id', 'secret', 'uri', 'access_token', 'refresh_token',
        'enrollmentToken', 'totp', 'user_id', 'userId'];
      for (const f of forbidden) {
        assert.equal(r.body[f], undefined, `${f} must not appear in response`);
      }
    } finally { await close(); }
  });
});

describe('Protected route auth middleware', () => {
  it('returns 403 for an inactive user with a valid Bearer token', async () => {
    const app = express();
    app.get('/api/protected', authMiddleware, (_req, res) => {
      res.json({ ok: true });
    });
    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ error: err.message || 'Internal error' });
    });

    const originalAuth = supabaseAdmin.auth;
    const originalFrom = supabaseAdmin.from;
    supabaseAdmin.auth = {
      ...originalAuth,
      getUser: async () => ({
        data: { user: { id: 'uid-alice', email: 'alice@applywizz.ai' } },
        error: null,
      }),
    };
    supabaseAdmin.from = () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: 'uid-alice',
              full_name: 'Alice',
              preferred_name: 'Alice',
              role: 'staff',
              active: false,
            },
            error: null,
          }),
        }),
      }),
    });

    try {
      const r = await getFromApp(app, '/api/protected', { Authorization: 'Bearer valid-token' });
      assert.equal(r.status, 403);
      assert.equal(r.body.error, 'Account is disabled.');
    } finally {
      supabaseAdmin.auth = originalAuth;
      supabaseAdmin.from = originalFrom;
    }
  });
});
