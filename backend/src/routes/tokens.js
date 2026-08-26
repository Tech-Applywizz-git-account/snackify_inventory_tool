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
        const digits = String(retry.data?.cafeteria_card_number || '').replace(/\D/g, '');
        return {
          cafeteria_card_number: digits.length === 12 ? digits : null,
          card_masked: digits.length === 12 ? `xxxx xxxx ${digits.slice(-4)}` : null,
          cardholder: retry.data?.preferred_name || retry.data?.full_name || '',
          color: 'neon',
          display_name: retry.data?.preferred_name || retry.data?.full_name || '',
        };
      }
      return empty;
    }
    const digits = String(data?.cafeteria_card_number || '').replace(/\D/g, '');
    return {
      cafeteria_card_number: digits.length === 12 ? digits : null,
      card_masked: digits.length === 12 ? `xxxx xxxx ${digits.slice(-4)}` : null,
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

    res.json({
      wallet,
      card,
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
