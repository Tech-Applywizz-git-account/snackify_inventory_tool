import { test, expect } from '@playwright/test';

/**
 * Smoke tests — verifies the app loads and the unauthenticated experience works.
 * Authenticated flows below are skipped until you set:
 *   E2E_EMAIL  — a Supabase user email
 *   E2E_OTP    — (optional) a pre-shared session token via storageState (preferred)
 *
 * To test signed-in flows reliably, generate a Supabase session JWT for a
 * facility_manager test user, save it to tests/e2e/.auth/state.json, then point
 * playwright.config.js -> use.storageState at that file.
 */test('login page renders', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText(/Pantry Online/i)).toBeVisible();
  await expect(page.getByPlaceholder(/you@applywizz\.ai/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue/i })).toBeVisible();
});
test('protected route redirects to login when signed out', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test.describe('signed-in flows', () => {
  test.skip(!process.env.E2E_STORAGE_STATE, 'set E2E_STORAGE_STATE to enable');

  test.use({ storageState: process.env.E2E_STORAGE_STATE });

  test('facility manager can open daily update and adjust counts', async ({ page }) => {
    await page.goto('/daily-update');
    await expect(page.getByRole('heading', { name: /daily stock update/i })).toBeVisible();
    // Wait for the first product card to render.
    const firstInput = page.locator('input[type="number"]').first();
    await expect(firstInput).toBeVisible();
    // bump it by one using the plus button
    await page.locator('button:has-text("+")').first().click();
    await expect(page.getByRole('button', { name: /save all changes/i })).toBeEnabled();
  });

  test('dashboard renders inventory snapshot', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /inventory snapshot/i })).toBeVisible();
  });
});
