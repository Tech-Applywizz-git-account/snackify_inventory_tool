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
  for (const method of ['select', 'update', 'upsert', 'eq', 'order', 'gte', 'lte', 'range']) {
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
  mfaResetInsertError = null,
} = {}) {
  const deleteFactorCalls = [];
  const auditLogRows = [];
  const mfaResetLogsRows = [];

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
      if (table === 'mfa_reset_logs') {
        return {
          insert: (payload) => {
            mfaResetLogsRows.push(payload);
            return makeChain(mfaResetInsertError ? { data: null, error: mfaResetInsertError } : {});
          },
        };
      }
      return makeChain();
    },
    getDeleteFactorCalls: () => deleteFactorCalls,
    getAuditLogRows: () => auditLogRows,
    getMfaResetLogRows: () => mfaResetLogsRows,
  };
}

function buildApp({ user, supabaseAdmin, ...overrides }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/admin', createAdminRouter({ supabaseAdmin, ...overrides }));
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });
  return app;
}

async function request(app, method, path, body) {
  const bodyBuffer = body === undefined ? null : Buffer.from(JSON.stringify(body));
  let bodySent = false;
  const req = new Readable({
    read() {
      if (!bodySent && bodyBuffer) this.push(bodyBuffer);
      bodySent = true;
      this.push(null);
    },
  });
  req.url = path;
  req.method = method;
  req.headers = bodyBuffer
    ? { 'content-type': 'application/json', 'content-length': String(bodyBuffer.length) }
    : {};
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

describe('POST /api/admin/users/create vendor onboarding compatibility', () => {
  it('preserves the existing endpoint while using fixed-password vendor onboarding', async () => {
    let createdAttributes;
    let emailSent = false;
    const supabaseAdmin = {
      auth: {
        admin: {
          createUser: async (attributes) => {
            createdAttributes = attributes;
            return { data: { user: { id: 'vendor-user-id' } }, error: null };
          },
          generateLink: async () => ({
            data: { properties: { action_link: 'https://auth.example/verify?token=legacy-route' } },
            error: null,
          }),
          deleteUser: async () => ({ error: null }),
        },
      },
      from: () => makeChain(),
    };
    const app = buildApp({
      user: { role: 'leadership' },
      supabaseAdmin,
      sendVendorAccountEmail: async () => {
        emailSent = true;
      },
    });
    const result = await request(app, 'POST', '/api/admin/users/create', {
      email: 'vendor@example.com',
      role: 'vendor',
      full_name: 'Test Vendor',
    });

    assert.equal(result.status, 201);
    assert.equal(createdAttributes.password, 'vendor@123');
    assert.equal(createdAttributes.email_confirm, false);
    assert.equal(emailSent, true);
  });
});

describe('POST /api/admin/users/invite vendor onboarding compatibility', () => {
  it('uses the shared vendor confirmation workflow for vendor invites', async () => {
    let emailSent = false;
    const supabaseAdmin = {
      auth: {
        admin: {
          createUser: async () => ({
            data: { user: { id: 'vendor-user-id' } },
            error: null,
          }),
          generateLink: async () => ({
            data: { properties: { action_link: 'https://auth.example/verify?token=invite-route' } },
            error: null,
          }),
          deleteUser: async () => ({ error: null }),
        },
      },
      from: () => makeChain(),
    };
    const app = buildApp({
      user: { role: 'leadership' },
      supabaseAdmin,
      sendVendorAccountEmail: async () => {
        emailSent = true;
      },
    });
    const result = await request(app, 'POST', '/api/admin/users/invite', {
      email: 'vendor@example.com',
      role: 'vendor',
      full_name: 'Test Vendor',
    });

    assert.equal(result.status, 201);
    assert.equal(emailSent, true);
  });
});

describe('POST /api/admin/vendors/create', () => {
  it('creates an unconfirmed vendor with the selected password and puts confirmation first in email', async () => {
    let createdAttributes;
    let generatedLinkOptions;
    let sentEmail;
    const supabaseAdmin = {
      auth: {
        admin: {
          createUser: async (attributes) => {
            createdAttributes = attributes;
            return { data: { user: { id: 'vendor-new-id' } }, error: null };
          },
          generateLink: async (options) => {
            generatedLinkOptions = options;
            return {
              data: { properties: { action_link: 'https://auth.example/verify?token=unique' } },
              error: null,
            };
          },
          deleteUser: async () => ({ error: null }),
        },
      },
      from: () => makeChain(),
    };
    const app = buildApp({
      user: { id: 'admin-1', role: 'leadership' },
      supabaseAdmin,
      sendVendorAccountEmail: async (...args) => { sentEmail = args; },
    });

    const result = await request(app, 'POST', '/api/admin/vendors/create', {
      email: 'Vendor@external.example',
      full_name: 'New Vendor',
      password: 'Chosen-vendor-pass',
    });

    assert.equal(result.status, 201);
    assert.equal(createdAttributes.email, 'vendor@external.example');
    assert.equal(createdAttributes.password, 'Chosen-vendor-pass');
    assert.equal(createdAttributes.email_confirm, false);
    assert.deepEqual(createdAttributes.app_metadata, { role: 'vendor' });
    assert.equal(generatedLinkOptions.type, 'magiclink');
    assert.equal(generatedLinkOptions.options.redirectTo, 'http://localhost:5173/login?vendor_confirmed=1');
    assert.equal(sentEmail[0], 'vendor@external.example');
    assert.match(sentEmail[2], /Chosen-vendor-pass/);
    assert.match(sentEmail[2], /https:\/\/auth\.example\/verify\?token=unique/);
    assert.ok(
      sentEmail[2].indexOf('Confirm account') < sentEmail[2].indexOf('Registered Email ID'),
      'confirmation action appears before account details'
    );
  });

  it('rejects non-admin callers', async () => {
    const app = buildApp({ user: { id: 'staff-1', role: 'staff' }, supabaseAdmin: {} });
    const result = await request(app, 'POST', '/api/admin/vendors/create', {
      email: 'vendor@external.example',
      full_name: 'Vendor',
    });

    assert.equal(result.status, 403);
  });

  it('explains when the database vendor-account limit has been reached', async () => {
    const supabaseAdmin = {
      auth: {
        admin: {
          createUser: async () => ({
            data: null,
            error: {
              code: '23514',
              message: 'The maximum of 3 Vendor accounts has been reached.',
            },
          }),
        },
      },
    };
    const app = buildApp({
      user: { id: 'admin-1', role: 'leadership' },
      supabaseAdmin,
    });
    const result = await request(app, 'POST', '/api/admin/vendors/create', {
      email: 'vendor@external.example',
      full_name: 'Vendor',
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'The maximum of 3 vendor accounts has been reached.');
  });

  it('returns a specific configuration hint when onboarding email delivery fails', async () => {
    const supabaseAdmin = {
      auth: {
        admin: {
          createUser: async () => ({
            data: { user: { id: 'vendor-new-id' } },
            error: null,
          }),
          generateLink: async () => ({
            data: { properties: { action_link: 'https://auth.example/verify?token=unique' } },
            error: null,
          }),
          deleteUser: async () => ({ error: null }),
        },
      },
      from: () => makeChain(),
    };
    const app = buildApp({
      user: { id: 'admin-1', role: 'leadership' },
      supabaseAdmin,
      sendVendorAccountEmail: async () => {
        throw new Error('Graph sendMail failed (404)');
      },
    });
    const result = await request(app, 'POST', '/api/admin/vendors/create', {
      email: 'vendor@external.example',
      full_name: 'Vendor',
    });

    assert.equal(result.status, 503);
    assert.match(result.body.error, /Microsoft Graph credentials/);
    assert.match(result.body.error, /support@applywizz\.ai sender exists/);
  });
});

describe('POST /api/admin/vendors/:userId/password', () => {
  it('updates only vendor credentials and emails the new password', async () => {
    let updatedCredentials;
    let sentEmail;
    const supabaseAdmin = {
      auth: {
        admin: {
          listUsers: async () => ({
            data: { users: [{ id: 'vendor-id', email: 'vendor@external.example' }] },
            error: null,
          }),
          updateUserById: async (userId, attributes) => {
            updatedCredentials = { userId, attributes };
            return { error: null };
          },
        },
      },
      from: () => makeChain({ data: { role: 'vendor' } }),
    };
    const app = buildApp({
      user: { id: 'admin-1', role: 'leadership' },
      supabaseAdmin,
      sendVendorAccountEmail: async (...args) => { sentEmail = args; },
    });

    const result = await request(app, 'POST', '/api/admin/vendors/vendor-id/password', {
      password: 'A-new-vendor-password',
    });

    assert.equal(result.status, 200);
    assert.deepEqual(updatedCredentials, {
      userId: 'vendor-id',
      attributes: { password: 'A-new-vendor-password' },
    });
    assert.equal(sentEmail[0], 'vendor@external.example');
    assert.match(sentEmail[2], /A-new-vendor-password/);
    assert.match(sentEmail[2], /\/login/);
    assert.equal(Object.hasOwn(result.body, 'password'), false);
  });
});

describe('PATCH /api/admin/users/:id/role', () => {
  it('allows leadership to assign the vendor role to an existing user', async () => {
    let updatedRole;
    const supabaseAdmin = {
      from: () => {
        const chain = {
          update: (values) => {
            updatedRole = values.role;
            return chain;
          },
          eq: () => chain,
          select: () => chain,
          single: async () => ({
            data: { id: 'existing-user-id', role: updatedRole },
            error: null,
          }),
        };
        return chain;
      },
    };
    const app = buildApp({ user: { id: 'leadership-user-id', role: 'leadership' }, supabaseAdmin });

    const result = await request(app, 'PATCH', '/api/admin/users/existing-user-id/role', {
      role: 'vendor',
    });

    assert.equal(result.status, 200);
    assert.equal(updatedRole, 'vendor');
    assert.equal(result.body.role, 'vendor');
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

    assert.equal(supabaseAdmin.getMfaResetLogRows().length, 1);
    assert.equal(supabaseAdmin.getMfaResetLogRows()[0].reset_by, leadershipUser.id);
    assert.equal(supabaseAdmin.getMfaResetLogRows()[0].reset_by_email, leadershipUser.email);
    assert.equal(supabaseAdmin.getMfaResetLogRows()[0].target_user_id, 'user-1');
    assert.equal(supabaseAdmin.getMfaResetLogRows()[0].target_user_email, 'bhanuteja@applywizz.ai');
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
