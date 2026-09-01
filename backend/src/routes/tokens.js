import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';
import {
  ensureMonthGrant,
  loadCatalog,
  attachTokenPrice,
  walletForUser,
  mealTokenPrice,
  MONTHLY_GRANT,
} from '../lib/tokens.js';

const router = Router();

function nextWorkingDate() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const d = new Date(Date.UTC(ist.getFullYear(), ist.getMonth(), ist.getDate()));
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function cardForUser(userId) {
  const empty = { cafeteria_card_number: null, card_masked: null, cardholder: '', color: 'neon', display_name: '' };
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('cafeteria_card_number, preferred_name, full_name, cafeteria_card_color, cafeteria_card_display_name')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      if (/cafeteria_card_color|cafeteria_card_display_name/i.test(error.message || '')) {
        const retry = await supabaseAdmin
          .from('profiles')
          .select('cafeteria_card_number, preferred_name, full_name')
          .eq('id', userId)
          .maybeSingle();
        const code = String(retry.data?.cafeteria_card_number || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        return {
          cafeteria_card_number: code || null,
          card_masked: code ? code.replace(/(.{4})/g, '$1 ').trim() : null,
          cardholder: retry.data?.preferred_name || retry.data?.full_name || '',
          color: 'neon',
          display_name: retry.data?.preferred_name || retry.data?.full_name || '',
        };
      }
      return empty;
    }
    const code = String(data?.cafeteria_card_number || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return {
      cafeteria_card_number: code || null,
      card_masked: code ? code.replace(/(.{4})/g, '$1 ').trim() : null,
      cardholder: data?.cafeteria_card_display_name || data?.preferred_name || data?.full_name || '',
      color: data?.cafeteria_card_color || 'neon',
      display_name: data?.cafeteria_card_display_name || data?.preferred_name || data?.full_name || '',
    };
  } catch {
    return empty;
  }
}

router.get('/catalog', async (_req, res, next) => {
  try {
    res.json({ items: await loadCatalog(), monthly_grant: MONTHLY_GRANT, coin_value_inr: 1 });
  } catch (e) {
    next(e);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const wallet = await walletForUser(req.user.id);
    const card = await cardForUser(req.user.id);
    const { data: ledger } = await supabaseAdmin
      .from('token_usage')
      .select('id, tokens_delta, balance_after, reason, ref_type, ref_id, lines, print_status, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(40);
    res.json({ wallet, ledger: ledger || [], card });
  } catch (e) {
    next(e);
  }
});

router.get('/bootstrap', async (req, res, next) => {
  try {
    const catalog = await loadCatalog();
    const wallet = await walletForUser(req.user.id);
    const card = await cardForUser(req.user.id);
    const mealDate = nextWorkingDate();
    const mealPrice = await mealTokenPrice(mealDate, catalog);

    const { data: menuRows } = await supabaseAdmin
      .from('cafeteria_items')
      .select('*')
      .eq('available', true)
      .neq('visible_to_employees', false)
      .order('sort_order', { ascending: true });

    const menu = (menuRows || []).map((row) => attachTokenPrice(row, catalog));

    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data: openOrders } = await supabaseAdmin
      .from('requests')
      .select('*')
      .eq('submitted_by', req.user.id)
      .in('status', ['confirming', 'pending', 'in_progress'])
      .gt('created_at', twelveHoursAgo)
      .order('created_at', { ascending: false })
      .limit(20);

    const { data: ledger } = await supabaseAdmin
      .from('token_usage')
      .select('id, tokens_delta, balance_after, reason, ref_type, ref_id, lines, print_status, print_error, created_at, printed_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(30);

    const { data: printQueue } = await supabaseAdmin
      .from('token_usage')
      .select('id, ref_type, ref_id, lines, print_status, print_error, print_attempts, created_at')
      .eq('user_id', req.user.id)
      .in('print_status', ['pending', 'printing', 'failed'])
      .order('created_at', { ascending: false })
      .limit(20);

    const { data: mealBooking } = await supabaseAdmin
      .from('meal_bookings')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('meal_date', mealDate)
      .maybeSingle();

    let profileRow = null;
    {
      const first = await supabaseAdmin
        .from('profiles')
        .select('preferred_name, employee_code, full_name')
        .eq('id', req.user.id)
        .maybeSingle();
      if (first.error && /employee_code/i.test(first.error.message || '')) {
        const retry = await supabaseAdmin
          .from('profiles')
          .select('preferred_name, full_name')
          .eq('id', req.user.id)
          .maybeSingle();
        profileRow = retry.data;
      } else {
        profileRow = first.data;
      }
    }

    res.json({
      wallet,
      card,
      profile: {
        preferred_name: profileRow?.preferred_name || '',
        employee_code: profileRow?.employee_code || '',
        full_name: profileRow?.full_name || '',
      },
      catalog,
      menu,
      open_orders: openOrders || [],
      ledger: ledger || [],
      print_queue: printQueue || [],
      meal_options: {
        date: mealDate,
        token_price: mealPrice,
        booking: mealBooking || null,
      },
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/profile', async (req, res, next) => {
  try {
    const preferredName = String(req.body?.preferred_name || '').trim().slice(0, 50);
    const employeeCode = String(req.body?.employee_code || '').trim().slice(0, 32);
    if (!preferredName) {
      return res.status(400).json({ error: 'Enter a username.' });
    }
    let { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        preferred_name: preferredName,
        ...(employeeCode ? { employee_code: employeeCode } : {}),
      })
      .eq('id', req.user.id)
      .select('id, preferred_name, full_name, employee_code')
      .single();
    if (error && /employee_code/i.test(error.message || '')) {
      const retry = await supabaseAdmin
        .from('profiles')
        .update({ preferred_name: preferredName })
        .eq('id', req.user.id)
        .select('id, preferred_name, full_name')
        .single();
      data = retry.data;
      error = retry.error;
    }
    if (error) throw error;
    res.json({
      ok: true,
      preferred_name: data?.preferred_name || preferredName,
      employee_code: data?.employee_code || employeeCode || null,
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/card-style', async (req, res, next) => {
  try {
    const allowed = new Set(['neon', 'gold', 'emerald', 'ruby', 'ocean', 'midnight']);
    const color = String(req.body?.color || 'neon').toLowerCase();
    if (!allowed.has(color)) {
      return res.status(400).json({ error: 'Pick a valid card color.' });
    }
    const displayName = String(req.body?.display_name || '').trim().slice(0, 22);
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        cafeteria_card_color: color,
        cafeteria_card_display_name: displayName || null,
      })
      .eq('id', req.user.id);
    if (error) throw error;
    const card = await cardForUser(req.user.id);
    res.json({ ok: true, card });
  } catch (e) {
    next(e);
  }
});

router.get('/print-queue', requireRole('office_boy', 'facility_manager', 'leadership'), async (_req, res, next) => {
  try {
    const { data: cafeteria } = await supabaseAdmin
      .from('token_usage')
      .select('id, user_id, lines, tokens_delta, print_status, print_error, print_attempts, created_at, ref_id, ref_type')
      .in('print_status', ['pending', 'printing', 'failed'])
      .order('created_at', { ascending: true })
      .limit(100);
    const { data: meals } = await supabaseAdmin
      .from('meal_print_jobs')
      .select('*')
      .in('status', ['pending', 'printing', 'failed'])
      .order('scheduled_for', { ascending: true })
      .limit(50);
    res.json({ cafeteria: cafeteria || [], meals: meals || [] });
  } catch (e) {
    next(e);
  }
});

router.post('/ensure-monthly', async (req, res, next) => {
  try {
    const grant = await ensureMonthGrant(req.user.id);
    const wallet = await walletForUser(req.user.id);
    res.json({ ok: true, grant, wallet });
  } catch (e) {
    next(e);
  }
});

router.post('/grant-all', requireRole('leadership'), async (_req, res, next) => {
  try {
    const { data: users, error } = await supabaseAdmin
      .from('profiles')
      .select('id');
    if (error) throw error;
    let granted = 0;
    for (const u of users || []) {
      const r = await ensureMonthGrant(u.id);
      if (r?.granted) granted += 1;
    }
    res.json({ ok: true, granted, total: (users || []).length });
  } catch (e) {
    next(e);
  }
});

export default router;
