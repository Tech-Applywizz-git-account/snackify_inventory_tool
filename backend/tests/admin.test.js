/**
 * Focused tests for admin route helpers in backend/src/routes/admin.js.
 * Run: node --test backend/tests/admin.test.js
 *
 * Pure-logic tests — no HTTP, no Supabase, no mock middleware.
 * process.env values are manipulated per-test and restored in afterEach.
 */
import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import express from 'express';
import {
  createAdminRouter,
  getDefaultPassword,
  getInviteRedirectUrl,
} from '../src/routes/admin.js';

function makeChain(result) {
  const r = result ?? { data: null, error: null, count: null };
  const chain = {};
  for (const method of ['select', 'update', 'upsert', 'eq', 'order']) {
    chain[method] = () => chain;
  }
  chain.insert = () => chain;
  chain.single = async () => ({ data: r.data, error: r.error });
  chain.maybeSingle = async () => ({ data: r.data, error: r.error });
  chain.then = (resolve, reject) =>
    Promise.resolve({ data: r.data, error: r.error, count: r.count }).then(resolve, reject);
  return chain;
}

function makeSupabaseAdminForReset({
  authUsers = [],
  factors = [],
  deleteFactorError = null,
  auditInsertError = null,
} = {}) {
  const deleteFactorCalls = [];
  const auditLogRows = [];

  return {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: authUsers }, error: null }),
        mfa: {
          listFactors: async () => ({ data: { factors }, error: null }),
          deleteFactor: async (payload) => {
            deleteFactorCalls.push(payload);
            return deleteFactorError
              ? { data: null, error: deleteFactorError }
              : { data: {}, error: null };
          },
        },
      },
    },
    from: (table) => {
      if (table === 'audit_logs') {
        return {
          insert: (payload) => {
            auditLogRows.push(payload);
            return makeChain(auditInsertError ? { data: null, error: auditInsertError } : {});
          },
        };
      }
      return makeChain();
    },
    getDeleteFactorCalls: () => deleteFactorCalls,
    getAuditLogRows: () => auditLogRows,
  };
}

function buildApp({ user, supabaseAdmin }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/admin', createAdminRouter({ supabaseAdmin }));
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });
  return app;
}

async function request(app, method, path) {
  const req = new Readable({
    read() {
      this.push(null);
    },
  });
  req.url = path;
  req.method = method;
  req.headers = {};
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

describe('getDefaultPassword() — DEFAULT_PASSWORD env var', () => {
  let savedPassword;
  let savedNodeEnv;
  let savedAppPublicUrl;

  beforeEach(() => {
    savedPassword = process.env.DEFAULT_PASSWORD;
    savedNodeEnv = process.env.NODE_ENV;
    savedAppPublicUrl = process.env.APP_PUBLIC_URL;
  });

  afterEach(() => {
    if (savedPassword === undefined) delete process.env.DEFAULT_PASSWORD;
    else process.env.DEFAULT_PASSWORD = savedPassword;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    if (savedAppPublicUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = savedAppPublicUrl;
  });

  it('returns null and logs console.error in production when DEFAULT_PASSWORD is not set', () => {
    delete process.env.DEFAULT_PASSWORD;
    process.env.NODE_ENV = 'production';
    const logs = [];
    const origError = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    try {
      const result = getDefaultPassword();
      assert.equal(result, null, 'must return null when env var is missing');
      assert.ok(logs.length > 0, 'must log an error in production');
      assert.ok(logs[0].includes('DEFAULT_PASSWORD'), 'log must name the missing variable');
    } finally {
      console.error = origError;
    }
  });

  it('returns null in development when DEFAULT_PASSWORD is not set (fail closed in all envs)', () => {
    delete process.env.DEFAULT_PASSWORD;
    process.env.NODE_ENV = 'development';
    const result = getDefaultPassword();
    assert.equal(result, null, 'must return null in dev — no hardcoded fallback');
  });

  it('returns the exact env var value when DEFAULT_PASSWORD is configured', () => {
    process.env.DEFAULT_PASSWORD = 'Env$ecret@Test99';
    const result = getDefaultPassword();
    assert.equal(result, 'Env$ecret@Test99', 'must return the env var value verbatim');
    assert.notEqual(result, 'Applywizz@2026', 'must not return the old hardcoded string');
  });

  it('never includes any password value in error logs', () => {
    delete process.env.DEFAULT_PASSWORD;
    process.env.NODE_ENV = 'production';
    const logs = [];
    const origError = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    try {
      getDefaultPassword();
      const logsText = logs.join('\n');
      assert.equal(logsText.includes('Applywizz@2026'), false, 'old hardcoded password must not appear in logs');
      assert.ok(logsText.includes('DEFAULT_PASSWORD'), 'log names the config key (safe), not a secret value');
    } finally {
      console.error = origError;
    }
  });
});

describe('getInviteRedirectUrl() — APP_PUBLIC_URL env var', () => {
  let savedAppPublicUrl;

  beforeEach(() => {
    savedAppPublicUrl = process.env.APP_PUBLIC_URL;
  });

  afterEach(() => {
    if (savedAppPublicUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = savedAppPublicUrl;
  });

  it('uses APP_PUBLIC_URL when present', () => {
    process.env.APP_PUBLIC_URL = 'https://snackify.applywizz.ai';
    assert.equal(
      getInviteRedirectUrl(),
      'https://snackify.applywizz.ai/dashboard'
    );
  });

  it('falls back to localhost when APP_PUBLIC_URL is missing', () => {
    delete process.env.APP_PUBLIC_URL;
    assert.equal(
      getInviteRedirectUrl(),
      'http://localhost:5173/dashboard'
    );
  });
});

describe('POST /api/admin/users/:userId/reset-authenticator', () => {
  const leadershipUser = {
    id: 'leader-1',
    email: 'leader@applywizz.ai',
    role: 'leadership',
  };

  it('resets the verified TOTP factor and writes an audit log', async () => {
    const supabaseAdmin = makeSupabaseAdminForReset({
      authUsers: [{ id: 'user-1', email: 'bhanuteja@applywizz.ai' }],
      factors: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }],
    });
    const app = buildApp({ user: leadershipUser, supabaseAdmin });

    const response = await request(app, 'POST', '/api/admin/users/user-1/reset-authenticator');

    assert.equal(response.status, 200);
    assert.equal(response.body?.ok, true);
    assert.deepEqual(supabaseAdmin.getDeleteFactorCalls(), [{ userId: 'user-1', id: 'factor-1' }]);
    assert.equal(supabaseAdmin.getAuditLogRows().length, 1);
    assert.equal(supabaseAdmin.getAuditLogRows()[0].action, 'AUTHENTICATOR_RESET');
    assert.equal(supabaseAdmin.getAuditLogRows()[0].user_id, leadershipUser.id);
    assert.equal(supabaseAdmin.getAuditLogRows()[0].entity_id, 'user-1');
  });

  it('returns 409 when the user has no verified TOTP factor', async () => {
    const supabaseAdmin = makeSupabaseAdminForReset({
      authUsers: [{ id: 'user-1', email: 'bhanuteja@applywizz.ai' }],
      factors: [],
    });
    const app = buildApp({ user: leadershipUser, supabaseAdmin });

    const response = await request(app, 'POST', '/api/admin/users/user-1/reset-authenticator');

    assert.equal(response.status, 409);
    assert.match(response.body?.error || '', /verified authenticator/i);
    assert.deepEqual(supabaseAdmin.getDeleteFactorCalls(), []);
    assert.equal(supabaseAdmin.getAuditLogRows().length, 0);
  });

  it('returns 403 for non-leadership callers', async () => {
    const supabaseAdmin = makeSupabaseAdminForReset({
      authUsers: [{ id: 'user-1', email: 'bhanuteja@applywizz.ai' }],
      factors: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }],
    });
    const app = buildApp({
      user: { id: 'staff-1', email: 'staff@applywizz.ai', role: 'staff' },
      supabaseAdmin,
    });

    const response = await request(app, 'POST', '/api/admin/users/user-1/reset-authenticator');

    assert.equal(response.status, 403);
    assert.deepEqual(supabaseAdmin.getDeleteFactorCalls(), []);
    assert.equal(supabaseAdmin.getAuditLogRows().length, 0);
  });
});
