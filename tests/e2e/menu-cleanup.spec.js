import { test, expect } from '@playwright/test';

test('unauthenticated request route redirects to login', async ({ page }) => {
  await page.goto('/request');
  await expect(page).toHaveURL(/\/login/);
});

test.describe('signed-in menu verification', () => {
  // Bypassed if storage state is not set, otherwise runs menu classification checks
  test.skip(!process.env.E2E_STORAGE_STATE, 'set E2E_STORAGE_STATE to run authenticated tests');

  test.use({ storageState: process.env.E2E_STORAGE_STATE });

  test('cafeteria categories and items are correctly displayed and separated', async ({ page }) => {
    await page.goto('/request');

    // 1. Verify Category Headers
    await expect(page.getByText(/Caffeine Fix ☕/i)).toBeVisible();
    await expect(page.getByText(/Tea & Sachets 🍵/i)).toBeVisible();
    await expect(page.getByText(/Hot Mixes 🍫/i)).toBeVisible();
    await expect(page.getByText(/Refreshments 💧/i)).toBeVisible();
    await expect(page.getByText(/Food \/ Pantry 🥪/i)).toBeVisible();

    // 2. Verify Coffee Items
    await expect(page.getByText(/Latte/i)).toBeVisible();
    await expect(page.getByText(/Cappuccino/i)).toBeVisible();
    await expect(page.getByText(/Espresso/i)).toBeVisible();
    await expect(page.getByText(/Americano/i)).toBeVisible();

    // 3. Verify Tea Items
    await expect(page.getByText(/Assam Tea/i)).toBeVisible();
    await expect(page.getByText(/Elaichi Tea/i)).toBeVisible();
    await expect(page.getByText(/Ginger Tea/i)).toBeVisible();
    await expect(page.getByText(/Lemon Tea/i)).toBeVisible();

    // 4. Verify no mixed categories (e.g. Jam is under Food/Pantry, not beverages)
    const foodSection = page.locator('div:has-text("Food / Pantry")');
    await expect(foodSection.getByText(/Jam/i)).toBeVisible();
  });
});
