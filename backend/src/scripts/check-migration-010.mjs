// run-migration-010.mjs
// Runs migration 0010 by executing each DDL statement via Supabase admin
// Usage: node run-migration-010.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://twmadauhauuypioznpus.supabase.co';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3bWFkYXVoYXV1eXBpb3pucHVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODczOTU1MCwiZXhwIjoyMDk0MzE1NTUwfQ._5U3_NVikbUzLkhy8Og6CMx0tL_-HTwu9pI0l8wMZNg';

const client = createClient(SUPABASE_URL, SERVICE_KEY, {
  db: { schema: 'public' },
});

// ── Step 1: Try to add 'confirming' to request_status enum ──────────
// We can't run raw DDL via the REST client, so we use the approach of
// inserting a dummy row with the new status — Supabase Management API only.
// Instead, we check if it already exists, then use the Management API.
async function runMigration() {
  const _mgmtBase = `https://api.supabase.com/v1/projects/twmadauhauuypioznpus/database/query`;
  // The Management API requires a personal access token, not service key.
  // Fall back: check if the table already exists, and report what to do manually.

  console.log('\n========================================');
  console.log('  Migration 0010 - Fix Checker');
  console.log('========================================\n');

  // Check 1: Does employee_cafeteria_preferences exist?
  const { data: _tableData, error: tableErr } = await client
    .from('employee_cafeteria_preferences')
    .select('id')
    .limit(1);

  if (tableErr && tableErr.code === '42P01') {
    console.log('❌ employee_cafeteria_preferences does NOT exist yet.');
    console.log('   → You must run the SQL manually in the Supabase SQL Editor.');
  } else if (tableErr) {
    console.log('⚠️  employee_cafeteria_preferences check error:', tableErr.message);
  } else {
    console.log('✅ employee_cafeteria_preferences EXISTS');
  }

  // Check 2: Does the 'confirming' enum value exist?
  // Try inserting a test row to the requests table with status = confirming
  // (we'll immediately delete it)
  const _testId = '00000000-0000-0000-0000-000000000001';
  const { error: enumErr } = await client
    .from('requests')
    .select('status')
    .eq('status', 'confirming')
    .limit(1);
  if (enumErr?.message?.includes('invalid input value for enum')) {
    console.log("❌ 'confirming' enum value does NOT exist in request_status.");
    console.log('   → You must run the SQL manually in the Supabase SQL Editor.');
  } else if (enumErr) {
    console.log('⚠️  Enum check error:', enumErr.message);
  } else {
    console.log("✅ 'confirming' enum value is VALID in request_status");
  }

  console.log('\n========================================');
  console.log('If any ❌ above, open Supabase SQL Editor at:');
  console.log('https://supabase.com/dashboard/project/twmadauhauuypioznpus/sql/new');
  console.log('and paste the contents of:');
  console.log('  supabase/migrations/0010_fix_cafeteria_prefs_and_status_enum.sql');
  console.log('then click Run.');
  console.log('========================================\n');
}

runMigration().catch(console.error);
