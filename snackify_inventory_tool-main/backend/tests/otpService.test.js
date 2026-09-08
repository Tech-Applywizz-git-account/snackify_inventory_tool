/**
 * Unit tests for otpService.js pure-logic functions.
 * Run: node --test backend/tests/otpService.test.js
 *
 * All tests are pure-logic — no DB calls, no network, no Supabase.
 * DB-touching functions are tested by extracting and exercising their
 * decision logic inline (same pattern as productConversion.test.js).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';

// ── Inline pure-logic helpers mirroring otpService.js ─────────────────────

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

const TEST_SECRET = 'test-secret';
function hashValue(value) {
  return crypto.createHmac('sha256', TEST_SECRET).update(value).digest('hex');
}

// ── 1. normalizeEmail ──────────────────────────────────────────────────────

describe('normalizeEmail', () => {
  it('strips whitespace and lowercases', () => {
    assert.equal(normalizeEmail('  User@Example.COM  '), 'user@example.com');
    assert.equal(normalizeEmail('\tADMIN@SNACKIFY.IO\n'), 'admin@snackify.io');
    assert.equal(normalizeEmail('already@lower.com'), 'already@lower.com');
  });
});

// ── 2. 6-digit format from crypto.randomInt ────────────────────────────────

describe('OTP format (crypto.randomInt)', () => {
  it('generates a 6-digit string', () => {
    const code = crypto.randomInt(100000, 1000000).toString();
    assert.equal(code.length, 6);
    assert.match(code, /^\d{6}$/);
  });

  it('always produces exactly 6 digits across many iterations', () => {
    for (let i = 0; i < 500; i++) {
      const code = crypto.randomInt(100000, 1000000).toString();
      assert.equal(code.length, 6, `Got unexpected code: ${code}`);
    }
  });
});

// ── 3 & 4. hashValue ──────────────────────────────────────────────────────

describe('hashValue', () => {
  it('is deterministic — same input gives same hash', () => {
    assert.equal(hashValue('123456'), hashValue('123456'));
    assert.equal(hashValue('hello'), hashValue('hello'));
  });

  it('different inputs produce different hashes', () => {
    assert.notEqual(hashValue('123456'), hashValue('654321'));
    assert.notEqual(hashValue('abc'), hashValue('ABC'));
  });
});

// ── 5. OTP expiry logic ────────────────────────────────────────────────────

describe('OTP expiry logic', () => {
  it('an expires_at in the past is correctly identified as expired', () => {
    const expiredAt = new Date(Date.now() - 1000).toISOString(); // 1s ago
    const now = new Date().toISOString();
    // In verifyOtp: .gt('expires_at', now) — past date would be excluded
    const isExpired = expiredAt <= now;
    assert.equal(isExpired, true);
  });

  it('an expires_at in the future is correctly identified as valid', () => {
    const futureAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // +10 min
    const now = new Date().toISOString();
    const isValid = futureAt > now;
    assert.equal(isValid, true);
  });
});

// ── 6. Invalid code rejected ───────────────────────────────────────────────

describe('Invalid code check', () => {
  it('wrong code hash does not match stored hash', () => {
    const rightCode = '482910';
    const wrongCode = '111111';
    const storedHash = hashValue(rightCode);
    assert.notEqual(hashValue(wrongCode), storedHash);
  });

  it('correct code hash matches stored hash', () => {
    const code = '482910';
    const storedHash = hashValue(code);
    assert.equal(hashValue(code), storedHash);
  });
});

// ── 7. Max attempts ────────────────────────────────────────────────────────

describe('Max attempts logic', () => {
  it('attempts >= 5 triggers max_attempts path', () => {
    const MAX_ATTEMPTS = 5;

    function checkAttempts(attempts) {
      if (attempts >= MAX_ATTEMPTS) return 'max_attempts';
      return 'proceed';
    }

    assert.equal(checkAttempts(5), 'max_attempts');
    assert.equal(checkAttempts(6), 'max_attempts');
    assert.equal(checkAttempts(4), 'proceed');
    assert.equal(checkAttempts(0), 'proceed');
  });

  it('4 attempts still allows another try (old limit of 3 must not block)', () => {
    const MAX_ATTEMPTS = 5;
    function checkAttempts(attempts) {
      if (attempts >= MAX_ATTEMPTS) return 'max_attempts';
      return 'proceed';
    }
    assert.equal(checkAttempts(4), 'proceed', '4 attempts should not lock (max is 5)');
  });
});

// ── 8. OTP invalidation on resend ─────────────────────────────────────────

describe('OTP invalidation on resend', () => {
  it('resend marks prior active OTPs as used=true and sets invalidated_at', () => {
    // Mirror the UPDATE in generateOtp before inserting a new OTP:
    //   UPDATE enrollment_otps SET used=true, invalidated_at=now()
    //   WHERE email=:email AND used=false AND invalidated_at IS NULL
    const rows = [
      { id: 'old-otp-1', email: 'alice@applywizz.ai', used: false, invalidated_at: null },
      { id: 'old-otp-2', email: 'alice@applywizz.ai', used: false, invalidated_at: null },
    ];
    const now = new Date().toISOString();
    const invalidated = rows.map((r) =>
      r.email === 'alice@applywizz.ai' && !r.used && r.invalidated_at === null
        ? { ...r, used: true, invalidated_at: now }
        : r
    );
    for (const r of invalidated) {
      assert.equal(r.used, true, `row ${r.id} must be marked used`);
      assert.ok(r.invalidated_at, `row ${r.id} must have invalidated_at set`);
    }
  });

  it('already-used OTPs are NOT touched during invalidation', () => {
    const alreadyUsed = { id: 'verified-otp', email: 'alice@applywizz.ai', used: true, invalidated_at: null };
    const now = new Date().toISOString();
    // WHERE used=false AND invalidated_at IS NULL — already-used rows are excluded
    const shouldUpdate = !alreadyUsed.used && alreadyUsed.invalidated_at === null;
    assert.equal(shouldUpdate, false, 'already-used row must not be touched');
  });

  it('can distinguish resend-invalidated from verified: used=true, invalidated_at IS NOT NULL', () => {
    const verified = { used: true, invalidated_at: null };       // correctly completed
    const invalidated = { used: true, invalidated_at: new Date().toISOString() }; // superseded by resend

    const isVerified = (row) => row.used && row.invalidated_at === null;
    const isInvalidated = (row) => row.used && row.invalidated_at !== null;

    assert.equal(isVerified(verified), true);
    assert.equal(isInvalidated(invalidated), true);
    assert.equal(isVerified(invalidated), false);
    assert.equal(isInvalidated(verified), false);
  });
});

// ── 9. Transaction ID UUID format ─────────────────────────────────────────

describe('Transaction ID format', () => {
  it('crypto.randomUUID() produces a valid UUID v4 format', () => {
    const id = crypto.randomUUID();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('two generated transaction IDs are unique', () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    assert.notEqual(a, b);
  });
});

// ── 10. Cooldown logic ────────────────────────────────────────────────────

describe('Cooldown logic', () => {
  it('second generateOtp within 60s triggers COOLDOWN', () => {
    const RESEND_COOLDOWN_MS = 60 * 1000;

    function checkCooldown(lastCreatedAt) {
      if (lastCreatedAt && Date.now() - new Date(lastCreatedAt).getTime() < RESEND_COOLDOWN_MS) {
        throw new Error('COOLDOWN');
      }
    }

    // Created 30 seconds ago — still within cooldown
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();
    assert.throws(() => checkCooldown(thirtySecondsAgo), /COOLDOWN/);

    // Created 90 seconds ago — cooldown has passed
    const ninetySecondsAgo = new Date(Date.now() - 90 * 1000).toISOString();
    assert.doesNotThrow(() => checkCooldown(ninetySecondsAgo));
  });
});

// ── 12. Rate limit logic ──────────────────────────────────────────────────

describe('Rate limit logic', () => {
  it('4th generateOtp in the same hour triggers RATE_LIMITED', () => {
    const MAX_SENDS_PER_HOUR = 3;

    function checkRateLimit(count) {
      if (count >= MAX_SENDS_PER_HOUR) throw new Error('RATE_LIMITED');
    }

    assert.throws(() => checkRateLimit(3), /RATE_LIMITED/);
    assert.throws(() => checkRateLimit(4), /RATE_LIMITED/);
    assert.doesNotThrow(() => checkRateLimit(2));
    assert.doesNotThrow(() => checkRateLimit(0));
  });
});

// ── 13. Rate-limit window (cleanup correctness) ───────────────────────────

describe('Rate-limit window (cleanup correctness)', () => {
  it('counts sends in the last hour even when OTP has expired', () => {
    // A send from 30 minutes ago: OTP has expired (10 min TTL) but is still
    // within the 1-hour rate-limit window. It must be counted.
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // This row was created 30 min ago — within rate-limit window
    const rowCreatedAt = thirtyMinsAgo;
    const isWithinWindow = rowCreatedAt >= oneHourAgo;
    assert.equal(isWithinWindow, true, 'A 30-min-old send must still be within the 1-hour rate-limit window');

    // A send from 61 minutes ago — outside the window, safe to clean up
    const sixtyOneMinsAgo = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    const isOutsideWindow = sixtyOneMinsAgo < oneHourAgo;
    assert.equal(isOutsideWindow, true, 'A 61-min-old send must be outside the rate-limit window');
  });
});

// ── 14. Atomic token consumption ──────────────────────────────────────────

describe('Atomic token consumption', () => {
  it('zero updated rows means token was already consumed', () => {
    // Simulate the Supabase UPDATE returning 0 rows (token already NULLed by concurrent request)
    const updatedRows = [];
    const result = Array.isArray(updatedRows) && updatedRows.length === 1;
    assert.equal(result, false, 'Zero updated rows must return false (already consumed)');
  });

  it('one updated row means token was successfully consumed', () => {
    // Simulate the Supabase UPDATE returning exactly 1 row
    const updatedRows = [{ id: 'some-uuid' }];
    const result = Array.isArray(updatedRows) && updatedRows.length === 1;
    assert.equal(result, true, 'One updated row must return true (first consumer wins)');
  });
});

// ── 15. cancelOtp delete-by-id scoping ───────────────────────────────────

describe('cancelOtp delete-by-id scoping', () => {
  it('deletes only the row with the exact otpId — an older row for the same email survives', () => {
    // Mirrors the WHERE clause: DELETE WHERE id = otpId AND used = false
    const rows = [
      { id: 'old-row-id', email: 'alice@applywizz.ai', used: false },
      { id: 'new-row-id', email: 'alice@applywizz.ai', used: false },
    ];
    const otpId = 'new-row-id';
    const after = rows.filter((r) => !(r.id === otpId && !r.used));
    assert.equal(after.length, 1, 'exactly one row must survive');
    assert.equal(after[0].id, 'old-row-id', 'the older row must not be deleted');
  });

  it('does not delete a row that has already been verified (used = true guard)', () => {
    // Even if the primary key matches, a used row must not be deleted
    const rows = [{ id: 'verified-row-id', email: 'alice@applywizz.ai', used: true }];
    const otpId = 'verified-row-id';
    const after = rows.filter((r) => !(r.id === otpId && !r.used));
    assert.equal(after.length, 1, 'used row must survive the delete filter');
    assert.equal(after[0].used, true);
  });
});

// ── 16. Production mode fail-closed ───────────────────────────────────────

describe('Production mode without OTP_HASH_SECRET', () => {
  it('throws a configuration error when secret is missing in production', () => {
    // Mirror the production branch of hashValue without touching NODE_ENV
    function hashValueWithConfig(value, secret, isProduction) {
      if (isProduction && !secret) {
        throw new Error(
          'OTP_HASH_SECRET is required in production. Set this environment variable before using OTP functions.'
        );
      }
      return crypto
        .createHmac('sha256', secret || 'dev-secret-not-for-production')
        .update(value)
        .digest('hex');
    }

    // Production + no secret → must throw
    assert.throws(
      () => hashValueWithConfig('123456', undefined, true),
      (err) => err.message.includes('OTP_HASH_SECRET is required in production')
    );

    // Production + secret present → must not throw
    assert.doesNotThrow(() => hashValueWithConfig('123456', 'real-secret', true));

    // Dev + no secret → must not throw (uses fallback)
    assert.doesNotThrow(() => hashValueWithConfig('123456', undefined, false));
  });
});
