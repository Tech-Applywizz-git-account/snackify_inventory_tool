import { test, expect } from '@playwright/test';

const USER_ID = 'meal-ticket-user-001';
const TEST_DATE = '2026-05-29';

function mockJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.test-signature`;
}

async function loginAsStaff(page) {
  const tokenKey = 'sb-twmadauhauuypioznpus-auth-token';
  const session = {
    access_token: mockJwt({
      aal: 'aal2',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: USER_ID,
      email: 'meal.ticket@applywizz.ai',
      role: 'authenticated',
    }),
    refresh_token: 'test-refresh-token',
    user: {
      id: USER_ID,
      email: 'meal.ticket@applywizz.ai',
      aud: 'authenticated',
      role: 'authenticated',
      user_metadata: { full_name: 'Meal Ticket' },
    },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };

  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: tokenKey, value: session },
  );

  await page.route('**/auth/v1/user', route => route.fulfill({ json: session.user }));
  await page.route('**/auth/v1/factors', route => route.fulfill({ json: { all: [], active: [] } }));
  await page.route('**/rest/v1/profiles**', route => route.fulfill({
    json: {
      id: USER_ID,
      full_name: 'Meal Ticket',
      preferred_name: 'Meal',
      role: 'staff',
      email: 'meal.ticket@applywizz.ai',
    },
  }));
  await page.route('**/rest/v1/employee_cafeteria_preferences**', route => route.fulfill({
    json: {
      user_id: USER_ID,
      onboarding_completed: true,
      shift: 'morning',
      notification_tone: 'Friendly',
      cabin: 'Tech Cabin',
    },
  }));
}

test.describe('Meal ticket visibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date(`${TEST_DATE}T10:00:00+05:30`) });
    await page.route('**/sw.js', route => route.abort());
    await page.route('**/api/requests/queue-count', route => route.fulfill({ json: { pending: 0, in_progress: 0 } }));
    await loginAsStaff(page);
  });

  test('booked meal shows View Ticket and token-pending reprint lock', async ({ page }) => {
    await page.route(/\/api\/meals\/my-bookings\?month=2026-05$/, route => route.fulfill({
      json: [{
        id: 'booking-001',
        user_id: USER_ID,
        meal_date: TEST_DATE,
        choice: 'veg',
        booked_at: `${TEST_DATE}T09:30:00+05:30`,
      }],
    }));

    await page.route(new RegExp(`/api/meal-print/my-token\\?date=${TEST_DATE}$`), route => route.fulfill({
      json: {
        booking: {
          id: 'booking-001',
          meal_date: TEST_DATE,
          choice: 'veg',
          token_number: null,
          cabin_name: null,
          print_count: 0,
          booked_at: `${TEST_DATE}T09:30:00+05:30`,
        },
        canReprint: false,
        reprintWindowMessage: 'Reprint opens after token generation',
      },
    }));

    await page.goto('/meals');
    await page.locator('button').filter({ hasText: '29' }).first().click();

    const viewTicket = page.getByRole('button', { name: /view ticket/i });
    await expect(viewTicket).toBeVisible();
    await viewTicket.click();

    await expect(page).toHaveURL(new RegExp(`/my-meal-box\\?date=${TEST_DATE}`));
    await expect(page.getByText(/Today's Meal|Meal Ticket/)).toBeVisible();
    await expect(page.getByText('Token pending').first()).toBeVisible();
    await expect(page.getByText('Token will be generated at print time')).toBeVisible();
    await expect(page.getByRole('button', { name: /reprint ticket/i })).toBeDisabled();
  });

  test('selected-date ticket shows token and reprint when token exists', async ({ page }) => {
    await page.route(new RegExp(`/api/meal-print/my-token\\?date=${TEST_DATE}$`), route => route.fulfill({
      json: {
        booking: {
          id: 'booking-001',
          meal_date: TEST_DATE,
          choice: 'veg',
          token_number: '29MAY-TECH-001',
          cabin_name: 'Tech Cabin',
          print_count: 1,
          last_printed_at: `${TEST_DATE}T11:05:00+05:30`,
          booked_at: `${TEST_DATE}T09:30:00+05:30`,
        },
        canReprint: true,
        reprintWindowMessage: 'You can reprint your token until 1:30 PM',
      },
    }));

    await page.goto(`/my-meal-box?date=${TEST_DATE}`);

    await expect(page.getByText('29MAY-TECH-001')).toBeVisible();
    await expect(page.getByText('Tech Cabin', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /reprint my token/i })).toBeVisible();
  });
});
