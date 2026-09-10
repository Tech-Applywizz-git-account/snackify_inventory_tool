import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';
import { lookupEmployeeIdByEmail } from '../lib/hrms.js';
import { applyMealTokens, refundTokens } from '../lib/tokens.js';
import { getCabinName } from './cron.js';

const roleEnum = z.enum(['facility_manager', 'finance', 'leadership', 'staff', 'office_boy']);
const lateMealChoices = z.enum(['veg', 'egg', 'non_veg']);

function getISTDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getISTParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
}

function mealOptionsForDate(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return {
    1: ['veg'],
    2: ['veg', 'egg'],
    3: ['veg', 'non_veg'],
    4: ['veg', 'egg'],
    5: ['veg', 'non_veg'],
  }[day] || [];
}

function generateLateMealToken(date, cabinName, sequence) {
  const dateObj = new Date(`${date}T00:00:00Z`);
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][dateObj.getUTCMonth()];
  const abbreviation = cabinName === 'Pantry Counter'
    ? 'PTRY'
    : cabinName === 'Unassigned'
      ? 'UNASG'
      : cabinName.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 6) || 'GEN';
  return `${String(dateObj.getUTCDate()).padStart(2, '0')}${month}-${abbreviation}-${String(sequence).padStart(3, '0')}`;
}

// Reads DEFAULT_PASSWORD from env at call time; never falls back to a hardcoded value.
// Named export for focused tests — not a public API.
export function getDefaultPassword() {
  const pw = process.env.DEFAULT_PASSWORD;
  if (!pw) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[admin] DEFAULT_PASSWORD is required in production but is not set');
    } else {
      console.warn('[admin] DEFAULT_PASSWORD is not set — user creation unavailable');
    }
    return null;
  }
  return pw;
}

// Invite emails should always land on the canonical public app URL in production.
// Named export for focused tests — not a public API.
export function getInviteRedirectUrl() {
  const base = process.env.APP_PUBLIC_URL || 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}/dashboard`;
}

export function createAdminRouter(overrides = {}) {
  const d = {
    supabaseAdmin,
    ...overrides,
  };

  const router = Router();

  async function findUserById(userId) {
    const { data, error } = await d.supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 500,
    });
    if (error) throw error;
    return data?.users?.find((user) => user.id === userId) || null;
  }

  async function findVerifiedTotpFactor(userId) {
    const { data, error } = await d.supabaseAdmin.auth.admin.mfa.listFactors({ userId });
    if (error) throw error;
    return (data?.factors ?? []).find(
      (factor) => factor.factor_type === 'totp' && factor.status === 'verified'
    ) || null;
  }

  // Every admin route is leadership-only.
  router.use(requireRole('leadership'));

  // GET /api/admin/users  - all users + their roles, joined with auth.users for email
  router.get('/users', async (_req, res, next) => {
    try {
      let { data: profiles, error: pErr } = await d.supabaseAdmin
        .from('profiles')
        .select('id, full_name, role, preferred_name, employee_code, consumer_report, created_at, cafeteria_card_number')
        .order('created_at', { ascending: true });
      if (pErr && /cafeteria_card_number/i.test(pErr.message || '')) {
        const retry = await d.supabaseAdmin
          .from('profiles')
          .select('id, full_name, role, preferred_name, employee_code, consumer_report, created_at')
          .order('created_at', { ascending: true });
        profiles = retry.data;
        pErr = retry.error;
      }
      if (pErr) throw pErr;

      const { data: usersList, error: uErr } = await d.supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (uErr) throw uErr;

      const emailMap = new Map(usersList.users.map((u) => [u.id, u.email]));

      const rows = profiles.map((p) => ({
        ...p,
        email: emailMap.get(p.id) || null,
      }));
      res.json(rows);
    } catch (e) {
      next(e);
    }
  });

  // GET /api/admin/unbooked-users - active users without today's meal booking
  router.get('/unbooked-users', async (_req, res, next) => {
    try {
      const mealDate = getISTDateString();
      const [{ data: profiles, error: profilesErr }, { data: bookings, error: bookingsErr }] = await Promise.all([
        d.supabaseAdmin
          .from('profiles')
          .select('id, full_name, preferred_name, active, created_at')
          .eq('active', true)
          .order('full_name', { ascending: true }),
        d.supabaseAdmin
          .from('meal_bookings')
          .select('user_id')
          .eq('meal_date', mealDate),
      ]);
      if (profilesErr) throw profilesErr;
      if (bookingsErr) throw bookingsErr;

      const bookedUserIds = new Set((bookings || []).map((booking) => booking.user_id));
      const { data: usersList, error: usersErr } = await d.supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (usersErr) throw usersErr;

      const emailMap = new Map((usersList?.users || []).map((user) => [user.id, user.email]));
      const users = (profiles || [])
        .filter((user) => !bookedUserIds.has(user.id))
        .map((user) => ({ ...user, email: emailMap.get(user.id) || null }));

      res.json({ meal_date: mealDate, users });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/users/:id/role', async (req, res, next) => {
    try {
      const role = roleEnum.parse(req.body.role);
      if (req.params.id === req.user.id && role !== 'leadership') {
        return res.status(400).json({
          error: 'You cannot demote yourself. Ask another leadership user to do it.',
        });
      }
      const { data, error } = await d.supabaseAdmin
        .from('profiles')
        .update({ role })
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  router.patch('/users/:id/preferred-name', async (req, res, next) => {
    try {
      const schema = z.object({
        preferred_name: z.string().trim().min(1).max(50).nullable(),
      });
      const { preferred_name } = schema.parse(req.body);
      const { data, error } = await d.supabaseAdmin
        .from('profiles')
        .update({ preferred_name })
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  router.patch('/users/:id/cafeteria-card', async (req, res, next) => {
    try {
      const schema = z.object({
        source: z.enum(['manual', 'hrms']).optional(),
        last4: z.union([z.string(), z.null()]).optional(),
        cafeteria_card_number: z.union([z.string(), z.null()]).optional(),
      });
      const parsed = schema.parse(req.body);
      const source = parsed.source || 'manual';
      const normalize = (v) => String(v || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 24);

      let cafeteria_card_number = normalize(parsed.cafeteria_card_number || parsed.last4);

      if (source === 'hrms' && !cafeteria_card_number) {
        const { data: usersList } = await d.supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 500,
        });
        const email = usersList?.users?.find((u) => u.id === req.params.id)?.email || '';
        const hit = await lookupEmployeeIdByEmail(email);
        cafeteria_card_number = normalize(hit.employee_id || hit.last4);
      }

      if (!cafeteria_card_number) {
        const { data, error } = await d.supabaseAdmin
          .from('profiles')
          .update({ cafeteria_card_number: null })
          .eq('id', req.params.id)
          .select('id, full_name, cafeteria_card_number')
          .single();
        if (error) throw error;
        return res.json(data);
      }
      if (cafeteria_card_number.length < 1) {
        return res.status(400).json({ error: 'Enter a card number (letters and digits).' });
      }

      const { data, error } = await d.supabaseAdmin
        .from('profiles')
        .update({ cafeteria_card_number })
        .eq('id', req.params.id)
        .select('id, full_name, cafeteria_card_number')
        .single();
      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'That card number is already assigned.' });
        }
        throw error;
      }
      res.json({ ...data, source });
    } catch (e) {
      next(e);
    }
  });

  router.post('/users/create', async (req, res, next) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        role: roleEnum.default('staff'),
        full_name: z.string().min(1),
      });
      const { email, role, full_name } = schema.parse(req.body);

      const pw = getDefaultPassword();
      if (!pw) {
        return res.status(503).json({ error: 'User creation is temporarily unavailable.' });
      }

      const { data: created, error: createErr } = await d.supabaseAdmin.auth.admin.createUser({
        email,
        password: pw,
        email_confirm: true,
        user_metadata: { full_name },
      });

      let userId = created?.user?.id;

      if (createErr) {
        if (String(createErr.message).toLowerCase().includes('already')) {
          const { data: list } = await d.supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
          userId = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
          if (!userId) throw createErr;
        } else {
          throw createErr;
        }
      }

      const { data: profile, error: pErr } = await d.supabaseAdmin
        .from('profiles')
        .upsert({ id: userId, full_name, role }, { onConflict: 'id' })
        .select()
        .single();
      if (pErr) throw pErr;

      res.status(201).json({ ok: true, user_id: userId, email, role, profile });
    } catch (e) {
      next(e);
    }
  });

  router.post('/consumer-report-subscribers', async (req, res, next) => {
    try {
      const schema = z.object({ email: z.string().email() });
      const { email } = schema.parse(req.body);
      const normalizedEmail = email.trim().toLowerCase();
      const defaultPassword = getDefaultPassword();

      const { data: userList, error: listError } = await d.supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (listError) throw listError;
      let userId = userList?.users.find((u) => u.email?.toLowerCase() === normalizedEmail)?.id;

      if (!userId) {
        if (!defaultPassword) {
          return res.status(503).json({ error: 'User creation is temporarily unavailable.' });
        }
        const { data: created, error: createError } = await d.supabaseAdmin.auth.admin.createUser({
          email: normalizedEmail,
          password: defaultPassword,
          email_confirm: true,
          user_metadata: { full_name: normalizedEmail },
        });
        if (createError) throw createError;
        userId = created.user.id;
      }

      const { data: subscriber, error: profileError } = await d.supabaseAdmin
        .from('profiles')
        .upsert(
          { id: userId, email: normalizedEmail, full_name: normalizedEmail, consumer_report: true },
          { onConflict: 'id' }
        )
        .select('id, full_name, email, employee_code, consumer_report')
        .single();
      if (profileError) throw profileError;

      res.status(201).json({ ok: true, subscriber });
    } catch (e) {
      if (/consumer_report|schema cache|column .* does not exist/i.test(String(e?.message || ''))) {
        return res.status(503).json({
          error: 'Apply the consumer_report database migration before adding recipients.',
        });
      }
      next(e);
    }
  });

  router.post('/users/invite', async (req, res, next) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        role: roleEnum.default('staff'),
        full_name: z.string().optional(),
      });
      const { email, role, full_name } = schema.parse(req.body);

      const { data: invited, error: invErr } = await d.supabaseAdmin.auth.admin.inviteUserByEmail(
        email,
        {
          data: { full_name: full_name || email },
          redirectTo: getInviteRedirectUrl(),
        }
      );
      if (invErr && !String(invErr.message).toLowerCase().includes('already')) {
        throw invErr;
      }

      let userId = invited?.user?.id;
      if (!userId) {
        const { data: list } = await d.supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        userId = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
      }
      if (!userId) {
        return res.status(500).json({ error: 'Invited but could not locate user id' });
      }

      await d.supabaseAdmin
        .from('profiles')
        .upsert({ id: userId, full_name: full_name || email, role }, { onConflict: 'id' });

      res.status(201).json({ ok: true, user_id: userId, email, role });
    } catch (e) {
      next(e);
    }
  });

  router.post('/users/:userId/reset-authenticator', async (req, res, next) => {
    try {
      const targetUser = await findUserById(req.params.userId);
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const factor = await findVerifiedTotpFactor(req.params.userId);
      if (!factor) {
        return res.status(409).json({ error: 'User does not have a verified authenticator to reset.' });
      }

      const { error: deleteErr } = await d.supabaseAdmin.auth.admin.mfa.deleteFactor({
        userId: req.params.userId,
        id: factor.id,
      });
      if (deleteErr) throw deleteErr;

      const { error: auditErr } = await d.supabaseAdmin.from('audit_logs').insert({
        user_id: req.user.id,
        action: 'AUTHENTICATOR_RESET',
        entity_type: 'profile',
        entity_id: req.params.userId,
        old_value: {
          factor_id: factor.id,
          target_email: targetUser.email || null,
        },
        new_value: {
          reset: true,
          target_email: targetUser.email || null,
        },
      });
      if (auditErr) throw auditErr;

      const { error: logErr } = await d.supabaseAdmin.from('mfa_reset_logs').insert({
        reset_by: req.user.id,
        reset_by_email: req.user.email || null,
        target_user_id: req.params.userId,
        target_user_email: targetUser.email || null,
      });
      if (logErr) throw logErr;

      res.json({
        ok: true,
        user_id: req.params.userId,
        email: targetUser.email || null,
      });
    } catch (e) {
      next(e);
    }
  });

  // Admin-only late booking. This creates one targeted print job and never
  // re-runs the daily cabin batch or touches historical print jobs.
  router.post('/late-meal-booking', async (req, res, next) => {
    try {
      const { user_id, choice } = z.object({
        user_id: z.string().uuid(),
        choice: lateMealChoices,
      }).parse(req.body);
      const ist = getISTParts();
      if (ist.hour < 10) {
        return res.status(400).json({ error: 'Late meal booking opens after 10:00 AM IST.' });
      }

      const mealDate = getISTDateString();
      const options = mealOptionsForDate(mealDate);
      if (!options.includes(choice)) {
        return res.status(400).json({ error: `${choice} is not available for today.` });
      }

      const { data: target, error: targetErr } = await d.supabaseAdmin
        .from('profiles')
        .select('id, full_name, preferred_name, active')
        .eq('id', user_id)
        .maybeSingle();
      if (targetErr) throw targetErr;
      if (!target || !target.active) return res.status(404).json({ error: 'Active user not found.' });

      const { data: existing, error: existingErr } = await d.supabaseAdmin
        .from('meal_bookings')
        .select('id, choice, token_number')
        .eq('user_id', user_id)
        .eq('meal_date', mealDate)
        .maybeSingle();
      if (existingErr) throw existingErr;
      if (existing) return res.status(409).json({ error: 'This user already has a meal booking for today.' });

      const { data: prefs, error: prefsErr } = await d.supabaseAdmin
        .from('employee_cafeteria_preferences')
        .select('cabin, preferred_location')
        .eq('user_id', user_id)
        .maybeSingle();
      if (prefsErr) throw prefsErr;
      const cabinName = getCabinName(prefs?.cabin, prefs?.preferred_location);

      const { count: existingTokenCount, error: countErr } = await d.supabaseAdmin
        .from('meal_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('meal_date', mealDate)
        .eq('cabin_name', cabinName)
        .not('token_number', 'is', null);
      if (countErr) throw countErr;
      const tokenNumber = generateLateMealToken(mealDate, cabinName, (existingTokenCount || 0) + 1);

      const { data: booking, error: bookingErr } = await d.supabaseAdmin
        .from('meal_bookings')
        .insert({
          user_id,
          meal_date: mealDate,
          choice,
          booked_at: new Date().toISOString(),
          token_number: tokenNumber,
          cabin_name: cabinName,
        })
        .select()
        .single();
      if (bookingErr) throw bookingErr;

      let spend;
      try {
        spend = await applyMealTokens({ userId: user_id, bookingId: booking.id, mealDate, choice });
      } catch (e) {
        await d.supabaseAdmin.from('meal_bookings').delete().eq('id', booking.id);
        throw e;
      }

      const { data: job, error: jobErr } = await d.supabaseAdmin
        .from('meal_print_jobs')
        .insert({
          meal_date: mealDate,
          cabin_name: cabinName,
          print_type: 'reprint',
          scheduled_for: new Date().toISOString(),
          status: 'pending',
          token_count: 1,
          requested_by: req.user.id,
          booking_user_id: user_id,
        })
        .select()
        .single();
      if (jobErr) {
        await refundTokens({ userId: user_id, refType: 'meal_booking', refId: booking.id });
        await d.supabaseAdmin.from('meal_bookings').delete().eq('id', booking.id);
        throw jobErr;
      }

      res.status(201).json({
        ok: true,
        meal_date: mealDate,
        booking: { ...booking, tokens_charged: spend?.tokens_charged || 0 },
        print_job: job,
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/wallets/monthly-reset', async (_req, res, next) => {
    try {
      const { ensureMonthGrant } = await import('../lib/tokens.js');
      const { data: users, error } = await d.supabaseAdmin.from('profiles').select('id');
      if (error) throw error;
      let granted = 0;
      for (const u of users || []) {
        const r = await ensureMonthGrant(u.id);
        if (r?.granted) granted += 1;
      }
      res.json({ ok: true, granted, total: (users || []).length, monthly_grant: 4000 });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

export default createAdminRouter();
