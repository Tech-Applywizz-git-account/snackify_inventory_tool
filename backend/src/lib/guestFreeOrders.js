export function canApplyGuestFreeMode(role, isGuestCheckout) {
  if (!isGuestCheckout) return false;
  return ['admin', 'leadership', 'office_boy'].includes(role);
}

export function guestFreeChargeResult() {
  return {
    tokens_charged: 0,
    balance_after: null,
    token_usage_id: null,
    token_lines: [],
    guest_free: true,
  };
}
