import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://twmadauhauuypioznpus.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'mock-anon-key';

// Initialize Supabase Client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Playwright Helper Functions ──────────────────────────────────────────────

/**
 * Helper 1: Installs the virtual clock and freezes it at the mock date/time.
 */
async function setMockTime(page, timeString) {
  await page.clock.install({ time: new Date(timeString) });
}

/**
 * Helper 2: Bypasses MFA and logs in a user by injecting a pre-signed JWT token 
 * with the 'aal2' (MFA completed) claim directly into localStorage, and mocking Auth calls.
 */
async function loginAs(page, email, password = 'Applywizz@2026') {
  const tokenKey = 'sb-twmadauhauuypioznpus-auth-token';
  const userId = email.includes('day') ? 'day-user-uuid-1234' : 'night-user-uuid-5678';
  
  // Construct a mock JWT containing custom user details and 'aal2' claim
  const payload = {
    aal: 'aal2',
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: userId,
    email: email,
    role: 'authenticated',
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  const mockJwt = `${header}.${body}.mock-signature`;

  const session = {
    access_token: mockJwt,
    refresh_token: 'mock-refresh-token',
    user: {
      id: userId,
      email: email,
      role: 'authenticated',
      aud: 'authenticated',
      user_metadata: { full_name: email.split('@')[0] },
    },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };

  // Inject session storage token before document load
  await page.addInitScript(
    ({ key, data }) => {
      window.localStorage.setItem(key, JSON.stringify(data));
    },
    { key: tokenKey, data: session }
  );

  // Intercept Supabase Auth endpoints to ensure client initializes as logged in
  await page.route('**/auth/v1/user', async (route) => {
    await route.fulfill({ json: session.user });
  });

  await page.route('**/auth/v1/factors', async (route) => {
    await route.fulfill({ json: { all: [], active: [] } });
  });

  // Mock profile query retrieval (safer wildcard pattern to handle any select parameters)
  await page.route('**/rest/v1/profiles**', async (route) => {
    await route.fulfill({
      json: [
        {
          id: userId,
          full_name: email.split('@')[0].replace('_', ' '),
          preferred_name: email.split('@')[0].split('_')[0],
          role: 'staff',
          email: email,
        },
      ],
    });
  });

  // Mock cafeteria preferences to bypass onboarding gate (safer wildcard pattern)
  await page.route('**/rest/v1/employee_cafeteria_preferences**', async (route) => {
    await route.fulfill({
      json: [
        {
          user_id: userId,
          onboarding_completed: true,
        },
      ],
    });
  });
}

/**
 * Helper 3: Registers precise mock routes for request details to simulate database order state.
 * Uses exact regex matching to prevent conflicts between list and single-item requests.
 */
async function createTestOrder(page, orderId, orderDetails) {
  const { email, created_at, status, live_status, rating_status = 'pending', rating = null, feedback = null } = orderDetails;
  
  // Intercept the individual order GET API (exact matching on /api/requests/:id)
  await page.route(new RegExp(`\\/api\\/requests\\/${orderId}$`), async (route) => {
    await route.fulfill({
      json: {
        id: orderId,
        raw_text: '1x Espresso to Marketing Team',
        category: 'beverage',
        parsed_item: 'Espresso',
        parsed_employee_name: email.split('@')[0].replace('_', ' '),
        parsed_location: 'Marketing Team',
        status: typeof status === 'function' ? status() : status,
        live_status: typeof live_status === 'function' ? live_status() : live_status,
        created_at: created_at,
        rating_status: typeof rating_status === 'function' ? rating_status() : rating_status,
        rating: typeof rating === 'function' ? rating() : rating,
        feedback: typeof feedback === 'function' ? feedback() : feedback,
      }
    });
  });

  // Intercept the requests list GET API (matching exactly /api/requests or /api/requests?...)
  await page.route(/\/api\/requests(\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: [
          {
            id: orderId,
            raw_text: '1x Espresso to Marketing Team',
            category: 'beverage',
            parsed_item: 'Espresso',
            parsed_employee_name: email.split('@')[0].replace('_', ' '),
            parsed_location: 'Marketing Team',
            status: typeof status === 'function' ? status() : status,
            live_status: typeof live_status === 'function' ? live_status() : live_status,
            created_at: created_at,
            rating_status: typeof rating_status === 'function' ? rating_status() : rating_status,
            rating: typeof rating === 'function' ? rating() : rating,
            feedback: typeof feedback === 'function' ? feedback() : feedback,
          },
        ],
      });
    } else {
      await route.fallback();
    }
  });
}
async function assertRatingDisplayed(page, expectedVisible) {
  if (expectedVisible) {
    // Wait for the rating modal delay in the frontend using virtual clock
    await page.clock.runFor(1500);
    await expect(page.getByText(/Hope it hit the spot/i)).toBeVisible();
    await expect(page.locator('button:has-text("10")')).toBeVisible();
  } else {
    await expect(page.getByText(/Hope it hit the spot/i)).not.toBeVisible();
    await expect(page.locator('button:has-text("10")')).not.toBeVisible();
  }
}

// ── Test Suite ───────────────────────────────────────────────────────────────

test.describe('Office Pantry - E2E Shift Flows and Rating Persistence', () => {
  const DAY_USER_EMAIL = 'day_employee@applywizz.ai';
  const NIGHT_USER_EMAIL = 'night_employee@applywizz.ai';

  test.beforeEach(async ({ page }) => {
    // Capture browser console logs
    page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.log('[Browser Error]', err.message));

    // Abort service worker to avoid network intercept collisions
    await page.route('**/sw.js', (route) => route.abort());

    // Mock active queue count
    await page.route('**/api/requests/queue-count', async (route) => {
      await route.fulfill({ json: { pending: 0, in_progress: 0 } });
    });
  });

  // ── TEST 1: Daytime Order Full Flow ────────────────────────────────────────
  test('Daytime order full flow (10 AM IST) - pending to done with rating prompt', async ({ page }) => {
    // Simulate day shift hours (10:00 AM IST)
    await setMockTime(page, '2026-05-26T10:00:00+05:30');

    // Login as day employee
    await loginAs(page, DAY_USER_EMAIL);

    let orderStatus = 'confirming';
    let liveStatus = 'confirming';

    // Mock initial order placement and live status
    await createTestOrder(page, 'order-day-1', {
      email: DAY_USER_EMAIL,
      created_at: '2026-05-26T10:00:00+05:30',
      status: () => orderStatus,
      live_status: () => liveStatus,
    });

    // Mock backend order confirmation API
    await page.route('**/api/requests/order-day-1/confirm', async (route) => {
      orderStatus = 'pending';
      liveStatus = 'placed';
      await route.fulfill({
        json: { id: 'order-day-1', status: orderStatus, live_status: liveStatus },
      });
    });

    // Go to the tracker view
    await page.goto('/track/order-day-1');

    // Order should start in Zomato/Swiggy style confirmation screen
    await expect(page.getByText(/Order Confirmed!/i)).toBeVisible();

    // Fast-forward past the 30-second cancellation window and wait for async tasks
    await page.clock.runFor(31000);
    await page.clock.runFor(5000);

    // Verify it automatically transitions to "Order Placed" (.first() resolves strict mode violation)
    await expect(page.getByText(/Order Placed/i).first()).toBeVisible();

    // Simulate office boy marking order as delivered (done / delivered)
    orderStatus = 'done';
    liveStatus = 'delivered';
    await page.reload();

    // Verify delivery feedback rating prompt is visible
    await assertRatingDisplayed(page, true);
  });

  // ── TEST 2: Night Shift Order Flow (Recorded) ──────────────────────────────
  test('Night shift order flow (8 PM IST) - auto done as Recorded', async ({ page }) => {
    // Simulate night shift hours (8:00 PM IST)
    await setMockTime(page, '2026-05-26T20:00:00+05:30');

    // Login as night employee
    await loginAs(page, NIGHT_USER_EMAIL);

    let orderStatus = 'confirming';
    let liveStatus = 'confirming';

    // Mock initial order placement
    await createTestOrder(page, 'order-night-1', {
      email: NIGHT_USER_EMAIL,
      created_at: '2026-05-26T20:00:00+05:30',
      status: () => orderStatus,
      live_status: () => liveStatus,
    });

    // Intercept confirm call: Night shift transitions directly to done & Recorded
    let printRequestIntercepted = false;
    await page.route('**/api/requests/order-night-1/confirm', async (route) => {
      orderStatus = 'done';
      liveStatus = 'Recorded';
      printRequestIntercepted = true; // Mark print agent database trigger event simulated
      await route.fulfill({
        json: { id: 'order-night-1', status: orderStatus, live_status: liveStatus },
      });
    });

    // Go to tracker view
    await page.goto('/track/order-night-1');

    // Order should start in Swiggy style confirmation screen
    await expect(page.getByText(/Order Confirmed!/i)).toBeVisible();

    // Fast-forward past the 30-second cancellation window and wait for async tasks
    await page.clock.runFor(31000);

    // Reload page to fetch updated database state and render final Recorded view
    await page.reload();

    // Verify order completes directly as "Order Recorded!" and alerts employee of self-pickup
    await expect(page.getByText(/Order Recorded!/i)).toBeVisible();
    await expect(page.getByText(/No delivery\/office boy service/i)).toBeVisible();
    
    // Verify rating UI is completely skipped
    await assertRatingDisplayed(page, false);

    // Verify print event was simulated (database state transitioned to done + Recorded)
    expect(printRequestIntercepted).toBe(true);
  });

  // ── TEST 3: Rating Persistence ─────────────────────────────────────────────
  test('Rating persistence - rating persists and remains visible on reload', async ({ page }) => {
    await setMockTime(page, '2026-05-26T10:00:00+05:30');
    await loginAs(page, DAY_USER_EMAIL);

    let ratingVal = null;
    let feedbackVal = null;
    let ratingStatus = 'pending';

    // Mock active completed order
    await createTestOrder(page, 'order-day-2', {
      email: DAY_USER_EMAIL,
      created_at: '2026-05-26T10:00:00+05:30',
      status: 'done',
      live_status: 'delivered',
      rating_status: () => ratingStatus,
      rating: () => ratingVal,
      feedback: () => feedbackVal,
    });

    // Intercept rating submission endpoint
    await page.route('**/api/requests/order-day-2/rate', async (route) => {
      const payload = route.request().postDataJSON();
      ratingVal = payload.rating;
      feedbackVal = payload.feedback;
      ratingStatus = 'done';
      await route.fulfill({
        json: { id: 'order-day-2', rating: ratingVal, feedback: feedbackVal, rating_status: ratingStatus },
      });
    });

    // Go to tracker view
    await page.goto('/track/order-day-2');

    // Wait for the delay and then select 10/10 stars
    await page.waitForTimeout(1500);
    await page.locator('button:has-text("10")').click();
    await page.getByPlaceholder(/shoutout/i).fill('Great');

    // Wait for the rate POST request to complete
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/requests/order-day-2/rate') && response.status() === 200
    );
    await page.getByRole('button', { name: /Send Rating/i }).click();
    await responsePromise;

    // Reload page to verify persistence from the database view
    await page.reload();

    // Verify review text is still rendered
    await expect(page.getByText(/Great/i)).toBeVisible();
  });

  // ── TEST 4: Night Shift - No Rating UI ──────────────────────────────────────
  test('Night shift - no rating UI or feedback form shown on completed orders', async ({ page }) => {
    await setMockTime(page, '2026-05-26T20:00:00+05:30');
    await loginAs(page, NIGHT_USER_EMAIL);

    // Mock a completed night order (status=done, live_status=Recorded)
    await createTestOrder(page, 'order-night-2', {
      email: NIGHT_USER_EMAIL,
      created_at: '2026-05-26T20:00:00+05:30',
      status: 'done',
      live_status: 'Recorded',
    });

    // Go to tracker
    await page.goto('/track/order-night-2');

    // Confirm that rating prompts and text feedback boxes are absent
    await assertRatingDisplayed(page, false);
  });

  // ── TEST 5: Day-to-Night Edge Case ──────────────────────────────────────────
  test('Day-to-night edge - morning shift employee ordering at 8 PM gets night flow', async ({ page }) => {
    // Placed at 8:00 PM IST (Night shift hours)
    await setMockTime(page, '2026-05-26T20:00:00+05:30');

    // Logged in as a day shift employee (Ramakrishna scenario)
    await loginAs(page, DAY_USER_EMAIL);

    let orderStatus = 'confirming';
    let liveStatus = 'confirming';

    await createTestOrder(page, 'order-edge-1', {
      email: DAY_USER_EMAIL,
      created_at: '2026-05-26T20:00:00+05:30',
      status: () => orderStatus,
      live_status: () => liveStatus,
    });

    await page.route('**/api/requests/order-edge-1/confirm', async (route) => {
      orderStatus = 'done';
      liveStatus = 'Recorded';
      await route.fulfill({
        json: { id: 'order-edge-1', status: orderStatus, live_status: liveStatus },
      });
    });

    // Go to tracker
    await page.goto('/track/order-edge-1');

    // Confirming order begins (Zomato/Swiggy style countdown screen)
    await expect(page.getByText(/Order Confirmed!/i)).toBeVisible();

    // Fast-forward past 30s cancellation window and wait for async tasks
    await page.clock.runFor(31000);

    // Reload page to fetch updated database state
    await page.reload();

    // Should resolve straight to "Order Recorded!" night flow (regardless of employee's own shift hours)
    await expect(page.getByText(/Order Recorded!/i)).toBeVisible();
    await expect(page.getByText(/No delivery\/office boy service/i)).toBeVisible();
    await assertRatingDisplayed(page, false);
  });
});
