import { supabaseAdmin } from './supabase.js';

export const MONTHLY_GRANT = 4000;

// Month key rolls over at 08:00 IST on the 1st (not midnight).
export function istMonthKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  let year = Number(m.year);
  let month = Number(m.month);
  if (Number(m.day) === 1 && Number(m.hour) < 8) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return `${year}${String(month).padStart(2, '0')}`;
}

export function weekdayIst(dateStr) {
  const [y, mo, da] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
}

function norm(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function nameKeys(name) {
  const n = norm(name);
  const key = n
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+\s*(ml|l|ltr|litre|liter)s?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(new Set([n, key].filter(Boolean)));
}

const WATER_FALLBACK = {
  sku_code: 'WATER_BOTTLE',
  display_name: 'Water Bottle',
  kind: 'beverage',
  tokens: 10,
  aliases: [
    'water',
    'water bottle',
    'mineral water',
    'mineral water (1l)',
    'mineral water 1l',
    'packaged water',
    'bisleri',
    'kinley',
  ],
  active: true,
};

export function matchTokenItem(catalog, name) {
  const names = nameKeys(name);
  if (!names.length || !Array.isArray(catalog)) return null;
  const hit =
    catalog.find((i) => names.includes(norm(i.display_name)))
    || catalog.find((i) => names.includes(norm(i.sku_code)))
    || catalog.find((i) => (i.aliases || []).some((a) => names.includes(norm(a))))
    || catalog.find((i) =>
      (i.aliases || []).some((a) => {
        const an = norm(a);
        return an.length >= 4 && names.some((nm) => nm.includes(an) || an.includes(nm));
      })
    );
  return hit || null;
}

export function unitTokensForName(catalog, name) {
  const hit = matchTokenItem(catalog, name);
  return hit ? Number(hit.tokens) || 0 : 0;
}

export async function loadCatalog() {
  const { data, error } = await supabaseAdmin
    .from('token_items')
    .select('*')
    .eq('active', true)
    .order('kind', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  const hasWater = rows.some((i) => {
    const sku = String(i.sku_code || '').toUpperCase();
    const n = norm(i.display_name);
    return sku === 'WATER_BOTTLE' || /mineral water|water bottle/.test(n);
  });
  let inserted = null;
  if (!hasWater) {
    const { data: waterRow } = await supabaseAdmin
    .from('token_items')
    .upsert({
      sku_code: WATER_FALLBACK.sku_code,
      display_name: WATER_FALLBACK.display_name,
      kind: WATER_FALLBACK.kind,
      tokens: WATER_FALLBACK.tokens,
      aliases: WATER_FALLBACK.aliases,
      active: true,
    }, { onConflict: 'sku_code' })
    .select()
    .maybeSingle();
    inserted = waterRow;
  }
  const merged = hasWater ? rows : (inserted ? [...rows, inserted] : [...rows, WATER_FALLBACK]);
  const PRICE_OVERRIDES = {
    COFFEE_REGULAR: 10,
    CAPPUCCINO: 20,
    LATTE: 20,
    MILK: 10,
    GINGER_TEA: 10,
    ASSAM_TEA: 10,
    LEMON_TEA: 10,
    BADAM_MILK: 20,
    HOT_CHOCOLATE: 25,
    BREAD_PB: 15,
    BREAD_JAM: 15,
    MEAL_MON: 110,
    MEAL_TUE: 120,
    MEAL_WED: 140,
    MEAL_THU: 120,
    MEAL_FRI: 140,
    WATER_BOTTLE: 10,
  };
  return merged.map((row) => {
    const sku = String(row.sku_code || '').toUpperCase();
    if (PRICE_OVERRIDES[sku] == null) return row;
    return { ...row, tokens: PRICE_OVERRIDES[sku] };
  });
}

export function attachTokenPrice(item, catalog) {
  const name = item?.frontend_name || item?.display_name || item?.item_name || item?.name || '';
  const fromCatalog = unitTokensForName(catalog, name);
  const existing = Number(item?.token_price ?? item?.coin_price);
  const unit = fromCatalog > 0 ? fromCatalog : (existing > 0 ? existing : 0);
  return { ...item, token_price: unit, coin_price: unit };
}

function rpcFailedMissing(error) {
  const msg = String(error?.message || error?.code || '');
  return /could not find the function|schema cache|does not exist|PGRST202/i.test(msg);
}

function tokenError(error) {
  const raw = String(error?.message || 'Token payment failed');
  let msg = raw.replace(/^.*INSUFFICIENT_TOKENS[:\s]*/i, 'Not enough tokens. ');
  const unknown = raw.match(/UNKNOWN_TOKEN_ITEM:?\s*(.*)$/i);
  if (unknown) {
    msg = `No coin price in catalog for ${unknown[1] || 'this item'}.`;
  }
  const err = new Error(msg);
  if (/INSUFFICIENT_TOKENS/i.test(raw)) err.code = 'INSUFFICIENT_TOKENS';
  if (/EMPTY_CART/i.test(raw)) err.code = 'EMPTY_CART';
  if (/UNKNOWN_TOKEN_ITEM/i.test(raw)) err.code = 'UNKNOWN_TOKEN_ITEM';
  err.status = 400;
  return err;
}

async function topUpGrantIfNeeded(userId, month, bal) {
  const { data: rows } = await supabaseAdmin
    .from('token_usage')
    .select('tokens_delta')
    .eq('user_id', userId)
    .eq('reason', 'monthly_grant')
    .like('idempotency_key', `grant:${userId}:${month}%`);
  const grantedAmt = (rows || []).reduce((s, r) => s + Number(r.tokens_delta || 0), 0);
  if (grantedAmt >= MONTHLY_GRANT) {
    return { balance: bal, granted: false };
  }
  const add = MONTHLY_GRANT - grantedAmt;
  await supabaseAdmin.from('token_usage').insert({
    user_id: userId,
    qty: 1,
    tokens_delta: add,
    balance_after: bal + add,
    reason: 'monthly_grant',
    ref_type: 'grant',
    idempotency_key: `grant:${userId}:${month}:to4000`,
    print_status: 'none',
  }).then(() => {}).catch(() => {});
  const next = bal + add;
  await supabaseAdmin.from('profiles').update({ token_balance: next }).eq('id', userId);
  return { balance: next, granted: true };
}

async function jsEnsureGrant(userId) {
  const month = istMonthKey();
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, token_balance, token_month')
    .eq('id', userId)
    .single();
  if (error) throw error;
  let bal = Number(profile.token_balance) || 0;
  if (profile.token_month === month) {
    const topped = await topUpGrantIfNeeded(userId, month, bal);
    return { balance: topped.balance, month, granted: topped.granted, monthly_grant: MONTHLY_GRANT };
  }
  if (bal > 0) {
    await supabaseAdmin.from('token_usage').insert({
      user_id: userId,
      qty: 1,
      tokens_delta: -bal,
      balance_after: 0,
      reason: 'month_reset',
      ref_type: 'grant',
      idempotency_key: `reset:${userId}:${month}`,
      print_status: 'none',
    }).then(() => {}).catch(() => {});
    bal = 0;
  }
  await supabaseAdmin.from('token_usage').insert({
    user_id: userId,
    qty: 1,
    tokens_delta: MONTHLY_GRANT,
    balance_after: MONTHLY_GRANT,
    reason: 'monthly_grant',
    ref_type: 'grant',
    idempotency_key: `grant:${userId}:${month}`,
    print_status: 'none',
  }).then(() => {}).catch(() => {});
  await supabaseAdmin
    .from('profiles')
    .update({ token_balance: MONTHLY_GRANT, token_month: month })
    .eq('id', userId);
  return { balance: MONTHLY_GRANT, month, granted: true, monthly_grant: MONTHLY_GRANT };
}

export async function ensureMonthGrant(userId) {
  const { data, error } = await supabaseAdmin.rpc('snackify_ensure_month_grant', {
    p_user_id: userId,
  });
  if (!error) return data;
  if (rpcFailedMissing(error)) return jsEnsureGrant(userId);
  throw tokenError(error);
}

export async function spendTokens({ userId, idempotencyKey, refType, refId, lines }) {
  const { data, error } = await supabaseAdmin.rpc('snackify_spend', {
    p_user_id: userId,
    p_idempotency_key: idempotencyKey,
    p_ref_type: refType,
    p_ref_id: refId,
    p_lines: lines,
  });
  if (!error) return data;
  if (!rpcFailedMissing(error)) throw tokenError(error);

  const catalog = await loadCatalog();
  const priced = (lines || []).map((l) => {
    const qty = Math.max(1, parseInt(l.qty, 10) || 1);
    const hit = matchTokenItem(catalog, l.name);
    const unit = hit ? Number(hit.tokens) || 0 : 0;
    if (!hit || unit <= 0) {
      const err = new Error(`No coin price in catalog for ${l.name}.`);
      err.status = 400;
      throw err;
    }
    return {
      name: l.name,
      sku_code: hit?.sku_code || null,
      token_item_id: hit?.id || null,
      qty,
      unit_tokens: unit,
      tokens: unit * qty,
    };
  });
  const total = priced.reduce((s, l) => s + l.tokens, 0);
  const grant = await jsEnsureGrant(userId);
  if (grant.balance < total) {
    const err = new Error(`Not enough tokens. Need ${total}, have ${grant.balance}.`);
    err.code = 'INSUFFICIENT_TOKENS';
    err.status = 400;
    throw err;
  }
  const balanceAfter = grant.balance - total;
  const { data: usage, error: uErr } = await supabaseAdmin
    .from('token_usage')
    .insert({
      user_id: userId,
      token_item_id: priced[0]?.token_item_id || null,
      qty: 1,
      tokens_delta: -total,
      balance_after: balanceAfter,
      reason: 'spend',
      ref_type: refType,
      ref_id: refId,
      idempotency_key: idempotencyKey || `spend:${refType}:${refId}`,
      lines: priced,
      print_status: 'none',
    })
    .select()
    .single();
  if (uErr) {
    if (uErr.code === '23505') {
      const { data: existing } = await supabaseAdmin
        .from('token_usage')
        .select('*')
        .eq('idempotency_key', idempotencyKey || `spend:${refType}:${refId}`)
        .maybeSingle();
      return {
        usage_id: existing?.id,
        tokens_charged: Math.abs(existing?.tokens_delta || 0),
        balance_after: existing?.balance_after,
        lines: existing?.lines || priced,
        idempotent: true,
      };
    }
    throw uErr;
  }
  await supabaseAdmin.from('profiles').update({ token_balance: balanceAfter }).eq('id', userId);
  if (refType === 'request') {
    await supabaseAdmin
      .from('requests')
      .update({ tokens_charged: total, token_usage_id: usage.id })
      .eq('id', refId);
  } else if (refType === 'meal_booking') {
    await supabaseAdmin
      .from('meal_bookings')
      .update({ tokens_charged: total, token_usage_id: usage.id })
      .eq('id', refId);
  }
  return {
    usage_id: usage.id,
    tokens_charged: total,
    balance_after: balanceAfter,
    lines: priced,
    idempotent: false,
  };
}

export async function refundTokens({ userId, refType, refId }) {
  const { data, error } = await supabaseAdmin.rpc('snackify_refund', {
    p_user_id: userId,
    p_ref_type: refType,
    p_ref_id: refId,
  });
  if (!error) return data;
  if (!rpcFailedMissing(error)) throw tokenError(error);

  await jsEnsureGrant(userId);
  const { data: spend } = await supabaseAdmin
    .from('token_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('ref_type', refType)
    .eq('ref_id', refId)
    .eq('reason', 'spend')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!spend) return { tokens_refunded: 0, skipped: true };
  const credit = Math.abs(spend.tokens_delta);
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('token_balance')
    .eq('id', userId)
    .single();
  const balanceAfter = (Number(profile?.token_balance) || 0) + credit;
  const key = `refund:${refType}:${refId}`;
  const { data: usage, error: uErr } = await supabaseAdmin
    .from('token_usage')
    .insert({
      user_id: userId,
      token_item_id: spend.token_item_id,
      qty: 1,
      tokens_delta: credit,
      balance_after: balanceAfter,
      reason: 'refund',
      ref_type: refType,
      ref_id: refId,
      idempotency_key: key,
      lines: spend.lines,
      print_status: 'cancelled',
    })
    .select()
    .single();
  if (uErr?.code === '23505') {
    return { tokens_refunded: credit, idempotent: true };
  }
  if (uErr) throw uErr;
  await supabaseAdmin.from('profiles').update({ token_balance: balanceAfter }).eq('id', userId);
  await supabaseAdmin
    .from('token_usage')
    .update({ print_status: 'cancelled', print_retryable: false })
    .eq('id', spend.id);
  return { usage_id: usage.id, tokens_refunded: credit, balance_after: balanceAfter };
}

export async function applyMealTokens({ userId, bookingId, mealDate, choice }) {
  const { data, error } = await supabaseAdmin.rpc('snackify_apply_meal_tokens', {
    p_user_id: userId,
    p_booking_id: bookingId,
    p_meal_date: mealDate,
    p_choice: choice,
  });
  if (!error) return data;
  if (!rpcFailedMissing(error)) throw tokenError(error);

  if (!choice || String(choice).toLowerCase() === 'skip') {
    return refundTokens({ userId, refType: 'meal_booking', refId: bookingId });
  }
  await refundTokens({ userId, refType: 'meal_booking', refId: bookingId });
  const catalog = await loadCatalog();
  const dow = weekdayIst(mealDate);
  const meal = catalog.find((i) => i.kind === 'meal' && Number(i.weekday) === dow);
  return spendTokens({
    userId,
    idempotencyKey: `meal:${bookingId}:${choice}:${mealDate}`,
    refType: 'meal_booking',
    refId: bookingId,
    lines: [{ name: meal?.display_name || `Meal ${mealDate}`, qty: 1 }],
  });
}

export async function queuePrint(usageId) {
  if (!usageId) return;
  await supabaseAdmin
    .from('token_usage')
    .update({ print_status: 'pending', print_retryable: true, print_claimed_at: null })
    .eq('id', usageId)
    .in('print_status', ['none', 'cancelled', 'failed']);
}

export async function walletForUser(userId) {
  const grant = await ensureMonthGrant(userId);
  const month = grant.month || istMonthKey();
  const start = `${month.slice(0, 4)}-${month.slice(4)}-01T08:00:00+05:30`;
  const { data: spentRows } = await supabaseAdmin
    .from('token_usage')
    .select('tokens_delta, reason')
    .eq('user_id', userId)
    .eq('reason', 'spend')
    .gte('created_at', start);
  const spent = (spentRows || []).reduce((s, r) => s + Math.abs(Number(r.tokens_delta) || 0), 0);
  return {
    balance: Number(grant.balance) || 0,
    monthly_grant: MONTHLY_GRANT,
    spent_this_month: spent,
    remaining: Number(grant.balance) || 0,
    month,
    coin_value_inr: 1,
  };
}

export async function mealTokenPrice(dateStr, catalog) {
  const list = catalog || (await loadCatalog());
  const dow = weekdayIst(dateStr);
  const row = list.find((i) => i.kind === 'meal' && Number(i.weekday) === dow);
  return row ? Number(row.tokens) : 0;
}
