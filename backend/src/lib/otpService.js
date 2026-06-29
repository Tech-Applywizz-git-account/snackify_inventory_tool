import crypto from 'node:crypto';
import { supabaseAdmin } from './supabase.js';

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 min
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 sec
const MAX_SENDS_PER_HOUR = 3;

const OTP_HASH_SECRET = process.env.OTP_HASH_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!OTP_HASH_SECRET) {
  if (IS_PRODUCTION) {
    console.error(
      '[otpService] FATAL: OTP_HASH_SECRET is required in production but is not set. All OTP operations will fail.'
    );
  } else {
    console.warn(
      '[otpService] OTP_HASH_SECRET is not set — using dev fallback. Never use this in production.'
    );
  }
}

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function hashValue(value) {
  if (IS_PRODUCTION && !OTP_HASH_SECRET) {
    throw new Error(
      'OTP_HASH_SECRET is required in production. Set this environment variable before using OTP functions.'
    );
  }
  return crypto
    .createHmac('sha256', OTP_HASH_SECRET || 'dev-secret-not-for-production')
    .update(value)
    .digest('hex');
}

export async function generateOtp(email) {
  const normalized = normalizeEmail(email);

  // Invalidate all active (unused, non-invalidated) OTPs for this email.
  // This makes resends explicit and distinguishable from consumed OTPs:
  //   used=true, invalidated_at IS NULL  → correctly verified
  //   used=true, invalidated_at IS NOT NULL → superseded by resend
  await supabaseAdmin
    .from('enrollment_otps')
    .update({ used: true, invalidated_at: new Date().toISOString() })
    .eq('email', normalized)
    .eq('used', false)
    .is('invalidated_at', null);

  // Only delete rows outside the rate-limit window (> 1 hour old)
  // Rows within the last hour are preserved for rate-limit counting
  // even after their 10-minute OTP expiry has passed
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await supabaseAdmin
    .from('enrollment_otps')
    .delete()
    .eq('email', normalized)
    .lt('created_at', oneHourAgo);

  // Rate limit: count sends in last 1 hour
  const { count } = await supabaseAdmin
    .from('enrollment_otps')
    .select('id', { count: 'exact', head: true })
    .eq('email', normalized)
    .gte('created_at', oneHourAgo);

  if (count >= MAX_SENDS_PER_HOUR) throw new Error('RATE_LIMITED');

  // Cooldown: check most recent row
  const { data: last } = await supabaseAdmin
    .from('enrollment_otps')
    .select('created_at')
    .eq('email', normalized)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last && Date.now() - new Date(last.created_at).getTime() < RESEND_COOLDOWN_MS) {
    throw new Error('COOLDOWN');
  }

  // Generate cryptographically secure 6-digit code
  const code = crypto.randomInt(100000, 1000000).toString();

  const { data, error } = await supabaseAdmin
    .from('enrollment_otps')
    .insert({
      email: normalized,
      code_hash: hashValue(code),
      expires_at: new Date(Date.now() + OTP_EXPIRY_MS).toISOString(),
      attempts: 0,
      used: false,
    })
    .select('id')
    .single();

  if (error) throw error;

  return { code, otpId: data.id };
}

/**
 * Rescinds a freshly-generated OTP row when delivery fails.
 * Deletes by primary key — only the specific row is affected; older rows for the
 * same email are untouched. The `used = false` guard prevents accidental deletion
 * of a row that was already verified between generate and the failed send.
 */
export async function cancelOtp(otpId) {
  await supabaseAdmin
    .from('enrollment_otps')
    .delete()
    .eq('id', otpId)
    .eq('used', false);
}

export async function verifyOtp(email, code) {
  const normalized = normalizeEmail(email);

  const { data: otp } = await supabaseAdmin
    .from('enrollment_otps')
    .select('*')
    .eq('email', normalized)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!otp) return { valid: false, reason: 'expired_or_not_found' };
  if (otp.attempts >= MAX_ATTEMPTS) return { valid: false, reason: 'max_attempts' };

  // Increment attempts before checking code (prevents enumeration timing attacks)
  await supabaseAdmin
    .from('enrollment_otps')
    .update({ attempts: otp.attempts + 1 })
    .eq('id', otp.id);

  if (hashValue(code) !== otp.code_hash) return { valid: false, reason: 'invalid_code' };

  const { error } = await supabaseAdmin
    .from('enrollment_otps')
    .update({ used: true })
    .eq('id', otp.id);

  if (error) throw error;

  return { valid: true };
}

