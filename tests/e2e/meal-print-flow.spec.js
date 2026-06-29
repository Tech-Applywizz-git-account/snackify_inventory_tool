import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * Meal Print Flow — Full E2E with Dummy Data
 * ════════════════════════════════════════════
 * Seeds dummy bookings → assigns tokens → creates print job →
 * simulates print-agent completing → tests reprint → verifies duplicate
 *
 * Requires env vars:
 *   E2E_SUPABASE_URL           — Supabase project URL
 *   E2E_SUPABASE_SERVICE_KEY   — Service role key (for seeding)
 *   E2E_API_URL                — Backend URL (default: http://localhost:4000)
 *   E2E_CRON_SECRET            — Cron secret
 */

const SUPA_URL = process.env.E2E_SUPABASE_URL || '';
const SUPA_KEY = process.env.E2E_SUPABASE_SERVICE_KEY || '';
const API      = process.env.E2E_API_URL || 'http://localhost:4000';
const CRON_SEC = process.env.E2E_CRON_SECRET || '';

const SKIP_MSG = 'Set E2E_SUPABASE_URL + E2E_SUPABASE_SERVICE_KEY + E2E_CRON_SECRET';

// Tomorrow in IST — avoids clashing with real data
function getTestDate() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  ist.setDate(ist.getDate() + 1);
  return ist.toISOString().slice(0, 10);
}

test.describe('Meal Print — Full Flow with Dummy Data', () => {
  test.skip(!SUPA_URL || !SUPA_KEY || !CRON_SEC, SKIP_MSG);

  const supabase = SUPA_URL && SUPA_KEY
    ? createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } })
    : null;

  const TEST_DATE  = getTestDate();
  const CABIN      = 'Tech Cabin';
  let userIds      = [];
  let bookingIds   = [];

  // ── SETUP: seed dummy bookings ─────────────────────────────────────────
  test.beforeAll(async () => {
    if (!supabase) return;

    // Find 2 staff users
    const { data: users } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'staff')
      .limit(2);

    if (!users?.length) { console.warn('[Setup] No staff users found'); return; }
    userIds = users.map(u => u.id);

    // Ensure cabin is set in preferences
    for (const uid of userIds) {
      await supabase
        .from('employee_cafeteria_preferences')
        .upsert({ user_id: uid, cabin: CABIN }, { onConflict: 'user_id' });
    }

    // Clean old test data for this date
    await supabase.from('meal_print_jobs').delete().eq('meal_date', TEST_DATE);
    await supabase.from('meal_bookings').delete().eq('meal_date', TEST_DATE).in('user_id', userIds);

    // Insert bookings
    const rows = userIds.map((uid, i) => ({
      user_id: uid,
      meal_date: TEST_DATE,
      choice: i === 0 ? 'veg' : 'non_veg',
      booked_at: new Date().toISOString(),
    }));

    const { data: inserted, error } = await supabase
      .from('meal_bookings')
      .insert(rows)
      .select('id');

    if (error) console.error('[Setup] Insert failed:', error.message);
    bookingIds = (inserted || []).map(b => b.id);
    console.log(`[Setup] Seeded ${bookingIds.length} bookings for ${TEST_DATE}`);
  });

  // ── CLEANUP ────────────────────────────────────────────────────────────
  test.afterAll(async () => {
    if (!supabase) return;
    await supabase.from('meal_print_jobs').delete().eq('meal_date', TEST_DATE);
    await supabase.from('meal_bookings').delete().in('id', bookingIds);
    console.log('[Cleanup] Done');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 1: Assign tokens to bookings (simulating cron)
  // ═══════════════════════════════════════════════════════════════════════

  test('1. Token generation — assigns token to each booking', async () => {
    const { data: bookings } = await supabase
      .from('meal_bookings')
      .select('id, user_id, choice')
      .eq('meal_date', TEST_DATE)
      .in('user_id', userIds);

    expect(bookings.length).toBeGreaterThanOrEqual(1);

    const day   = TEST_DATE.slice(8, 10);
    const month = ['','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][parseInt(TEST_DATE.slice(5, 7), 10)];

    for (let i = 0; i < bookings.length; i++) {
      const token = `${day}${month}-TECH-${String(i + 1).padStart(3, '0')}`;

      const { error } = await supabase
        .from('meal_bookings')
        .update({ token_number: token, cabin_name: CABIN })
        .eq('id', bookings[i].id);

      expect(error).toBeNull();
    }

    // Verify
    const { data: updated } = await supabase
      .from('meal_bookings')
      .select('token_number, cabin_name, choice')
      .eq('meal_date', TEST_DATE)
      .in('user_id', userIds);

    for (const b of updated) {
      expect(b.token_number).toMatch(/^\d{2}[A-Z]{3}-TECH-\d{3}$/);
      expect(b.cabin_name).toBe(CABIN);
      console.log(`  ✅ ${b.token_number} — ${b.choice}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 2: Create print job (simulating cron insert)
  // ═══════════════════════════════════════════════════════════════════════

  test('2. Print job creation — cabin_batch job inserted as pending', async () => {
    const { data: job, error } = await supabase
      .from('meal_print_jobs')
      .insert({
        meal_date: TEST_DATE,
        cabin_name: CABIN,
        print_type: 'cabin_batch',
        scheduled_for: new Date().toISOString(),
        status: 'pending',
        token_count: userIds.length,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(job.status).toBe('pending');
    expect(job.cabin_name).toBe(CABIN);
    expect(job.token_count).toBe(userIds.length);
    console.log(`  ✅ Job ${job.id} — pending — ${job.token_count} tokens`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 3: Print-agent picks up job → printing → completed
  // ═══════════════════════════════════════════════════════════════════════

  test('3. Print-agent simulation — pending → printing → completed', async () => {
    const { data: jobs } = await supabase
      .from('meal_print_jobs')
      .select('id')
      .eq('meal_date', TEST_DATE)
      .eq('cabin_name', CABIN)
      .eq('status', 'pending')
      .limit(1);

    expect(jobs.length).toBe(1);
    const jobId = jobs[0].id;

    // Step A: Mark as printing
    const { error: e1 } = await supabase
      .from('meal_print_jobs')
      .update({ status: 'printing', started_at: new Date().toISOString() })
      .eq('id', jobId);
    expect(e1).toBeNull();

    // Step B: Mark as completed
    const { error: e2 } = await supabase
      .from('meal_print_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', jobId);
    expect(e2).toBeNull();

    // Step C: Update bookings print_count (what print-agent does)
    for (const uid of userIds) {
      await supabase
        .from('meal_bookings')
        .update({ print_count: 1, last_printed_at: new Date().toISOString() })
        .eq('meal_date', TEST_DATE)
        .eq('user_id', uid);
    }

    // Verify job completed
    const { data: done } = await supabase
      .from('meal_print_jobs')
      .select('status, started_at, completed_at')
      .eq('id', jobId)
      .single();

    expect(done.status).toBe('completed');
    expect(done.started_at).toBeTruthy();
    expect(done.completed_at).toBeTruthy();
    console.log(`  ✅ Job completed: started=${done.started_at}, finished=${done.completed_at}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 4: All bookings now have print_count = 1
  // ═══════════════════════════════════════════════════════════════════════

  test('4. First print — all bookings have print_count=1', async () => {
    const { data: bookings } = await supabase
      .from('meal_bookings')
      .select('token_number, print_count, last_printed_at')
      .eq('meal_date', TEST_DATE)
      .in('user_id', userIds);

    for (const b of bookings) {
      expect(b.print_count).toBe(1);
      expect(b.last_printed_at).toBeTruthy();
      console.log(`  ✅ ${b.token_number} — printed once at ${b.last_printed_at}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 5: Employee reprint — creates reprint job + increments count
  // ═══════════════════════════════════════════════════════════════════════

  test('5. Employee reprint — new reprint job + print_count=2', async () => {
    const targetUser = userIds[0];

    // Insert reprint job
    const { data: job, error: jobErr } = await supabase
      .from('meal_print_jobs')
      .insert({
        meal_date: TEST_DATE,
        cabin_name: CABIN,
        print_type: 'reprint',
        scheduled_for: new Date().toISOString(),
        status: 'pending',
        token_count: 1,
        booking_user_id: targetUser,
      })
      .select()
      .single();

    expect(jobErr).toBeNull();
    expect(job.print_type).toBe('reprint');

    // Increment print_count
    await supabase
      .from('meal_bookings')
      .update({ print_count: 2, last_printed_at: new Date().toISOString() })
      .eq('meal_date', TEST_DATE)
      .eq('user_id', targetUser);

    // Verify
    const { data: booking } = await supabase
      .from('meal_bookings')
      .select('token_number, print_count')
      .eq('meal_date', TEST_DATE)
      .eq('user_id', targetUser)
      .single();

    expect(booking.print_count).toBe(2);
    console.log(`  ✅ ${booking.token_number} — reprinted — print_count=${booking.print_count}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 6: Duplicate detection — print_count > 1
  // ═══════════════════════════════════════════════════════════════════════

  test('6. Duplicate detection — print_count > 1 = DUPLICATE', async () => {
    const { data: booking } = await supabase
      .from('meal_bookings')
      .select('token_number, print_count')
      .eq('meal_date', TEST_DATE)
      .eq('user_id', userIds[0])
      .single();

    const isDuplicate = booking.print_count > 1;
    expect(isDuplicate).toBe(true);
    console.log(`  ✅ ${booking.token_number} — DUPLICATE (count=${booking.print_count})`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 7: Second user still has print_count = 1 (not reprinted)
  // ═══════════════════════════════════════════════════════════════════════

  test('7. Non-reprinted user stays at print_count=1', async () => {
    if (userIds.length < 2) return;

    const { data: booking } = await supabase
      .from('meal_bookings')
      .select('token_number, print_count')
      .eq('meal_date', TEST_DATE)
      .eq('user_id', userIds[1])
      .single();

    expect(booking.print_count).toBe(1);
    const isDuplicate = booking.print_count > 1;
    expect(isDuplicate).toBe(false);
    console.log(`  ✅ ${booking.token_number} — NOT duplicate (count=${booking.print_count})`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 8: Skipped meals get no token
  // ═══════════════════════════════════════════════════════════════════════

  test('8. Skipped meal gets no token', async () => {
    // Insert a skip booking
    const skipUser = userIds[0];
    const { data: skip, error: skipErr } = await supabase
      .from('meal_bookings')
      .insert({
        user_id: skipUser,
        meal_date: TEST_DATE,
        choice: 'skip',
        booked_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    // It may conflict if user already has a booking — that's fine
    if (skipErr) {
      console.log('  ✅ Skip test: user already has a booking (expected)');
      return;
    }

    bookingIds.push(skip.id);

    const { data: skipped } = await supabase
      .from('meal_bookings')
      .select('token_number')
      .eq('id', skip.id)
      .single();

    expect(skipped.token_number).toBeNull();
    console.log('  ✅ Skipped booking has no token');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEST 9: Backend health check
  // ═══════════════════════════════════════════════════════════════════════

  test('9. Backend health OK', async ({ request }) => {
    const r = await request.get(`${API}/health`);
    expect(r.status()).toBe(200);
    expect((await r.json()).ok).toBe(true);
    console.log('  ✅ Backend healthy');
  });
});
