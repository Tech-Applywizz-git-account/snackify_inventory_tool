import { supabase } from './supabase.js';

const BASE = import.meta.env.VITE_API_BASE_URL || '';

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
    ...(opts.headers || {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    if (res.status === 429) {
      const raw = res.headers.get('retry-after');
      const parsed = parseInt(raw, 10);
      const retryAfterSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
      const e = new Error('Updates are temporarily busy. Retrying shortly.');
      e.status = 429;
      e.retryAfterSeconds = retryAfterSeconds;
      throw e;
    }
    let msg = `${res.status} ${res.statusText}`;
    try {
      // Only parse as JSON if the response actually is JSON.
      // This prevents a confusing secondary error when Vercel returns
      // the SPA index.html (HTML) instead of a real backend JSON response.
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = await res.json();
        if (body?.error) msg = body.error;
      }
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  startEnrollment: (email) =>
    request('/api/auth/start-enrollment', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyEnrollmentOtp: (email, code) =>
    request('/api/auth/verify-enrollment-otp', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),
  verifyTotpEnrollment: (enrollmentTransactionId, code) =>
    request('/api/auth/verify-totp-enrollment', {
      method: 'POST',
      body: JSON.stringify({ enrollmentTransactionId, code }),
    }),
  startLogin: (email) =>
    request('/api/auth/start-login', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyTotpLogin: (transactionId, code) =>
    request('/api/auth/verify-totp-login', {
      method: 'POST',
      body: JSON.stringify({ transactionId, code }),
    }),
  startReauth: () => request('/api/auth/start-reauth', { method: 'POST', body: JSON.stringify({}) }),
  verifyReauth: (transactionId, code) =>
    request('/api/auth/verify-reauth', {
      method: 'POST',
      body: JSON.stringify({ transactionId, code }),
    }),

  listProducts: () => request('/api/products'),
  createProduct: (body) => request('/api/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id, body) =>
    request(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  inventoryStatus: () => request('/api/inventory'),
  alerts: () => request('/api/inventory/alerts'),
  dailyUpdate: (updates) =>
    request('/api/inventory/daily-update', { method: 'POST', body: JSON.stringify({ updates }) }),

  listTransactions: (q = '') => request(`/api/transactions${q ? `?${q}` : ''}`),
  createTransaction: (body) =>
    request('/api/transactions', { method: 'POST', body: JSON.stringify(body) }),

  spending: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/reports/spending${qs ? `?${qs}` : ''}`);
  },
  dashboard: () => request('/api/reports/dashboard'),
  aiSummary: (refresh = false) =>
    request(`/api/reports/ai-summary${refresh ? '?refresh=true' : ''}`),
  aiSummaryHistory: () => request('/api/reports/ai-summary/history'),

  listUsers: () => request('/api/admin/users'),
  setUserRole: (userId, role) =>
    request(`/api/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  setUserPreferredName: (userId, preferredName) =>
    request(`/api/admin/users/${userId}/preferred-name`, {
      method: 'PATCH',
      body: JSON.stringify({ preferred_name: preferredName }),
    }),
  resetAuthenticator: (userId) =>
    request(`/api/admin/users/${userId}/reset-authenticator`, { method: 'POST' }),
  createUser: (body) =>
    request('/api/admin/users/create', { method: 'POST', body: JSON.stringify(body) }),
  inviteUser: (body) =>
    request('/api/admin/users/invite', { method: 'POST', body: JSON.stringify(body) }),

  submitRequest: (raw_text) =>
    request('/api/requests', { method: 'POST', body: JSON.stringify({ raw_text }) }),
  getRequest: (id) => request(`/api/requests/${id}`),
  listRequests: (status = '') => request(`/api/requests${status ? `?status=${status}` : ''}`),
  setRequestStatus: (id, status, live_status, notes) =>
    request(`/api/requests/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, live_status, notes }),
    }),
  cancelOrder: (id) => request(`/api/requests/${id}/cancel`, { method: 'POST' }),
  confirmOrder: (id) => request(`/api/requests/${id}/confirm`, { method: 'POST' }),
  queueCount: () => request('/api/requests/queue-count'),
  rateRequest: (id, body) =>
    request(`/api/requests/${id}/rate`, { method: 'POST', body: JSON.stringify(body) }),

  extractBill: (file_url) =>
    request('/api/bills/extract', { method: 'POST', body: JSON.stringify({ file_url }) }),
  listBills: () => request('/api/bills'),
  vendorSummary: (month) => request(`/api/bills/vendor-summary${month ? `?month=${month}` : ''}`),
  updateBillStatus: (id, body) =>
    request(`/api/bills/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Conversion master (leadership only)
  listConversionMaster: () => request('/api/bills/conversion-master'),
  createConversionMaster: (body) =>
    request('/api/bills/conversion-master', { method: 'POST', body: JSON.stringify(body) }),
  updateBillItemConversion: (id, body) =>
    request(`/api/bills/items/${id}/conversion`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Cafeteria
  cafeteriaItems: () => request('/api/cafeteria/items'),
  quickOrder: (body) => request('/api/requests', { method: 'POST', body: JSON.stringify(body) }),
  addCafeteriaItem: (body) =>
    request('/api/cafeteria/items', { method: 'POST', body: JSON.stringify(body) }),
  updateCafeteriaItem: (id, body) =>
    request(`/api/cafeteria/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  selfPickupStatus: () => request('/api/cafeteria/self-pickup-status'),
  applyOBLeave: (body) =>
    request('/api/cafeteria/ob-leave', { method: 'POST', body: JSON.stringify(body) }),
  listOBLeave: () => request('/api/cafeteria/ob-leave'),
  cancelOBLeave: (id) => request(`/api/cafeteria/ob-leave/${id}`, { method: 'DELETE' }),

  // Meals
  mealOptions: (date) => request(`/api/meals/options?date=${date}`),
  bookMeal: (body) => request('/api/meals/book', { method: 'POST', body: JSON.stringify(body) }),
  myMealBookings: (month) => request(`/api/meals/my-bookings?month=${month}`),
  mealSummary: (date) => request(`/api/meals/summary?date=${date}`),
  mealSettings: () => request('/api/meals/settings'),
  rateMeal: (date, body) =>
    request(`/api/meals/${date}/rate`, { method: 'POST', body: JSON.stringify(body) }),

  // Meal Box System
  myMealToken: (date) => request(`/api/meal-print/my-token?date=${date}`),
  mealPrintStatus: (date) => request(`/api/meal-print/status?date=${date}`),
  triggerCabinPrint: (body) =>
    request('/api/meal-print/trigger-cabin', { method: 'POST', body: JSON.stringify(body) }),
  reprintToken: (body) =>
    request('/api/meal-print/reprint-token', { method: 'POST', body: JSON.stringify(body) }),
  cabinBookings: (date, cabin) =>
    request(`/api/meal-print/cabin-bookings?date=${date}&cabin=${encodeURIComponent(cabin)}`),

  listMonthlyExpenses: () => request('/api/reports/monthly-expenses'),
  addMonthlyExpense: (body) =>
    request('/api/reports/monthly-expenses', { method: 'POST', body: JSON.stringify(body) }),
  deleteMonthlyExpense: (id) =>
    request(`/api/reports/monthly-expenses/${id}`, { method: 'DELETE' }),

  // Manual Purchases (no-invoice, submitted via Telegram)
  listManualPurchases: (status = 'all') =>
    request(`/api/manual-purchases${status && status !== 'all' ? `?status=${status}` : ''}`),
  approveManualPurchase: (id) => request(`/api/manual-purchases/${id}/approve`, { method: 'POST' }),
  rejectManualPurchase: (id, reason) =>
    request(`/api/manual-purchases/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  clarifyManualPurchase: (id, question) =>
    request(`/api/manual-purchases/${id}/clarify`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),
  syncManualPurchase: (id) => request(`/api/manual-purchases/${id}/sync`, { method: 'POST' }),

  // Predictive ordering (Feature #9)
  forecasts: () => request('/api/forecasts'),
  runForecast: () => request('/api/forecasts/run', { method: 'POST' }),
};
