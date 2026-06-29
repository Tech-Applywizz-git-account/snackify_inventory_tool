import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Use the anon key from frontend .env.local
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3bWFkYXVoYXV1eXBpb3pucHVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3Mzk1NTAsImV4cCI6MjA5NDMxNTU1MH0.C1dbNUr_2YT08diG4n8zATsqMf-gyIw3xQwT3Eb1QGo';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env variables.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function generateTOTP(secret) {
  function base32tohex(base32) {
    const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    let hex = '';
    for (let i = 0; i < base32.length; i++) {
      const val = base32chars.indexOf(base32.charAt(i).toUpperCase());
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, '0');
    }
    for (let i = 0; i + 4 <= bits.length; i += 4) {
      const chunk = bits.substr(i, 4);
      hex = hex + parseInt(chunk, 2).toString(16);
    }
    return hex;
  }

  const key = Buffer.from(base32tohex(secret), 'hex');
  const epoch = Math.round(Date.now() / 1000.0);
  const time = Buffer.alloc(8);
  const timeStep = Math.floor(epoch / 30);
  time.writeUInt32BE(Math.floor(timeStep / 0x100000000), 0);
  time.writeUInt32BE(timeStep & 0xffffffff, 4);

  const hmac = crypto.createHmac('sha1', key);
  hmac.update(time);
  const hmacResult = hmac.digest();

  const offset = hmacResult[hmacResult.length - 1] & 0xf;
  let code =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);

  code = code % 1000000;
  return code.toString().padStart(6, '0');
}

async function cleanAndCreateUser(email, role) {
  console.log(`Setting up ${email} with role: ${role}...`);

  // 1. Delete if existing
  const {
    data: { users },
    error: listErr,
  } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) throw listErr;
  const existing = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    console.log(`  Deleting existing user ${email}...`);
    await supabaseAdmin.auth.admin.deleteUser(existing.id);
  }

  // 2. Create user
  const {
    data: { user },
    error: createErr,
  } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: 'Applywizz@2026',
    email_confirm: true,
    user_metadata: { full_name: email.split('@')[0] },
  });
  if (createErr) throw createErr;
  console.log(`  User created: ${user.id}`);

  // 3. Set Profile role
  const { error: profileErr } = await supabaseAdmin
    .from('profiles')
    .update({ role, full_name: email.split('@')[0] })
    .eq('id', user.id);

  // Try inserting if update fails (or maybe check first)
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) {
    const { error: insertErr } = await supabaseAdmin
      .from('profiles')
      .insert({ id: user.id, role, full_name: email.split('@')[0] });
    if (insertErr) throw insertErr;
  } else {
    if (profileErr) throw profileErr;
  }
  console.log(`  Profile verified.`);

  // 4. Authenticate client and enroll MFA
  const { data: sessionData, error: loginErr } = await supabaseClient.auth.signInWithPassword({
    email,
    password: 'Applywizz@2026',
  });
  if (loginErr) throw loginErr;
  console.log(`  Signed in client. Enrolling TOTP...`);

  // We need to set the session on the client
  const clientWithSession = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${sessionData.session.access_token}`,
      },
    },
  });

  const { data: enrollData, error: enrollErr } = await clientWithSession.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Test Authenticator',
  });
  if (enrollErr) throw enrollErr;
  console.log(`  TOTP Enrolled. Secret: ${enrollData.totp.secret}, FactorID: ${enrollData.id}`);

  // 5. Challenge & verify to make it AAL2 (verified)
  const totpCode = generateTOTP(enrollData.totp.secret);
  console.log(`  Generated test TOTP code: ${totpCode}`);

  const { data: challengeData, error: challengeErr } = await clientWithSession.auth.mfa.challenge({
    factorId: enrollData.id,
  });
  if (challengeErr) throw challengeErr;

  const { error: verifyErr } = await clientWithSession.auth.mfa.verify({
    factorId: enrollData.id,
    challengeId: challengeData.id,
    code: totpCode,
  });
  if (verifyErr) throw verifyErr;
  console.log(`  TOTP Factor verified successfully!`);

  // Ensure onboarding preferences are set to completed so the onboarding screen is bypassed
  const { error: prefErr } = await supabaseAdmin.from('employee_cafeteria_preferences').upsert({
    user_id: user.id,
    onboarding_completed: true,
    notification_tone: 'Friendly',
    drink_prefs: ['CCD Coffee', 'Regular Tea'],
  });
  if (prefErr) throw prefErr;
  console.log(`  Onboarding preferences set to completed.`);

  return {
    email,
    userId: user.id,
    mfaSecret: enrollData.totp.secret,
    factorId: enrollData.id,
  };
}

async function main() {
  try {
    const employee = await cleanAndCreateUser('employee@applywizz.ai', 'staff');
    const officeboy = await cleanAndCreateUser('officeboy@applywizz.ai', 'office_boy');

    const creds = { employee, officeboy };
    const outPath = path.resolve('../frontend/tests/test-credentials.json');
    fs.writeFileSync(outPath, JSON.stringify(creds, null, 2), 'utf8');
    console.log(`\nSuccessfully wrote credentials to: ${outPath}`);
    process.exit(0);
  } catch (err) {
    console.error('Setup failed:', err);
    process.exit(1);
  }
}

main();
