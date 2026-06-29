/**
 * Posts notifications to Microsoft Teams via Power Automate HTTP trigger.
 *
 * Power Automate expects simple JSON body — NOT Adaptive Cards.
 * Env var: POWER_AUTOMATE_URL (falls back to TEAMS_WEBHOOK_URL for backward compat)
 *
 * NOTE: Microsoft retired Office 365 Connector webhooks (webhook.office.com) in Jan 2025.
 * If a 401 DirectApiAuthorizationRequired is detected, Teams integration is automatically
 * disabled for the rest of this process lifetime to prevent log spam.
 * To restore Teams: set POWER_AUTOMATE_URL to a new Power Automate HTTP trigger URL.
 */
const PA_URL = process.env.POWER_AUTOMATE_URL || process.env.TEAMS_WEBHOOK_URL;

// Auto-disable flag: set to true on first deprecated-webhook 401.
// Prevents log spam when the old webhook.office.com URL is no longer valid.
let _teamsDisabled = false;

function istNow() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

async function postToPA(body) {
  if (!PA_URL) {
    // No URL configured — silent skip (not an error)
    return { skipped: true };
  }

  if (_teamsDisabled) {
    // Already detected a deprecated webhook — skip silently
    return { skipped: true, reason: 'webhook_deprecated' };
  }

  try {
    const res = await fetch(PA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();

    if (!res.ok) {
      // Detect Microsoft's deprecated connector error — disable permanently for this process
      if (res.status === 401 && text.includes('DirectApiAuthorizationRequired')) {
        _teamsDisabled = true;
        console.warn(
          '[Teams] Webhook URL is deprecated (Microsoft retired Office 365 Connectors Jan 2025). ' +
            'Teams notifications are now disabled. To restore: set POWER_AUTOMATE_URL in Render ' +
            'to a new Power Automate HTTP trigger URL. See: https://aka.ms/teams-incoming-webhooks-retire'
        );
        return { ok: false, status: 401, reason: 'webhook_deprecated' };
      }
      // Any other non-OK response — log once and continue
      console.error('[Teams] POST failed', res.status, text.slice(0, 200));
      return { ok: false, status: res.status };
    }

    console.log('[Teams] Sent OK');
    return { ok: true };
  } catch (e) {
    console.error('[Teams] fetch error:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── New Order ────────────────────────────────────────────────────────────────
export async function postOrderToTeams(order) {
  const item = order.parsed_item || order.raw_text || 'Request';
  const employee = order.parsed_employee_name || order.ordered_by || 'Someone';
  const location = order.parsed_location || order.deliver_to || 'Not specified';
  const qty = parseInt(order.quantity, 10) || 1;

  return postToPA({
    event_type: 'new_order',
    ordered_by: employee,
    items: [{ name: item, qty }],
    deliver_to: location,
    instruction: order.instruction || '',
    time: istNow(),
  });
}

// ── Order Cancelled ──────────────────────────────────────────────────────────
export async function postCancelToTeams(order, cancelledBy = 'self') {
  const item = order.parsed_item || order.raw_text || 'Request';
  const employee = order.parsed_employee_name || 'Someone';
  const qty = parseInt(order.raw_text?.match(/^(\d+)x/)?.[1], 10) || 1;

  return postToPA({
    event_type: 'cancelled',
    ordered_by: employee,
    items: [{ name: item, qty }],
    cancelled_by: cancelledBy,
    time: istNow(),
  });
}

// ── Meal Summary (daily at cutoff) ───────────────────────────────────────────
export async function postMealSummaryToTeams(summary) {
  return postToPA({
    event_type: 'meal_summary',
    date: summary.date,
    veg: summary.veg_count || 0,
    non_veg: summary.non_veg_count || 0,
    egg: summary.egg_count || 0,
    skip: summary.skip_count || 0,
    not_booked: summary.not_booked || 0,
    total_meals: summary.total_meals || 0,
    total_cost: summary.cost?.total || 0,
    time: istNow(),
  });
}

// ── Bill Uploaded ────────────────────────────────────────────────────────────
export async function postBillToTeams(bill) {
  return postToPA({
    event_type: 'bill_uploaded',
    vendor: bill.vendor_name || 'Unknown',
    invoice_number: bill.invoice_number || '—',
    grand_total: bill.grand_total || 0,
    items_count: bill.items_count || 0,
    uploaded_by: bill.uploaded_by || 'Office Boy',
    time: istNow(),
  });
}

// ── Stock Alert ──────────────────────────────────────────────────────────────
export async function postStockAlertToTeams(item) {
  return postToPA({
    event_type: 'stock_alert',
    item_name: item.display_name || item.item_name || 'Unknown',
    stock_remaining: item.stock_servings ?? item.stock_today ?? 0,
    unit: 'servings',
    time: istNow(),
  });
}

// ── Backward compat — keep old name working ──────────────────────────────────
export const postRequestToTeams = postOrderToTeams;

// ── OB Leave Alert ─────────────────────────────────────────────────────────────────
export async function postLeaveAlertToTeams({
  ob_name,
  leave_date,
  leave_type,
  half_day_slot,
  reason,
}) {
  const dateLabel = new Date(leave_date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const slotLabel =
    leave_type === 'full_day'
      ? 'Full Day'
      : `Half Day — ${half_day_slot === 'morning' ? 'Morning (9am–1pm)' : 'Afternoon (1pm–5pm)'}`;
  return postToPA({
    event_type: 'ob_leave_alert',
    ob_name,
    leave_date: dateLabel,
    leave_type: slotLabel,
    reason: reason || 'Not specified',
    message: `${ob_name} is on leave — Cafeteria switches to Self-Pickup mode for that slot`,
    time: istNow(),
  });
}

// ── AI Reminder Alert ────────────────────────────────────────────────────────
export async function postAIReminderToTeams(employeeId, decision) {
  return postToPA({
    event_type: 'ai_reminder',
    employee_id: employeeId,
    type: decision.notification_type,
    tone: decision.tone_used,
    title: decision.title,
    message: decision.message,
    time: istNow(),
  });
}
