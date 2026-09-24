import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';
import { lookupEmployeeIdByEmail } from '../lib/hrms.js';
import { applyMealTokens } from '../lib/tokens.js';
import {
  getRequireReviewToBookMeals,
  setRequireReviewToBookMeals,
} from '../lib/mealReviewBookingSetting.js';
import { getCabinName } from './cron.js';
import {
  DEFAULT_RECEIPT_DESIGN,
  normalizeReceiptDesign,
  receiptDesignForStorage,
  validateReceiptDesign,
} from '../../../office-print-gateway/receiptDesign.js';

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

function addISTDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

function getAdminMealDates() {
  const today = getISTDateString();
  return { today, tomorrow: addISTDays(today, 1) };
}

async function getDayShiftProfiles(supabase) {
  const [{ data: profiles, error: profilesErr }, { data: preferences, error: preferencesErr }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, preferred_name, active, created_at').eq('active', true),
    supabase.from('employee_cafeteria_preferences').select('user_id, shift'),
  ]);
  if (profilesErr) throw profilesErr;
  if (preferencesErr) throw preferencesErr;
  const shiftByUserId = new Map((preferences || []).map((preference) => [preference.user_id, preference.shift]));
  return (profiles || []).filter((profile) => shiftByUserId.get(profile.id) !== 'night');
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

  router.get('/meal-settings', async (_req, res, next) => {
    try {
      res.json({ require_review_to_book_meals: getRequireReviewToBookMeals() });
    } catch (e) {
      next(e);
    }
  });

  router.get('/meal-overview', async (_req, res, next) => {
    try {
      const { today, tomorrow } = getAdminMealDates();
      const profiles = await getDayShiftProfiles(d.supabaseAdmin);
      const { data: bookings, error } = await d.supabaseAdmin
        .from('meal_bookings')
        .select('user_id, meal_date')
        .in('meal_date', [today, tomorrow]);
      if (error) throw error;

      const eligibleCount = profiles.length;
      const countForDate = (mealDate) => {
        const bookedUserIds = new Set(
          (bookings || [])
            .filter((booking) => booking.meal_date === mealDate)
            .map((booking) => booking.user_id)
        );
        return {
          meal_date: mealDate,
          booked: profiles.filter((profile) => bookedUserIds.has(profile.id)).length,
          not_booked: eligibleCount - profiles.filter((profile) => bookedUserIds.has(profile.id)).length,
          total: eligibleCount,
        };
      };

      res.json({ today: countForDate(today), tomorrow: countForDate(tomorrow) });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/meal-settings', async (req, res, next) => {
    try {
      const enabled = req.body?.require_review_to_book_meals;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'require_review_to_book_meals must be a boolean' });
      }
      res.json({ require_review_to_book_meals: setRequireReviewToBookMeals(enabled) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/receipt-design', async (_req, res, next) => {
    try {
      const { data, error } = await d.supabaseAdmin
        .from('receipt_design')
        .select('config, updated_at, updated_by')
        .eq('id', 'default')
        .maybeSingle();
      if (error) throw error;
      res.json({
        config: normalizeReceiptDesign(data?.config || DEFAULT_RECEIPT_DESIGN),
        updated_at: data?.updated_at || null,
        updated_by: data?.updated_by || null,
      });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/receipt-design', async (req, res, next) => {
    try {
      const errors = validateReceiptDesign(req.body);
      if (errors.length) return res.status(400).json({ error: errors.join('; ') });
      const config = receiptDesignForStorage(req.body);
      const { data, error } = await d.supabaseAdmin
        .from('receipt_design')
        .upsert({
          id: 'default',
          config,
          updated_by: req.user.id,
          updated_at: new Date().toISOString(),
        })
        .select('config, updated_at, updated_by')
        .single();
      if (error) throw error;
      res.json({
        config: normalizeReceiptDesign(data?.config || config),
        updated_at: data?.updated_at || null,
        updated_by: data?.updated_by || req.user.id,
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/receipt-design/reset', async (req, res, next) => {
    try {
      const { data, error } = await d.supabaseAdmin
        .from('receipt_design')
        .upsert({
          id: 'default',
          config: DEFAULT_RECEIPT_DESIGN,
          updated_by: req.user.id,
          updated_at: new Date().toISOString(),
        })
        .select('config, updated_at, updated_by')
        .single();
      if (error) throw error;
      res.json({
        config: normalizeReceiptDesign(data?.config || DEFAULT_RECEIPT_DESIGN),
        updated_at: data?.updated_at || null,
        updated_by: data?.updated_by || req.user.id,
      });
    } catch (e) {
      next(e);
    }
  });

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

      const { data: shiftPreferences, error: shiftErr } = await d.supabaseAdmin
        .from('employee_cafeteria_preferences')
        .select('user_id, shift, cabin, preferred_location');
      if (shiftErr) throw shiftErr;

      const shiftByUserId = new Map(
        (shiftPreferences || []).map((preference) => [preference.user_id, preference.shift])
      );
      const preferenceByUserId = new Map(
        (shiftPreferences || []).map((preference) => [preference.user_id, preference])
      );

      const emailMap = new Map(usersList.users.map((u) => [u.id, u.email]));

      const rows = profiles.map((p) => ({
        ...p,
        shift: shiftByUserId.get(p.id) || 'morning',
        cabin: getCabinName(preferenceByUserId.get(p.id)?.cabin, preferenceByUserId.get(p.id)?.preferred_location),
        email: emailMap.get(p.id) || null,
      }));
      res.json(rows);
    } catch (e) {
      next(e);
    }
  });

  // GET /api/admin/unbooked-users - active users without today's meal booking
  router.get('/unbooked-users', async (req, res, next) => {
    try {
      const { today, tomorrow } = getAdminMealDates();
      const mealDate = req.query.date || today;
      if (![today, tomorrow].includes(mealDate)) {
        return res.status(400).json({ error: 'Only today or tomorrow can be viewed.' });
      }
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

      const dayShiftProfiles = await getDayShiftProfiles(d.supabaseAdmin);
      const dayShiftIds = new Set(dayShiftProfiles.map((profile) => profile.id));
      const bookedUserIds = new Set((bookings || []).map((booking) => booking.user_id));
      const { data: usersList, error: usersErr } = await d.supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (usersErr) throw usersErr;

      const emailMap = new Map((usersList?.users || []).map((user) => [user.id, user.email]));
      const users = (profiles || [])
        .filter((user) => dayShiftIds.has(user.id) && !bookedUserIds.has(user.id))
        .map((user) => ({ ...user, email: emailMap.get(user.id) || null }));

      res.json({ meal_date: mealDate, users });
    } catch (e) {
      next(e);
    }
  });

  // GET /api/admin/booked-users - active users with today's meal booking
  router.get('/booked-users', async (req, res, next) => {
    try {
      const { today, tomorrow } = getAdminMealDates();
      const mealDate = req.query.date || today;
      if (![today, tomorrow].includes(mealDate)) {
        return res.status(400).json({ error: 'Only today or tomorrow can be viewed.' });
      }
      const [{ data: profiles, error: profilesErr }, { data: bookings, error: bookingsErr }] = await Promise.all([
        d.supabaseAdmin
          .from('profiles')
          .select('id, full_name, preferred_name, active, created_at')
          .eq('active', true)
          .order('full_name', { ascending: true }),
        d.supabaseAdmin
          .from('meal_bookings')
          .select('user_id, choice')
          .eq('meal_date', mealDate),
      ]);
      if (profilesErr) throw profilesErr;
      if (bookingsErr) throw bookingsErr;

      const dayShiftProfiles = await getDayShiftProfiles(d.supabaseAdmin);
      const dayShiftIds = new Set(dayShiftProfiles.map((profile) => profile.id));
      const bookingByUserId = new Map((bookings || []).map((booking) => [booking.user_id, booking]));
      const { data: usersList, error: usersErr } = await d.supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (usersErr) throw usersErr;

      const emailMap = new Map((usersList?.users || []).map((user) => [user.id, user.email]));
      const users = (profiles || [])
        .filter((user) => dayShiftIds.has(user.id) && bookingByUserId.has(user.id))
        .map((user) => ({
          ...user,
          email: emailMap.get(user.id) || null,
          choice: bookingByUserId.get(user.id)?.choice || null,
        }));

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
      const { user_id, choice, meal_date } = z.object({
        user_id: z.string().uuid(),
        choice: lateMealChoices,
        meal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }).parse(req.body);
      const { today, tomorrow } = getAdminMealDates();
      if (meal_date !== today && meal_date !== tomorrow) {
        return res.status(400).json({ error: 'Admin booking is available only for today or tomorrow.' });
      }
      if (meal_date === today && getISTParts().hour >= 11) {
        return res.status(400).json({ error: "Today's admin meal booking closed at 11:00 AM IST." });
      }
      const mealDate = meal_date;
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

      const { data: targetPreference, error: targetPreferenceErr } = await d.supabaseAdmin
        .from('employee_cafeteria_preferences')
        .select('shift')
        .eq('user_id', user_id)
        .maybeSingle();
      if (targetPreferenceErr) throw targetPreferenceErr;
      if (targetPreference?.shift === 'night') {
        return res.status(400).json({ error: 'Night shift users are excluded from day shift meal booking.' });
      }

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

      res.status(201).json({
        ok: true,
        meal_date: mealDate,
        booking: { ...booking, tokens_charged: spend?.tokens_charged || 0 },
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
