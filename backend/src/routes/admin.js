import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';

const roleEnum = z.enum(['facility_manager', 'finance', 'leadership', 'staff', 'office_boy']);

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
      const { data: profiles, error: pErr } = await d.supabaseAdmin
        .from('profiles')
        .select('id, full_name, role, preferred_name, created_at')
        .order('created_at', { ascending: true });
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

      res.json({
        ok: true,
        user_id: req.params.userId,
        email: targetUser.email || null,
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

export default createAdminRouter();
