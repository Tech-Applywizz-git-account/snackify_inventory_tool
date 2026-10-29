import { api } from './api.js';
import { supabase } from './supabase.js';

export const IMPERSONATION_STORAGE_KEY = 'snackify-impersonation-return';

/** Snapshot of the admin return ticket kept in browser storage while viewing as a user. */
export function readReturnTicket() {
  try {
    const raw = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
    if (!raw) return null;
    const ticket = JSON.parse(raw);
    if (!ticket?.access_token || !ticket?.refresh_token || !ticket?.admin?.id) return null;
    return ticket;
  } catch {
    return null;
  }
}

export function writeReturnTicket(ticket) {
  sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(ticket));
}

export function clearReturnTicket() {
  sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
}

/**
 * Given the active session user id and a stored ticket, decide impersonation UI state.
 * - Ticket + session is target → impersonating
 * - Ticket + session is already admin → clear stale ticket
 * - Ticket + unrelated session → clear ticket
 */
export function reconcileImpersonationTicket(sessionUserId) {
  const ticket = readReturnTicket();
  if (!ticket) {
    return { isImpersonating: false, ticket: null, admin: null, target: null };
  }

  if (!sessionUserId) {
    // Keep the ticket so a later restore can still return to the admin.
    return { isImpersonating: false, ticket, admin: ticket.admin, target: ticket.target || null };
  }

  if (sessionUserId === ticket.admin.id) {
    clearReturnTicket();
    return { isImpersonating: false, ticket: null, admin: null, target: null };
  }

  if (ticket.target?.id && sessionUserId === ticket.target.id) {
    return {
      isImpersonating: true,
      ticket,
      admin: ticket.admin,
      target: ticket.target,
    };
  }

  // Session drifted to someone else — drop the ticket for safety.
  clearReturnTicket();
  return { isImpersonating: false, ticket: null, admin: null, target: null };
}

export function canViewAsUser(adminProfile, targetUser, { alreadyImpersonating = false } = {}) {
  if (alreadyImpersonating) return { ok: false, reason: 'Already viewing as another user.' };
  if (!adminProfile || adminProfile.role !== 'leadership') {
    return { ok: false, reason: 'Only admins can view as a user.' };
  }
  if (!targetUser) return { ok: false, reason: 'User not found.' };
  if (targetUser.id === adminProfile.id) {
    return { ok: false, reason: 'You cannot view the app as yourself.' };
  }
  if (targetUser.role === 'leadership' || targetUser.role === 'admin') {
    return { ok: false, reason: 'You cannot view the app as another admin.' };
  }
  if (!targetUser.active) {
    return { ok: false, reason: 'That account is deactivated.' };
  }
  if (targetUser.role === 'vendor' && targetUser.vendor_invitation_pending) {
    return { ok: false, reason: 'That vendor has not finished account confirmation yet.' };
  }
  return { ok: true };
}

/**
 * Start viewing as target: stash admin session, install target session.
 * Caller should navigate to home after success.
 */
export async function startImpersonation({ adminSession, adminProfile, targetUserId }) {
  if (!adminSession?.access_token || !adminSession?.refresh_token) {
    throw new Error('Your admin session expired. Sign in again.');
  }
  if (readReturnTicket()) {
    throw new Error('Already viewing as another user. Exit user view first.');
  }

  const result = await api.impersonateUser(targetUserId);

  const ticket = {
    access_token: adminSession.access_token,
    refresh_token: adminSession.refresh_token,
    admin: {
      id: adminProfile.id,
      email: adminProfile.email || adminSession.user?.email || null,
      full_name: adminProfile.full_name || null,
      preferred_name: adminProfile.preferred_name || null,
      role: adminProfile.role,
    },
    target: {
      id: result.user.id,
      email: result.user.email,
      full_name: result.user.full_name,
      preferred_name: result.user.preferred_name,
      role: result.user.role,
    },
    startedAt: new Date().toISOString(),
  };

  writeReturnTicket(ticket);

  const { error } = await supabase.auth.setSession({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
  });

  if (error) {
    // Roll back: restore admin session and clear ticket
    clearReturnTicket();
    await supabase.auth.setSession({
      access_token: ticket.access_token,
      refresh_token: ticket.refresh_token,
    }).catch(() => {});
    throw new Error(error.message || 'Could not open a session as that user.');
  }

  return ticket;
}

/**
 * Exit user view: restore stashed admin session, audit end, clear ticket.
 */
export async function exitImpersonation() {
  const ticket = readReturnTicket();
  if (!ticket) {
    throw new Error('No admin return session found.');
  }

  const { error } = await supabase.auth.setSession({
    access_token: ticket.access_token,
    refresh_token: ticket.refresh_token,
  });

  if (error) {
    clearReturnTicket();
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    throw new Error('Could not restore your admin session. Please sign in again.');
  }

  clearReturnTicket();

  try {
    await api.endImpersonation({
      target_user_id: ticket.target?.id,
      target_email: ticket.target?.email || null,
      target_role: ticket.target?.role || null,
      target_name: ticket.target?.preferred_name || ticket.target?.full_name || null,
    });
  } catch {
    // Audit is best-effort after a successful restore
  }

  return ticket.admin;
}

/**
 * Logout while impersonating: restore admin first, then local sign-out only.
 * Never globally revokes the target user's other devices.
 */
export async function logoutWhileImpersonating() {
  const ticket = readReturnTicket();
  if (ticket?.access_token && ticket?.refresh_token) {
    await supabase.auth.setSession({
      access_token: ticket.access_token,
      refresh_token: ticket.refresh_token,
    }).catch(() => {});
  }
  clearReturnTicket();
  await supabase.auth.signOut({ scope: 'local' });
}
