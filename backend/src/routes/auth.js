import { Router } from 'express';
import { z } from 'zod';
import { isSendMailConfigured, sendOtpEmail } from '../lib/microsoftGraph.js';
import { cancelOtp, generateOtp, normalizeEmail, verifyOtp } from '../lib/otpService.js';
import { supabaseAdmin, supabaseAnon, supabaseAsUser } from '../lib/supabase.js';

const ALLOWED_DOMAIN = 'applywizz.ai';
const ENROLLMENT_TX_TTL_MS = 15 * 60 * 1000; // 15 min
const LOGIN_TX_TTL_MS = 5 * 60 * 1000;        // 5 min
const MAX_TOTP_ATTEMPTS = 5;
const RESERVATION_LEASE_MS = 60 * 1000;        // 60s stale reservation recovery

function displayNameFromEmail(email) {
  return email
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function nowIso() {
  return new Date().toISOString();
}

function staleLeaseIso() {
  return new Date(Date.now() - RESERVATION_LEASE_MS).toISOString();
}

// ── Router factory ─────────────────────────────────────────────────────────
// All handlers close over `d` (deps). The default export injects real modules;
// tests inject mocks by calling createAuthRouter({ supabaseAdmin: mock, ... }).

export function createAuthRouter(overrides = {}) {
  const d = {
    supabaseAdmin,
    supabaseAnon,
    supabaseAsUser,
    isSendMailConfigured,
    sendOtpEmail,
    cancelOtp,
    generateOtp,
    verifyOtp,
    normalizeEmail,
    ...overrides,
  };

  const router = Router();

  async function findUserByEmail(email) {
    const { data, error } = await d.supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 500,
    });
    if (error) throw error;
    return data?.users?.find((user) => user.email?.toLowerCase() === email) || null;
  }

  async function findProfileById(userId) {
    const { data } = await d.supabaseAdmin
      .from('profiles')
      .select('id, role, active')
      .eq('id', userId)
      .maybeSingle();
    return data || null;
  }

  async function ensureProfile(userId, email, displayName) {
    const { data: existing, error: readErr } = await d.supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (readErr) throw readErr;
    if (existing) return;

    const { error: insertErr } = await d.supabaseAdmin.from('profiles').insert({
      id: userId,
      full_name: displayName || displayNameFromEmail(email),
      role: 'staff',
      active: true,
    });

    if (insertErr && insertErr.code !== '23505') throw insertErr;
  }

  async function findVerifiedTotpFactor(userId) {
    const { data } = await d.supabaseAdmin.auth.admin.mfa.listFactors({ userId });
    return (data?.factors ?? []).find(
      (f) => f.factor_type === 'totp' && f.status === 'verified'
    ) || null;
  }

  async function getUserAal1Session(email) {
    const { data: linkData, error: linkErr } = await d.supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (linkErr) throw linkErr;

    const emailOtp = linkData?.properties?.email_otp;
    if (!emailOtp) throw new Error('generateLink did not return email_otp');

    const { data: sessionData, error: sessionErr } = await d.supabaseAnon.auth.verifyOtp({
      email,
      token: emailOtp,
      type: 'magiclink',
    });
    if (sessionErr) throw sessionErr;

    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) throw new Error('Failed to establish user session');
    return accessToken;
  }

  async function reserveTransaction(table, tx, { requireUnused = false } = {}) {
    const reservedAt = nowIso();
    const baseUpdate = {
      version: tx.version + 1,
      verifying_at: reservedAt,
      updated_at: reservedAt,
    };

    const buildReservation = (query) => {
      let scoped = query
        .eq('id', tx.id)
        .eq('version', tx.version)
        .is('locked_at', null)
        .gt('expires_at', reservedAt);

      if (requireUnused) {
        scoped = scoped.is('used_at', null);
      }

      return scoped.select('id');
    };

    const { data: immediate } = await buildReservation(
      d.supabaseAdmin
        .from(table)
        .update(baseUpdate)
        .is('verifying_at', null)
    );

    if (Array.isArray(immediate) && immediate.length > 0) {
      return true;
    }

    const { data: stale } = await buildReservation(
      d.supabaseAdmin
        .from(table)
        .update(baseUpdate)
        .lt('verifying_at', staleLeaseIso())
    );

    return Array.isArray(stale) && stale.length > 0;
  }

  async function clearTransactionReservation(table, id) {
    await d.supabaseAdmin
      .from(table)
      .update({ verifying_at: null, updated_at: nowIso() })
      .eq('id', id);
  }

  async function recordInvalidTotpAttempt(table, tx) {
    const attempts = tx.attempts + 1;
    const update = {
      attempts,
      verifying_at: null,
      updated_at: nowIso(),
    };

    if (attempts >= MAX_TOTP_ATTEMPTS) {
      update.locked_at = nowIso();
    }

    await d.supabaseAdmin
      .from(table)
      .update(update)
      .eq('id', tx.id);
  }

  function isInvalidTotpVerificationError(error) {
    const message = `${error?.message ?? ''}`.toLowerCase();
    return (
      (message.includes('invalid') || message.includes('failed')) &&
      (message.includes('totp') || message.includes('otp') || message.includes('code'))
    );
  }

  async function sendVerificationFailure(res, table, id) {
    await clearTransactionReservation(table, id);
    return res
      .status(503)
      .json({ error: 'Verification is temporarily unavailable. Please try again.' });
  }

  // ── POST /api/auth/start-enrollment ──────────────────────────────────────
  // Step 1 of new-employee enrollment: validate email and send OTP.
  // Sends OTP regardless of whether a Supabase Auth account exists yet —
  // new employees are created during verify-enrollment-otp.
  // Microsoft Entra directory lookup is NOT performed here; Graph is used
  // only for sendMail (support@applywizz.ai → employee inbox).
  router.post('/start-enrollment', async (req, res, next) => {
    try {
      const schema = z.object({ email: z.string().email() });
      const email = d.normalizeEmail(schema.parse(req.body).email);

      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return res.status(403).json({ error: 'Login not available for this email.' });
      }

      if (!d.isSendMailConfigured()) {
        console.error('[Auth] Graph/sendMail not configured — cannot start enrollment.');
        return res
          .status(503)
          .json({ error: 'Login is temporarily unavailable. Please try later.' });
      }

      // If user already exists, check whether they already have a verified TOTP factor.
      // Attempting to re-enroll an already-enrolled user is a 409, not a silent ok.
      const existingUser = await findUserByEmail(email);
      if (existingUser) {
        const verifiedFactor = await findVerifiedTotpFactor(existingUser.id);
        if (verifiedFactor) {
          return res.status(409).json({ error: 'This account is already enrolled with an authenticator app.' });
        }
      }

      let code;
      let otpId;
      try {
        ({ code, otpId } = await d.generateOtp(email));
      } catch (e) {
        if (e.message === 'COOLDOWN') {
          return res.status(429).json({ error: 'Please wait before requesting another code.' });
        }
        if (e.message === 'RATE_LIMITED') {
          return res.status(429).json({ error: 'Too many codes requested. Try again in an hour.' });
        }
        throw e;
      }

      try {
        await d.sendOtpEmail(email, code);
      } catch (e) {
        try {
          await d.cancelOtp(otpId);
        } catch (cleanupErr) {
          console.error('[Auth] OTP cleanup failed after send error — row may persist:', cleanupErr.message);
        }
        console.error('[Auth] sendOtpEmail failed:', e.message);
        return res
          .status(503)
          .json({ error: 'Could not send verification code. Please try again.' });
      } finally {
        code = null; // ponytail: clear plaintext OTP reference
      }

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ── POST /api/auth/verify-enrollment-otp ─────────────────────────────────
  // Step 2: verify the emailed OTP, create the Supabase Auth user if needed,
  // enroll TOTP server-side, and return { enrollmentTransactionId, qrCode }.
  // Never returns factorId, secret, URI, or any session token.
  router.post('/verify-enrollment-otp', async (req, res, next) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        code: z.string().length(6).regex(/^\d{6}$/),
      });
      const parsed = schema.parse(req.body);
      const email = d.normalizeEmail(parsed.email);

      const result = await d.verifyOtp(email, parsed.code);
      if (!result.valid) {
        return res.status(401).json({ error: 'Invalid or expired code.' });
      }

      // Get or create the Supabase Auth user.
      let user = await findUserByEmail(email);
      if (!user) {
        const { data: created, error: createErr } = await d.supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: true,
        });
        if (createErr) throw createErr;
        user = created?.user;
      }

      if (!user) throw new Error('Failed to obtain user record after creation');

      // Ensure a profile row exists (role=staff, active=true by default).
      await ensureProfile(user.id, email);

      // Block inactive accounts from enrolling.
      const profile = await findProfileById(user.id);
      if (!profile || !profile.active) {
        return res.status(403).json({ error: 'Account is disabled.' });
      }

      // Block re-enrollment if a verified TOTP factor already exists.
      const verifiedFactor = await findVerifiedTotpFactor(user.id);
      if (verifiedFactor) {
        return res.status(409).json({ error: 'This account is already enrolled with an authenticator app.' });
      }

      // Clean stale unverified TOTP factors for this user before enrolling a new one.
      const { data: allFactorsData } = await d.supabaseAdmin.auth.admin.mfa.listFactors({ userId: user.id });
      const staleFactors = (allFactorsData?.factors ?? []).filter(
        (f) => f.factor_type === 'totp' && f.status !== 'verified'
      );
      for (const stale of staleFactors) {
        await d.supabaseAdmin.auth.admin.mfa.deleteFactor({ userId: user.id, id: stale.id });
      }

      // Generate a server-side AAL1 session to call mfa.enroll().
      const aal1Token = await getUserAal1Session(email);

      // Enroll TOTP with the user-scoped client.
      const { data: enrollData, error: enrollErr } = await d
        .supabaseAsUser(aal1Token)
        .auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Snackify' });
      if (enrollErr) throw enrollErr;

      const { id: factorId, totp } = enrollData;

      // Persist the enrollment transaction. If this fails, delete the orphan factor.
      let txData;
      try {
        const { data, error: txErr } = await d.supabaseAdmin
          .from('enrollment_transactions')
          .insert({
            email,
            user_id: user.id,
            factor_id: factorId,
            expires_at: new Date(Date.now() + ENROLLMENT_TX_TTL_MS).toISOString(),
          })
          .select('id')
          .single();
        if (txErr) throw txErr;
        txData = data;
      } catch (txInsertErr) {
        try {
          await d.supabaseAdmin.auth.admin.mfa.deleteFactor({ userId: user.id, id: factorId });
        } catch (cleanupErr) {
          console.error('[Auth] orphan factor cleanup failed:', cleanupErr.message);
        }
        throw txInsertErr;
      }

      res.json({ enrollmentTransactionId: txData.id, qrCode: totp.qr_code });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request.' });
      }
      next(e);
    }
  });

  // ── POST /api/auth/verify-totp-enrollment ────────────────────────────────
  // Step 3: employee scans QR and enters first TOTP code.
  // Uses optimistic locking + verifying_at reservation to prevent race conditions.
  // Returns AAL2 tokens on success.
  router.post('/verify-totp-enrollment', async (req, res, next) => {
    try {
      const schema = z.object({
        enrollmentTransactionId: z.string().uuid(),
        code: z.string().length(6).regex(/^\d{6}$/),
      });
      const { enrollmentTransactionId, code } = schema.parse(req.body);

      const { data: tx } = await d.supabaseAdmin
        .from('enrollment_transactions')
        .select('*')
        .eq('id', enrollmentTransactionId)
        .maybeSingle();

      if (!tx) return res.status(401).json({ error: 'Invalid or expired enrollment session.' });
      if (tx.used_at) return res.status(401).json({ error: 'Enrollment already completed.' });
      if (tx.locked_at) return res.status(423).json({ error: 'Too many attempts. Please start over.' });
      if (new Date(tx.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Enrollment session expired. Please start over.' });
      }

      const didReserve = await reserveTransaction('enrollment_transactions', tx, { requireUnused: true });
      if (!didReserve) {
        return res.status(409).json({ error: 'Another verification is in progress. Please retry.' });
      }

      // Call Supabase TOTP verification via a server-side user session.
      let aal2Tokens;
      try {
        const aal1Token = await getUserAal1Session(tx.email);
        const { data: verifyData, error: verifyErr } = await d
          .supabaseAsUser(aal1Token)
          .auth.mfa.challengeAndVerify({ factorId: tx.factor_id, code });

        if (verifyErr) {
          if (isInvalidTotpVerificationError(verifyErr)) {
            await recordInvalidTotpAttempt('enrollment_transactions', tx);
            return res.status(401).json({ error: 'Invalid authenticator code.' });
          }
          return sendVerificationFailure(res, 'enrollment_transactions', enrollmentTransactionId);
        }
        aal2Tokens = verifyData;
        if (!aal2Tokens?.access_token || !aal2Tokens?.refresh_token) {
          return sendVerificationFailure(res, 'enrollment_transactions', enrollmentTransactionId);
        }
      } catch (e) {
        return sendVerificationFailure(res, 'enrollment_transactions', enrollmentTransactionId);
      }

      // Mark transaction as used.
      await d.supabaseAdmin
        .from('enrollment_transactions')
        .update({ used_at: nowIso(), verifying_at: null, updated_at: nowIso() })
        .eq('id', enrollmentTransactionId);

      res.json({ access_token: aal2Tokens.access_token, refresh_token: aal2Tokens.refresh_token });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request.' });
      }
      next(e);
    }
  });

  // ── POST /api/auth/start-login ────────────────────────────────────────────
  // Existing employee daily login — Step 1.
  // Returns nextStep:'authenticator' + transactionId for enrolled users.
  // Returns nextStep:'otp' for unknown/unenrolled/inactive users without revealing why
  // (prevents account enumeration).
  router.post('/start-login', async (req, res, next) => {
    try {
      const schema = z.object({ email: z.string().email() });
      const email = d.normalizeEmail(schema.parse(req.body).email);

      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return res.status(403).json({ error: 'Login not available for this email.' });
      }

      const existingUser = await findUserByEmail(email);
      if (!existingUser) {
        return res.json({ nextStep: 'otp' });
      }

      const profile = await findProfileById(existingUser.id);
      if (!profile || !profile.active) {
        return res.json({ nextStep: 'otp' }); // don't reveal inactive status
      }

      const verifiedFactor = await findVerifiedTotpFactor(existingUser.id);
      if (!verifiedFactor) {
        return res.json({ nextStep: 'otp' });
      }

      // Clean up old expired login transactions for this email before creating a new one.
      await d.supabaseAdmin
        .from('login_transactions')
        .delete()
        .eq('email', email)
        .lt('expires_at', new Date().toISOString());

      const { data: tx, error: txErr } = await d.supabaseAdmin
        .from('login_transactions')
        .insert({
          email,
          user_id: existingUser.id,
          factor_id: verifiedFactor.id,
          expires_at: new Date(Date.now() + LOGIN_TX_TTL_MS).toISOString(),
        })
        .select('id')
        .single();

      if (txErr) throw txErr;

      res.json({ nextStep: 'authenticator', transactionId: tx.id });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request.' });
      }
      next(e);
    }
  });

  // ── POST /api/auth/verify-totp-login ─────────────────────────────────────
  // Existing employee daily login — Step 2.
  // Verifies TOTP code against a login_transactions row and returns AAL2 tokens.
  // The transaction is DELETED on success (ephemeral — not marked used_at).
  router.post('/verify-totp-login', async (req, res, next) => {
    try {
      const schema = z.object({
        transactionId: z.string().uuid(),
        code: z.string().length(6).regex(/^\d{6}$/),
      });
      const { transactionId, code } = schema.parse(req.body);

      const { data: tx } = await d.supabaseAdmin
        .from('login_transactions')
        .select('*')
        .eq('id', transactionId)
        .maybeSingle();

      if (!tx) return res.status(401).json({ error: 'Invalid or expired login session.' });
      if (tx.locked_at) return res.status(423).json({ error: 'Too many attempts. Please try logging in again.' });
      if (new Date(tx.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Login session expired. Please try again.' });
      }

      const profile = await findProfileById(tx.user_id);
      if (!profile || !profile.active) {
        return res.status(403).json({ error: 'Account is disabled.' });
      }

      const didReserve = await reserveTransaction('login_transactions', tx);
      if (!didReserve) {
        return res.status(409).json({ error: 'Another verification is in progress. Please retry.' });
      }

      let aal2Tokens;
      try {
        const aal1Token = await getUserAal1Session(tx.email);
        const { data: verifyData, error: verifyErr } = await d
          .supabaseAsUser(aal1Token)
          .auth.mfa.challengeAndVerify({ factorId: tx.factor_id, code });

        if (verifyErr) {
          if (isInvalidTotpVerificationError(verifyErr)) {
            await recordInvalidTotpAttempt('login_transactions', tx);
            return res.status(401).json({ error: 'Invalid authenticator code.' });
          }
          return sendVerificationFailure(res, 'login_transactions', transactionId);
        }
        aal2Tokens = verifyData;
      } catch (e) {
        return sendVerificationFailure(res, 'login_transactions', transactionId);
      }

      // Delete the transaction on success (ephemeral — no used_at).
      await d.supabaseAdmin
        .from('login_transactions')
        .delete()
        .eq('id', transactionId);

      res.json({ access_token: aal2Tokens.access_token, refresh_token: aal2Tokens.refresh_token });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request.' });
      }
      next(e);
    }
  });

  // ── POST /api/auth/start-reauth ───────────────────────────────────────────
  // Inactivity lock reauth — Step 1.
  // Requires a valid Bearer token (the AAL1 session that was locked out).
  // Identity comes from the token, not the request body.
  router.post('/start-reauth', async (req, res, next) => {
    try {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) return res.status(401).json({ error: 'Authentication required.' });

      const { data: userData, error: userErr } = await d.supabaseAdmin.auth.getUser(token);
      if (userErr || !userData?.user) {
        return res.status(401).json({ error: 'Invalid or expired session.' });
      }
      const user = userData.user;

      const profile = await findProfileById(user.id);
      if (!profile || !profile.active) {
        return res.status(403).json({ error: 'Account is disabled.' });
      }

      const verifiedFactor = await findVerifiedTotpFactor(user.id);
      if (!verifiedFactor) {
        return res.status(422).json({ error: 'No authenticator app enrolled.' });
      }

      await d.supabaseAdmin
        .from('login_transactions')
        .delete()
        .eq('email', user.email)
        .lt('expires_at', new Date().toISOString());

      const { data: tx, error: txErr } = await d.supabaseAdmin
        .from('login_transactions')
        .insert({
          email: user.email,
          user_id: user.id,
          factor_id: verifiedFactor.id,
          expires_at: new Date(Date.now() + LOGIN_TX_TTL_MS).toISOString(),
        })
        .select('id')
        .single();

      if (txErr) throw txErr;

      res.json({ transactionId: tx.id });
    } catch (e) {
      next(e);
    }
  });

  // ── POST /api/auth/verify-reauth ──────────────────────────────────────────
  // Inactivity lock reauth — Step 2.
  // Requires Bearer token. Identity comes from token; transaction must belong
  // to the same user_id. Request body email, if present, is ignored.
  router.post('/verify-reauth', async (req, res, next) => {
    try {
      const schema = z.object({
        transactionId: z.string().uuid(),
        code: z.string().length(6).regex(/^\d{6}$/),
      });
      const { transactionId, code } = schema.parse(req.body);

      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) return res.status(401).json({ error: 'Authentication required.' });

      const { data: userData, error: userErr } = await d.supabaseAdmin.auth.getUser(token);
      if (userErr || !userData?.user) {
        return res.status(401).json({ error: 'Invalid or expired session.' });
      }
      const user = userData.user;

      const profile = await findProfileById(user.id);
      if (!profile || !profile.active) {
        return res.status(403).json({ error: 'Account is disabled.' });
      }

      // Fetch transaction, scoped to this user (prevents cross-user replay).
      const { data: tx } = await d.supabaseAdmin
        .from('login_transactions')
        .select('*')
        .eq('id', transactionId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!tx) return res.status(401).json({ error: 'Invalid or expired reauth session.' });
      if (tx.locked_at) return res.status(423).json({ error: 'Too many attempts. Please try again.' });
      if (new Date(tx.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Reauth session expired.' });
      }

      const didReserve = await reserveTransaction('login_transactions', tx);
      if (!didReserve) {
        return res.status(409).json({ error: 'Another verification is in progress. Please retry.' });
      }

      let aal2Tokens;
      try {
        const aal1Token = await getUserAal1Session(user.email);
        const { data: verifyData, error: verifyErr } = await d
          .supabaseAsUser(aal1Token)
          .auth.mfa.challengeAndVerify({ factorId: tx.factor_id, code });

        if (verifyErr) {
          if (isInvalidTotpVerificationError(verifyErr)) {
            await recordInvalidTotpAttempt('login_transactions', tx);
            return res.status(401).json({ error: 'Invalid authenticator code.' });
          }
          return sendVerificationFailure(res, 'login_transactions', transactionId);
        }
        aal2Tokens = verifyData;
      } catch (e) {
        return sendVerificationFailure(res, 'login_transactions', transactionId);
      }

      await d.supabaseAdmin
        .from('login_transactions')
        .delete()
        .eq('id', transactionId);

      res.json({ access_token: aal2Tokens.access_token, refresh_token: aal2Tokens.refresh_token });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request.' });
      }
      next(e);
    }
  });

  return router;
}

export default createAuthRouter();
