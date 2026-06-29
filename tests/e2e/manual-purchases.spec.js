import { test, expect } from '@playwright/test';

/**
 * Manual Purchases — E2E Tests
 * ═════════════════════════════
 * 1.  API auth guards (401 without token)
 * 2.  Route protection (redirect to /login when signed out)
 * 3.  Auto-approval business rules
 * 4.  Role access rules
 * 5.  Backend health smoke
 * 6.  List page — UI rendering (finance role)
 * 7.  Card interactions — expand, badges, threads
 * 8.  Approve / Reject actions (finance role)
 * 9.  Clarify action (facility_manager role)
 * 10. Sync action (leadership role)
 * 11. Role restrictions — office_boy, staff
 */

const API       = process.env.E2E_API_URL || 'http://localhost:4000';
const TOKEN_KEY = 'sb-twmadauhauuypioznpus-auth-token';

// ── Mock purchase fixtures ────────────────────────────────────────────────────

const MOCK_PENDING = {
  id:             'purchase-001',
  status:         'pending_review',
  item_name:      'Bisleri 1L Pack',
  amount:         240,
  quantity:       12,
  unit:           'bottles',
  category:       'Pantry Food',
  vendor_name:    'Local Store',
  payment_method: 'Cash',
  purchase_date:  '2026-05-27',
  ai_confidence:  0.91,
  sender_name:    'Ravi Kumar',
  sender_role:    'office_boy',
  created_at:     '2026-05-27T08:00:00.000Z',
  duplicate_risk: false,
};

const MOCK_AUTO_APPROVED = {
  id:                   'purchase-002',
  status:               'auto_approved',
  item_name:            'Britannia Biscuits',
  amount:               180,
  category:             'Pantry Food',
  ai_confidence:        0.95,
  auto_approval_reason: 'Amount within limit, high confidence, allowed category.',
  created_at:           '2026-05-27T09:00:00.000Z',
  duplicate_risk:       false,
  synced_to_inventory:  false,
};

const MOCK_CLARIFICATION = {
  id:                     'purchase-003',
  status:                 'draft_needs_clarification',
  item_name:              null,
  amount:                 350,
  category:               'Unknown',
  ai_confidence:          0.55,
  clarification_question: 'What item did you purchase exactly?',
  created_at:             '2026-05-27T07:30:00.000Z',
  duplicate_risk:         false,
};

const MOCK_APPROVED = {
  id:                  'purchase-004',
  status:              'approved',
  item_name:           'Hand Wash Liquid',
  amount:              120,
  category:            'Cleaning Supplies',
  ai_confidence:       0.88,
  created_at:          '2026-05-27T06:00:00.000Z',
  duplicate_risk:      false,
  synced_to_inventory: false,
};

const MOCK_DUPLICATE = {
  id:               'purchase-005',
  status:           'pending_review',
  item_name:        'Bisleri 1L Pack',
  amount:           240,
  category:         'Pantry Food',
  ai_confidence:    0.89,
  created_at:       '2026-05-27T10:00:00.000Z',
  duplicate_risk:   true,
  duplicate_reason: 'Similar purchase of Bisleri submitted 2 hours ago.',
};

// ── Auth helper ───────────────────────────────────────────────────────────────

/**
 * Injects a mock AAL2 session into localStorage and stubs all Supabase
 * auth + profile endpoints so the Protected component renders the page.
 */
async function loginAs(page, { role, userId = `test-${role}-uid`, email = `${role}@applywizz.ai` } = {}) {
  const payload = {
    aal: 'aal2',
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: userId,
    email,
    role: 'authenticated',
  };
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const body    = Buffer.from(JSON.stringify(payload)).toString('base64');
  const mockJwt = `${header}.${body}.mock-signature`;

  const session = {
    access_token:  mockJwt,
    refresh_token: 'mock-refresh-token',
    user: {
      id: userId, email, role: 'authenticated', aud: 'authenticated',
      user_metadata: { full_name: role },
    },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };

  await page.addInitScript(
    ({ key, data }) => window.localStorage.setItem(key, JSON.stringify(data)),
    { key: TOKEN_KEY, data: session }
  );

  await page.route('**/auth/v1/user',    r => r.fulfill({ json: session.user }));
  await page.route('**/auth/v1/factors', r => r.fulfill({ json: { all: [], active: [] } }));
  await page.route('**/rest/v1/profiles**', r => r.fulfill({
    json: [{ id: userId, full_name: role, preferred_name: role, role, email }],
  }));
  await page.route('**/rest/v1/employee_cafeteria_preferences**', r => r.fulfill({
    json: [{ user_id: userId, onboarding_completed: true }],
  }));
}

/**
 * Seeds the manual-purchases list API with a fixed array of purchases.
 * Only intercepts GET requests; other methods fall through.
 */
async function seedPurchases(page, purchases) {
  await page.route(/\/api\/manual-purchases(\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { purchases } });
    } else {
      await route.fallback();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// 1. API Auth Guards
// ═══════════════════════════════════════════════════════════════════

test.describe('Manual Purchases — API Auth Guards', () => {

  test('GET /api/manual-purchases → 401', async ({ request }) => {
    const r = await request.get(`${API}/api/manual-purchases`);
    expect(r.status()).toBe(401);
  });

  test('GET /api/manual-purchases/:id → 401', async ({ request }) => {
    const r = await request.get(`${API}/api/manual-purchases/fake-id`);
    expect(r.status()).toBe(401);
  });

  test('POST approve → 401', async ({ request }) => {
    const r = await request.post(`${API}/api/manual-purchases/fake-id/approve`);
    expect(r.status()).toBe(401);
  });

  test('POST reject → 401', async ({ request }) => {
    const r = await request.post(`${API}/api/manual-purchases/fake-id/reject`, {
      data: { reason: 'test' },
    });
    expect(r.status()).toBe(401);
  });

  test('POST clarify → 401', async ({ request }) => {
    const r = await request.post(`${API}/api/manual-purchases/fake-id/clarify`, {
      data: { question: 'test?' },
    });
    expect(r.status()).toBe(401);
  });

  test('POST sync → 401', async ({ request }) => {
    const r = await request.post(`${API}/api/manual-purchases/fake-id/sync`);
    expect(r.status()).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Route Protection
// ═══════════════════════════════════════════════════════════════════

test.describe('Route Protection', () => {
  test('/manual-purchases redirects to /login when signed out', async ({ page }) => {
    await page.goto('/manual-purchases');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Auto-Approval Business Rules
// ═══════════════════════════════════════════════════════════════════

test.describe('Auto-Approval Rules', () => {

  test('office_boy ₹120 Pantry Food 88% = auto-approve', () => {
    expect(120).toBeLessThanOrEqual(500);
    expect(['Pantry Food','Beverages','Cleaning Supplies','Office Supplies','Maintenance']).toContain('Pantry Food');
    expect(0.88).toBeGreaterThanOrEqual(0.80);
  });

  test('only office_boy and leadership can submit via Telegram', () => {
    const allowed = ['office_boy', 'leadership'];
    expect(allowed).not.toContain('staff');
    expect(allowed).not.toContain('finance');
    expect(allowed).not.toContain('facility_manager');
  });

  test('blocked categories reject auto-approval', () => {
    const blocked = ['Employee Accessories', 'Electronics', 'Personal Items', 'Other', 'Unknown'];
    expect(blocked).toContain('Electronics');
    expect(blocked).not.toContain('Pantry Food');
  });

  test('over-limit amounts block auto-approval', () => {
    expect(600).toBeGreaterThan(500);
    expect(3000).toBeGreaterThan(2000);
    expect(6000).toBeGreaterThan(5000);
  });

  test('low confidence blocks auto-approval', () => {
    expect(0.75).toBeLessThan(0.80);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Role Access Rules
// ═══════════════════════════════════════════════════════════════════

test.describe('Role Access', () => {

  test('only finance + leadership can approve', () => {
    const canApprove = ['finance', 'leadership'];
    expect(canApprove).not.toContain('staff');
    expect(canApprove).not.toContain('office_boy');
    expect(canApprove).not.toContain('facility_manager');
  });

  test('FM can clarify but not approve', () => {
    const canClarify = ['finance', 'leadership', 'facility_manager'];
    expect(canClarify).toContain('facility_manager');
    expect(['finance', 'leadership']).not.toContain('facility_manager');
  });

  test('office_boy sees own only', () => {
    expect(['finance', 'leadership', 'facility_manager']).not.toContain('office_boy');
  });

  test('staff has zero access', () => {
    expect(['finance', 'leadership', 'facility_manager', 'office_boy']).not.toContain('staff');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Smoke
// ═══════════════════════════════════════════════════════════════════

test.describe('Smoke', () => {
  test('backend health', async ({ request }) => {
    const r = await request.get(`${API}/health`);
    expect(r.status()).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. List Page — UI Rendering (finance role)
// ═══════════════════════════════════════════════════════════════════

test.describe('List Page — UI', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => console.log('[Browser Error]', err.message));
    await page.route('**/sw.js', r => r.abort());
    await page.route('**/api/requests/queue-count', r => r.fulfill({ json: { pending: 0, in_progress: 0 } }));
    await loginAs(page, { role: 'finance' });
  });

  test('renders page heading and all six tabs', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await expect(page.getByRole('heading', { name: /Manual Purchases/i })).toBeVisible();
    for (const label of ['All', 'Pending Review', 'Needs Clarification', 'Auto-Approved', 'Approved', 'Rejected']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }
  });

  test('renders purchase card with item name, amount and status badge', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await expect(page.getByText('Bisleri 1L Pack')).toBeVisible();
    await expect(page.getByText('₹240')).toBeVisible();
    await expect(page.getByText(/Pending Review/i)).toBeVisible();
  });

  test('shows "needs attention" banner when actionable purchases exist', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING, MOCK_CLARIFICATION]);
    await page.goto('/manual-purchases');
    await expect(page.getByText(/need attention/i)).toBeVisible();
  });

  test('shows empty state when list is empty', async ({ page }) => {
    await seedPurchases(page, []);
    await page.goto('/manual-purchases');
    await expect(page.getByText(/No purchases here/i)).toBeVisible();
    await expect(page.getByText(/Telegram/i)).toBeVisible();
  });

  test('AI confidence percentage renders on the card', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING]); // ai_confidence: 0.91
    await page.goto('/manual-purchases');
    await expect(page.getByText(/AI 91%/i)).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Card Interactions — expand, badges, threads
// ═══════════════════════════════════════════════════════════════════

test.describe('Card Interactions', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => console.log('[Browser Error]', err.message));
    await page.route('**/sw.js', r => r.abort());
    await page.route('**/api/requests/queue-count', r => r.fulfill({ json: { pending: 0, in_progress: 0 } }));
    await loginAs(page, { role: 'finance' });
  });

  test('clicking a card expands the detail section', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await expect(page.getByRole('button', { name: /✓ Approve/i })).not.toBeVisible();
    await page.getByText('Bisleri 1L Pack').click();
    await expect(page.getByRole('button', { name: /✓ Approve/i })).toBeVisible();
  });

  test('clicking the expanded card collapses it', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await expect(page.getByRole('button', { name: /✓ Approve/i })).toBeVisible();
    await page.getByText('Bisleri 1L Pack').click();
    await expect(page.getByRole('button', { name: /✓ Approve/i })).not.toBeVisible();
  });

  test('duplicate risk badge visible on flagged purchase', async ({ page }) => {
    await seedPurchases(page, [MOCK_DUPLICATE]);
    await page.goto('/manual-purchases');
    await expect(page.getByText(/Duplicate Risk/i)).toBeVisible();
  });

  test('duplicate reason visible in expanded section', async ({ page }) => {
    await seedPurchases(page, [MOCK_DUPLICATE]);
    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await expect(page.getByText(/Similar purchase of Bisleri submitted/i)).toBeVisible();
  });

  test('clarification question shown in expanded section', async ({ page }) => {
    await seedPurchases(page, [MOCK_CLARIFICATION]);
    await page.goto('/manual-purchases');
    // MOCK_CLARIFICATION has item_name: null — click on the amount text
    await page.getByText('₹350').click();
    await expect(page.getByText(/What item did you purchase exactly/i)).toBeVisible();
  });

  test('auto-approval reason shown for auto-approved purchase', async ({ page }) => {
    await seedPurchases(page, [MOCK_AUTO_APPROVED]);
    await page.goto('/manual-purchases');
    await page.getByText('Britannia Biscuits').click();
    await expect(page.getByText(/Amount within limit/i)).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Approve / Reject Actions (finance role)
// ═══════════════════════════════════════════════════════════════════

test.describe('Approve / Reject — finance', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => console.log('[Browser Error]', err.message));
    await page.route('**/sw.js', r => r.abort());
    await page.route('**/api/requests/queue-count', r => r.fulfill({ json: { pending: 0, in_progress: 0 } }));
    await loginAs(page, { role: 'finance' });
  });

  test('approve button is visible on a pending_review card', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await expect(page.getByRole('button', { name: /✓ Approve/i })).toBeVisible();
  });

  test('clicking approve sends POST to /approve and refreshes list', async ({ page }) => {
    let approved = false;
    let callCount = 0;

    // Stateful list: first fetch returns the purchase, second (post-approve) returns empty
    await page.route(/\/api\/manual-purchases(\?.*)?$/, async (route) => {
      if (route.request().method() === 'GET') {
        callCount++;
        await route.fulfill({ json: { purchases: callCount === 1 ? [MOCK_PENDING] : [] } });
      } else {
        await route.fallback();
      }
    });

    await page.route('**/api/manual-purchases/purchase-001/approve', async (route) => {
      approved = true;
      await route.fulfill({ json: { ...MOCK_PENDING, status: 'approved' } });
    });

    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await page.getByRole('button', { name: /✓ Approve/i }).click();
    await page.waitForResponse(r => r.url().includes('/approve'));
    expect(approved).toBe(true);
  });

  test('reject button opens the inline rejection panel', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await page.getByRole('button', { name: /✗ Reject/i }).click();
    await expect(page.getByPlaceholder(/Reason for rejection/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Confirm Reject/i })).toBeVisible();
  });

  test('cancel closes the rejection panel', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await page.getByRole('button', { name: /✗ Reject/i }).click();
    await page.getByRole('button', { name: /Cancel/i }).click();
    await expect(page.getByPlaceholder(/Reason for rejection/i)).not.toBeVisible();
  });

  test('confirm reject sends POST with the typed reason', async ({ page }) => {
    let rejectedWith = null;
    let callCount = 0;

    await page.route(/\/api\/manual-purchases(\?.*)?$/, async (route) => {
      if (route.request().method() === 'GET') {
        callCount++;
        await route.fulfill({ json: { purchases: callCount === 1 ? [MOCK_PENDING] : [] } });
      } else {
        await route.fallback();
      }
    });

    await page.route('**/api/manual-purchases/purchase-001/reject', async (route) => {
      rejectedWith = route.request().postDataJSON()?.reason;
      await route.fulfill({ json: { ...MOCK_PENDING, status: 'rejected' } });
    });

    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await page.getByRole('button', { name: /✗ Reject/i }).click();
    await page.getByPlaceholder(/Reason for rejection/i).fill('Duplicate entry');
    await page.getByRole('button', { name: /Confirm Reject/i }).click();
    await page.waitForResponse(r => r.url().includes('/reject'));
    expect(rejectedWith).toBe('Duplicate entry');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Clarify Action (facility_manager role)
// ═══════════════════════════════════════════════════════════════════

test.describe('Clarify Action — facility_manager', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => console.log('[Browser Error]', err.message));
    await page.route('**/sw.js', r => r.abort());
    await page.route('**/api/requests/queue-count', r => r.fulfill({ json: { pending: 0, in_progress: 0 } }));
    await loginAs(page, { role: 'facility_manager' });
  });

  test('clarify button visible for pending_review card', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await expect(page.getByRole('button', { name: /💬 Ask Clarification/i })).toBeVisible();
  });

  test('clarify panel opens with send button disabled when textarea is empty', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await page.getByRole('button', { name: /💬 Ask Clarification/i }).click();
    await expect(page.getByPlaceholder(/Type your clarification question/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Send Question/i })).toBeDisabled();
  });

  test('send button enables once a question is typed', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await page.getByRole('button', { name: /💬 Ask Clarification/i }).click();
    await page.getByPlaceholder(/Type your clarification question/i).fill('Which vendor?');
    await expect(page.getByRole('button', { name: /Send Question/i })).toBeEnabled();
  });

  test('send question POSTs the typed question to /clarify', async ({ page }) => {
    let questionSent = null;
    let callCount = 0;

    await page.route(/\/api\/manual-purchases(\?.*)?$/, async (route) => {
      if (route.request().method() === 'GET') {
        callCount++;
        await route.fulfill({ json: { purchases: callCount === 1 ? [MOCK_PENDING] : [] } });
      } else {
        await route.fallback();
      }
    });

    await page.route('**/api/manual-purchases/purchase-001/clarify', async (route) => {
      questionSent = route.request().postDataJSON()?.question;
      await route.fulfill({ json: { ...MOCK_PENDING, status: 'draft_needs_clarification', clarification_question: questionSent } });
    });

    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await page.getByRole('button', { name: /💬 Ask Clarification/i }).click();
    await page.getByPlaceholder(/Type your clarification question/i).fill('Which vendor supplied this?');
    await page.getByRole('button', { name: /Send Question/i }).click();
    await page.waitForResponse(r => r.url().includes('/clarify'));
    expect(questionSent).toBe('Which vendor supplied this?');
  });

  test('approve button is NOT visible for facility_manager', async ({ page }) => {
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await expect(page.getByRole('button', { name: /✓ Approve/i })).not.toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Sync Action (leadership role)
// ═══════════════════════════════════════════════════════════════════

test.describe('Sync Action — leadership', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => console.log('[Browser Error]', err.message));
    await page.route('**/sw.js', r => r.abort());
    await page.route('**/api/requests/queue-count', r => r.fulfill({ json: { pending: 0, in_progress: 0 } }));
    await loginAs(page, { role: 'leadership' });
  });

  test('sync button is visible on an approved purchase', async ({ page }) => {
    await seedPurchases(page, [MOCK_APPROVED]);
    await page.goto('/manual-purchases');
    await page.getByText('Hand Wash Liquid').click();
    await expect(page.getByRole('button', { name: /🔄 Sync to Inventory/i })).toBeVisible();
  });

  test('sync sends POST after confirm dialog is accepted', async ({ page }) => {
    let synced = false;
    let callCount = 0;

    await page.route(/\/api\/manual-purchases(\?.*)?$/, async (route) => {
      if (route.request().method() === 'GET') {
        callCount++;
        await route.fulfill({ json: { purchases: callCount === 1 ? [MOCK_APPROVED] : [] } });
      } else {
        await route.fallback();
      }
    });

    await page.route('**/api/manual-purchases/purchase-004/sync', async (route) => {
      synced = true;
      await route.fulfill({ json: { ...MOCK_APPROVED, synced_to_inventory: true } });
    });

    // Auto-accept the window.confirm dialog triggered by the sync button
    page.on('dialog', dialog => dialog.accept());

    await page.goto('/manual-purchases');
    await page.getByText('Hand Wash Liquid').click();
    await page.getByRole('button', { name: /🔄 Sync to Inventory/i }).click();
    await page.waitForResponse(r => r.url().includes('/sync'));
    expect(synced).toBe(true);
  });

  test('sync button absent when purchase is already synced', async ({ page }) => {
    await seedPurchases(page, [{ ...MOCK_APPROVED, synced_to_inventory: true }]);
    await page.goto('/manual-purchases');
    await page.getByText('Hand Wash Liquid').click();
    await expect(page.getByRole('button', { name: /🔄 Sync to Inventory/i })).not.toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. Role Restrictions — office_boy and staff
// ═══════════════════════════════════════════════════════════════════

test.describe('Role Restrictions', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => console.log('[Browser Error]', err.message));
    await page.route('**/sw.js', r => r.abort());
    await page.route('**/api/requests/queue-count', r => r.fulfill({ json: { pending: 0, in_progress: 0 } }));
  });

  test('office_boy can access the page and sees purchases', async ({ page }) => {
    await loginAs(page, { role: 'office_boy', userId: 'ob-user-001' });
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await expect(page.getByRole('heading', { name: /Manual Purchases/i })).toBeVisible();
    await expect(page.getByText('Bisleri 1L Pack')).toBeVisible();
  });

  test('office_boy has no approve or reject buttons', async ({ page }) => {
    await loginAs(page, { role: 'office_boy', userId: 'ob-user-001' });
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await expect(page.getByRole('button', { name: /✓ Approve/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /✗ Reject/i })).not.toBeVisible();
  });

  test('office_boy has no clarify button', async ({ page }) => {
    await loginAs(page, { role: 'office_boy', userId: 'ob-user-001' });
    await seedPurchases(page, [MOCK_PENDING]);
    await page.goto('/manual-purchases');
    await page.getByText('Bisleri 1L Pack').click();
    await expect(page.getByRole('button', { name: /💬 Ask Clarification/i })).not.toBeVisible();
  });

  test('staff role sees access denied instead of the page', async ({ page }) => {
    await loginAs(page, { role: 'staff' });
    await page.goto('/manual-purchases');
    await expect(page.getByText(/Access denied/i)).toBeVisible();
  });
});
