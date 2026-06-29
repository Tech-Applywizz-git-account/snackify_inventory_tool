import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

const API = process.env.E2E_API_URL || 'http://localhost:4000';

function getISTDate() {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
  ).toISOString().slice(0, 10);
}

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
async function loginAs(page, email, role = 'staff', cabin = 'Tech Cabin') {
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

  // Mock profile query retrieval (role is matched dynamically)
  await page.route('**/rest/v1/profiles**', async (route) => {
    await route.fulfill({
      json: [
        {
          id: userId,
          full_name: email.split('@')[0].replace('_', ' '),
          preferred_name: email.split('@')[0].split('_')[0],
          role: role,
          email: email,
        },
      ],
    });
  });

  // Mock cafeteria preferences to bypass onboarding gate
  await page.route('**/rest/v1/employee_cafeteria_preferences**', async (route) => {
    await route.fulfill({
      json: [
        {
          user_id: userId,
          onboarding_completed: true,
          cabin: cabin,
          shift: email.includes('night') ? 'night' : 'morning',
        },
      ],
    });
  });
}

/**
 * Helper 3: Registers precise mock routes for request details to simulate database order state.
 */
async function mockRequestFlow(page, orderId, orderDetails) {
  const { email, created_at, status, live_status } = orderDetails;
  
  const mockOrder = {
    id: orderId,
    raw_text: '1x Espresso to Desk 4',
    category: 'beverage',
    parsed_item: 'Espresso',
    parsed_employee_name: email.split('@')[0].replace('_', ' '),
    parsed_location: 'Desk 4',
    status: status,
    live_status: live_status,
    created_at: created_at,
    rating_status: 'pending',
    rating: null,
    feedback: null
  };

  // Intercept the individual order GET API
  await page.route(new RegExp(`\\/api\\/requests\\/${orderId}$`), async (route) => {
    await route.fulfill({ json: mockOrder });
  });

  // Intercept the requests list GET API
  await page.route(/\/api\/requests(\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [mockOrder] });
    } else {
      await route.fallback();
    }
  });
}

// ── Test Suite ───────────────────────────────────────────────────────────────

test.describe('Meal Box System — E2E Journeys', () => {
  const DAY_USER_EMAIL = 'day_employee@applywizz.ai';
  const OB_USER_EMAIL = 'office_boy@applywizz.ai';
  const today = getISTDate();

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

  // ═════════════════════════════════════════════════════════════════════════
  // 1. Route Protection & Role Controls
  // ═════════════════════════════════════════════════════════════════════════
  test.describe('Route Access Guard & Nav Links', () => {
    test('/my-meal-box redirects unauthenticated to /login', async ({ page }) => {
      await page.goto('/my-meal-box');
      await expect(page).toHaveURL(/\/login/);
    });

    test('/meal-token-dashboard redirects unauthenticated to /login', async ({ page }) => {
      await page.goto('/meal-token-dashboard');
      await expect(page).toHaveURL(/\/login/);
    });

    test('Staff role gets blocked from accessing Meal Token Dashboard', async ({ page }) => {
      await loginAs(page, DAY_USER_EMAIL, 'staff');
      await page.goto('/meal-token-dashboard');
      
      // Playwright will auto-retry until "Access denied" is visible
      await expect(page.getByText(/Access denied/i)).toBeVisible();
    });

    test('Staff nav links visibility', async ({ page }) => {
      await loginAs(page, DAY_USER_EMAIL, 'staff');
      await page.goto('/meals');
      await page.waitForTimeout(1000);

      // Staff sees My Meal Box link but NOT Meal Token Dashboard
      await expect(page.getByRole('link', { name: /my meal box/i })).toBeVisible();
      await expect(page.getByRole('link', { name: /meal tokens/i })).not.toBeVisible();
    });

    test('Office Boy nav links visibility', async ({ page }) => {
      await loginAs(page, OB_USER_EMAIL, 'office_boy');
      await page.goto('/meals');
      await page.waitForTimeout(1000);

      // Office Boy sees both links
      await expect(page.getByRole('link', { name: /my meal box/i })).toBeVisible();
      await expect(page.getByRole('link', { name: /meal tokens/i })).toBeVisible();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2. Day-Shift Employee Journey
  // ═════════════════════════════════════════════════════════════════════════
  test.describe('Day-Shift Employee Journey', () => {
    test('Can book a meal and view the assigned token details', async ({ page }) => {
      // Set time to morning before cutoff (e.g. 10:00 AM)
      await setMockTime(page, `${today}T10:00:00+05:30`);
      await loginAs(page, DAY_USER_EMAIL, 'staff', 'Tech Cabin');

      // Mock initial empty bookings
      await page.route(new RegExp(`\\/api\\/meals\\/my-bookings`), async (route) => {
        await route.fulfill({ json: [] });
      });

      // Mock token info endpoint returning no token assigned yet
      await page.route(new RegExp(`\\/api\\/meal-print\\/my-token`), async (route) => {
        await route.fulfill({
          json: {
            booking: null,
            canReprint: false,
            reprintWindowMessage: 'Token assigned at 11:00 AM'
          }
        });
      });

      // Go to my-meal-box and verify empty state
      await page.goto('/my-meal-box');
      await expect(page.getByText('No meal booked for today')).toBeVisible();

      // Navigate to meal booking
      await page.getByRole('button', { name: 'Go to Meal Booking →' }).click();
      await expect(page).toHaveURL(/\/meals/);

      // Mock meal booking submission
      await page.route('**/api/meals/book', async (route) => {
        await route.fulfill({
          json: {
            message: '🥬 Veg booked!',
            booking: { meal_date: today, choice: 'veg' }
          }
        });
      });

      // Mock updated bookings list
      await page.route(new RegExp(`\\/api\\/meals\\/my-bookings`), async (route) => {
        await route.fulfill({
          json: [{ id: 'b-1', meal_date: today, choice: 'veg' }]
        });
      });

      // Select Veg option for next day or today in calendar
      const bookingChoiceCard = page.locator('div').filter({ hasText: /^🥬Veg$/ }).first();
      if (await bookingChoiceCard.isVisible()) {
        await bookingChoiceCard.click();
        // Close confirmation if open
        const confirmBtn = page.getByRole('button', { name: /confirm/i });
        if (await confirmBtn.isVisible()) {
          await confirmBtn.click();
        }
      }

      // Fast-forward to 11:15 AM IST (After token print is scheduled & printed)
      // The API now returns a fully assigned and printed token
      await page.route(new RegExp(`\\/api\\/meal-print\\/my-token`), async (route) => {
        await route.fulfill({
          json: {
            booking: {
              id: 'b-1',
              meal_date: today,
              choice: 'veg',
              token_number: `${today.slice(8,10)}MAY-TECH-001`,
              cabin_name: 'Tech Cabin',
              print_count: 1,
              last_printed_at: `${today}T11:06:00.000Z`,
              booked_at: `${today}T09:30:00.000Z`
            },
            canReprint: true,
            reprintWindowMessage: 'You can reprint your token until 1:30 PM'
          }
        });
      });

      // Navigate back to my meal box
      await page.goto('/my-meal-box');
      await page.waitForTimeout(1000);

      // Assert token details are visible (using exact matching to prevent strict mode violations)
      await expect(page.getByText('Today\'s Meal')).toBeVisible();
      await expect(page.getByText('Veg', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Tech Cabin', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('✅ Printed', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Collect from Tech Cabin Meal Box')).toBeVisible();

      // Intercept reprint requests
      let reprintCount = 1;
      await page.route('**/api/meal-print/reprint-token', async (route) => {
        reprintCount++;
        await route.fulfill({
          json: {
            ok: true,
            booking: {
              id: 'b-1',
              meal_date: today,
              choice: 'veg',
              token_number: `${today.slice(8,10)}MAY-TECH-001`,
              cabin_name: 'Tech Cabin',
              print_count: reprintCount,
              last_printed_at: new Date().toISOString()
            }
          }
        });
      });

      // Update mock after reprint is triggered
      await page.route(new RegExp(`\\/api\\/meal-print\\/my-token`), async (route) => {
        await route.fulfill({
          json: {
            booking: {
              id: 'b-1',
              meal_date: today,
              choice: 'veg',
              token_number: `${today.slice(8,10)}MAY-TECH-001`,
              cabin_name: 'Tech Cabin',
              print_count: reprintCount,
              last_printed_at: new Date().toISOString(),
              booked_at: `${today}T09:30:00.000Z`
            },
            canReprint: true,
            reprintWindowMessage: 'You can reprint your token until 1:30 PM'
          }
        });
      });

      // Click Reprint Button
      await page.getByRole('button', { name: /reprint/i }).first().click();
      await page.waitForTimeout(1000);

      // Assert that "DUPLICATE TOKEN" warning badge appears
      await expect(page.getByText('DUPLICATE TOKEN — Reprint #1')).toBeVisible();
    });

    test('Staff reprint button is disabled outside allowed time windows', async ({ page }) => {
      // Set time to 2:00 PM IST (After 1:30 PM staff cutoff)
      await setMockTime(page, `${today}T14:00:00+05:30`);
      await loginAs(page, DAY_USER_EMAIL, 'staff', 'Tech Cabin');

      await page.route(new RegExp(`\\/api\\/meal-print\\/my-token`), async (route) => {
        await route.fulfill({
          json: {
            booking: {
              id: 'b-1',
              meal_date: today,
              choice: 'veg',
              token_number: `${today.slice(8,10)}MAY-TECH-001`,
              cabin_name: 'Tech Cabin',
              print_count: 1,
              last_printed_at: `${today}T11:06:00.000Z`,
              booked_at: `${today}T09:30:00.000Z`
            },
            canReprint: false,
            reprintWindowMessage: 'Reprint window has closed (after 1:30 PM)'
          }
        });
      });

      await page.goto('/my-meal-box');
      await page.waitForTimeout(1000);

      // Verify that reprint button is not visible/clickable, instead displays window message
      await expect(page.getByText('Reprint window has closed (after 1:30 PM)')).toBeVisible();
      await expect(page.getByRole('button', { name: /reprint/i })).not.toBeVisible();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3. Facility Manager / Office Boy Dashboard
  // ═════════════════════════════════════════════════════════════════════════
  test.describe('Meal Token Dashboard — privileged controls', () => {
    test('Shows cabin statuses, triggers print, expands list and reprints token', async ({ page }) => {
      await setMockTime(page, `${today}T11:05:00+05:30`);
      await loginAs(page, OB_USER_EMAIL, 'office_boy');

      // Mock dashboard status endpoint
      await page.route(new RegExp(`\\/api\\/meal-print\\/status`), async (route) => {
        await route.fulfill({
          json: {
            date: today,
            cabins: [
              { cabin_name: 'Balaji Cabin', scheduled_time: `${today}T11:00:00.000Z`, status: 'completed', token_count: 1, total: 1, veg: 1, non_veg: 0, egg: 0 },
              { cabin_name: 'Rama Krishna Cabin', scheduled_time: `${today}T11:02:00.000Z`, status: 'completed', token_count: 1, total: 1, veg: 0, non_veg: 1, egg: 0 },
              { cabin_name: 'Tech Cabin', scheduled_time: `${today}T11:06:00.000Z`, status: 'pending', token_count: 2, total: 2, veg: 1, non_veg: 0, egg: 1 }
            ],
            summary: { totalMeals: 4, printedCabins: 2, totalCabins: 6 }
          }
        });
      });

      // Mock print triggers
      let triggerReceived = false;
      await page.route('**/api/meal-print/trigger-cabin', async (route) => {
        triggerReceived = true;
        await route.fulfill({
          json: { ok: true, job: { cabin_name: 'Tech Cabin', status: 'pending' } }
        });
      });

      await page.goto('/meal-token-dashboard');
      await page.waitForTimeout(1000);

      // Verify dashboard shows summary data (using exact matching for strict mode)
      await expect(page.getByText('Total Meals')).toBeVisible();
      await expect(page.getByText('4', { exact: true })).toBeVisible();

      // Verify Cabin status cards
      await expect(page.getByText('Balaji Cabin', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Printed').first()).toBeVisible();
      await expect(page.getByText('Tech Cabin', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Queued').first()).toBeVisible();

      // Click print override button for Tech Cabin
      page.once('dialog', async dialog => {
        expect(dialog.message()).toContain('print');
        await dialog.accept();
      });
      
      const printBtn = page.locator('button').filter({ hasText: 'Print' }).first();
      await printBtn.click();
      await page.waitForTimeout(1000);
      expect(triggerReceived).toBe(true);

      // Mock cabin bookings list expansion
      await page.route(new RegExp(`\\/api\\/meal-print\\/cabin-bookings`), async (route) => {
        await route.fulfill({
          json: [
            {
              id: 'b-jd-1',
              choice: 'veg',
              token_number: `${today.slice(8,10)}MAY-TECH-001`,
              cabin_name: 'Tech Cabin',
              print_count: 1,
              last_printed_at: `${today}T11:06:00.000Z`,
              profiles: {
                full_name: 'John Doe',
                preferred_name: 'John',
                employee_code: 'EMP123'
              }
            }
          ]
        });
      });

      // Expand Tech Cabin details
      const expandBtn = page.locator('button:has(svg)').last();
      await expandBtn.click();
      await page.waitForTimeout(1000);

      // Verify employee detail is visible
      await expect(page.getByText('John')).toBeVisible();
      await expect(page.getByText('EMP123')).toBeVisible();

      // Trigger reprint for John Doe
      let reprintTriggered = false;
      await page.route('**/api/meal-print/reprint-token', async (route) => {
        reprintTriggered = true;
        await route.fulfill({
          json: { ok: true, booking: { id: 'b-jd-1', print_count: 2 } }
        });
      });

      // Target reprint button specifically by title to prevent strict mode errors
      await page.getByTitle("Reprint this employee's token").click();
      await page.waitForTimeout(1000);
      expect(reprintTriggered).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4. Night-Shift Worker Journeys
  // ═════════════════════════════════════════════════════════════════════════
  test.describe('Night-Shift Worker Order Verification', () => {
    test('Night shift orders bypass normal delivery tracking and auto-complete as Recorded', async ({ page }) => {
      // Simulate night shift hours (8:00 PM IST)
      await setMockTime(page, `${today}T20:00:00+05:30`);
      await loginAs(page, 'night_employee@applywizz.ai', 'staff');

      // Mock request detail and list flows properly to bypass auth guards
      await mockRequestFlow(page, 'order-night-1', {
        email: 'night_employee@applywizz.ai',
        created_at: `${today}T20:00:00+05:30`,
        status: 'done',
        live_status: 'Recorded'
      });

      // Go to order tracker page
      await page.goto('/track/order-night-1');
      await page.waitForTimeout(1000);

      // Assert that night shift watermark info and self-pickup warnings are visible
      await expect(page.getByText('Order Recorded!')).toBeVisible();
      await expect(page.getByText('No delivery/office boy service is active at night')).toBeVisible();

      // Assert that feedback rating star elements are NOT rendered (bypassed)
      await expect(page.getByText(/Hope it hit the spot/i)).not.toBeVisible();
      await expect(page.locator('button:has-text("10")')).not.toBeVisible();
    });
  });
});
