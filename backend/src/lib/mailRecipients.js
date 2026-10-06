import { supabaseAdmin } from './supabase.js';

export const MAIL_TYPES = [
  'meal_report',
  'daily_consumption',
  'low_stock',
  'guest_meal',
  'support_ticket',
];

export const MAIL_TYPE_LABELS = {
  meal_report: 'Meal bookings report',
  daily_consumption: 'Daily consumption report',
  low_stock: 'Low stock alerts',
  guest_meal: 'Guest meal notifications',
  support_ticket: 'Support tickets',
};

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function uniqueEmails(emails) {
  return [...new Set((emails || []).map(normalizeEmail).filter(Boolean))];
}

/**
 * Load admin-managed TO/CC for a mail type.
 * If no active TO rows exist, uses fallbackTo (legacy role-based list).
 * CC always comes from the table (plus optional fallbackCc when table CC is empty).
 */
export async function getMailRecipients(mailType, { fallbackTo = [], fallbackCc = [] } = {}) {
  const { data, error } = await supabaseAdmin
    .from('mail_recipients')
    .select('email, recipient_kind')
    .eq('mail_type', mailType)
    .eq('active', true);

  if (error) {
    // Table may not be migrated yet — fall back silently.
    if (/relation .* does not exist|schema cache/i.test(String(error.message || ''))) {
      return {
        to: uniqueEmails(fallbackTo),
        cc: uniqueEmails(fallbackCc),
        source: 'fallback',
      };
    }
    throw error;
  }

  const toFromTable = uniqueEmails(
    (data || []).filter((row) => row.recipient_kind === 'to').map((row) => row.email)
  );
  const ccFromTable = uniqueEmails(
    (data || []).filter((row) => row.recipient_kind === 'cc').map((row) => row.email)
  );

  const to = toFromTable.length > 0 ? toFromTable : uniqueEmails(fallbackTo);
  const cc = uniqueEmails([
    ...(ccFromTable.length > 0 ? ccFromTable : fallbackCc),
  ]).filter((email) => !to.includes(email));

  return {
    to,
    cc,
    source: toFromTable.length > 0 ? 'table' : 'fallback',
  };
}

export async function listMailRecipients(mailType) {
  let query = supabaseAdmin
    .from('mail_recipients')
    .select('id, email, display_name, mail_type, recipient_kind, active, created_at, updated_at')
    .order('mail_type', { ascending: true })
    .order('recipient_kind', { ascending: true })
    .order('email', { ascending: true });

  if (mailType) query = query.eq('mail_type', mailType);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function upsertMailRecipient({ email, mailType, recipientKind, displayName = null, active = true }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    const err = new Error('A valid email address is required.');
    err.status = 400;
    throw err;
  }
  if (!MAIL_TYPES.includes(mailType)) {
    const err = new Error(`Invalid mail_type. Use one of: ${MAIL_TYPES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  if (!['to', 'cc'].includes(recipientKind)) {
    const err = new Error('recipient_kind must be "to" or "cc".');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabaseAdmin
    .from('mail_recipients')
    .upsert(
      {
        email: normalized,
        display_name: displayName || null,
        mail_type: mailType,
        recipient_kind: recipientKind,
        active: active !== false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email,mail_type,recipient_kind' }
    )
    .select('id, email, display_name, mail_type, recipient_kind, active, created_at, updated_at')
    .single();

  if (error) throw error;
  return data;
}

export async function updateMailRecipient(id, patch) {
  const updates = { updated_at: new Date().toISOString() };
  if (patch.email !== undefined) updates.email = normalizeEmail(patch.email);
  if (patch.display_name !== undefined) updates.display_name = patch.display_name || null;
  if (patch.mail_type !== undefined) {
    if (!MAIL_TYPES.includes(patch.mail_type)) {
      const err = new Error(`Invalid mail_type. Use one of: ${MAIL_TYPES.join(', ')}`);
      err.status = 400;
      throw err;
    }
    updates.mail_type = patch.mail_type;
  }
  if (patch.recipient_kind !== undefined) {
    if (!['to', 'cc'].includes(patch.recipient_kind)) {
      const err = new Error('recipient_kind must be "to" or "cc".');
      err.status = 400;
      throw err;
    }
    updates.recipient_kind = patch.recipient_kind;
  }
  if (patch.active !== undefined) updates.active = Boolean(patch.active);

  const { data, error } = await supabaseAdmin
    .from('mail_recipients')
    .update(updates)
    .eq('id', id)
    .select('id, email, display_name, mail_type, recipient_kind, active, created_at, updated_at')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteMailRecipient(id) {
  const { error } = await supabaseAdmin.from('mail_recipients').delete().eq('id', id);
  if (error) throw error;
}
