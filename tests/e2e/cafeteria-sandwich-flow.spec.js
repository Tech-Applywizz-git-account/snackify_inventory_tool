import { test, expect } from '@playwright/test';

const USER_ID = 'cafeteria-sandwich-user-001';

function mockJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.test-signature`;
}

async function loginAsStaff(page) {
  const tokenKeys = ['sb-twmadauhauuypioznpus-auth-token', 'sb-localhost-auth-token'];
  const session = {
    access_token: mockJwt({
      aal: 'aal2',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: USER_ID,
      email: 'sandwich.flow@applywizz.ai',
      role: 'authenticated',
    }),
    refresh_token: 'test-refresh-token',
    user: {
      id: USER_ID,
      email: 'sandwich.flow@applywizz.ai',
      aud: 'authenticated',
      role: 'authenticated',
      user_metadata: { full_name: 'Sandwich Flow' },
    },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };

  await page.addInitScript(
    ({ keys, value }) => {
      for (const key of keys) window.localStorage.setItem(key, JSON.stringify(value));
    },
    { keys: tokenKeys, value: session },
  );

  await page.route('**/auth/v1/user', route => route.fulfill({ json: session.user }));
  await page.route('**/auth/v1/factors', route => route.fulfill({ json: { all: [], active: [] } }));
  await page.route('**/rest/v1/profiles**', route => route.fulfill({
    json: {
      id: USER_ID,
      full_name: 'Sandwich Flow',
      preferred_name: 'Sandwich',
      role: 'staff',
      email: 'sandwich.flow@applywizz.ai',
      active: true,
    },
  }));
  await page.route('**/rest/v1/employee_cafeteria_preferences**', route => route.fulfill({
    json: {
      user_id: USER_ID,
      onboarding_completed: true,
      preferred_location: 'Tech Team',
      shift: 'morning',
      notification_tone: 'Friendly',
      item_prefs: {},
      drink_prefs: [],
      taste_prefs: [],
    },
  }));
}

function baseItems(overrides = {}) {
  return [
    {
      id: 'pb-001',
      item_name: 'Veeba - Peanut Butter (Creamy), 900 gm',
      display_name: 'Veeba - Peanut Butter',
      frontend_name: null,
      category: 'food',
      emoji: '🥜',
      description: '',
      tags: [],
      available: true,
      orderable: true,
      stock_today: 1,
      stock_servings: 10,
      dependencies: [],
      sides_option: false,
      sandwich_type: 'regular',
    },
    {
      id: 'bread-atta',
      item_name: 'MDRN AT SHK BRD400G',
      display_name: 'Atta Bread',
      frontend_name: 'Atta Bread',
      category: 'food',
      emoji: '🍞',
      description: '',
      tags: ['bread'],
      available: true,
      orderable: false,
      stock_today: 1,
      stock_servings: 8,
      dependencies: [],
      sides_option: false,
      sandwich_type: 'regular',
    },
    {
      id: 'bread-milk',
      item_name: 'Bread',
      display_name: 'Milk Bread',
      frontend_name: 'Milk Bread',
      category: 'food',
      emoji: '🍞',
      description: '',
      tags: ['bread'],
      available: true,
      orderable: false,
      stock_today: 1,
      stock_servings: 8,
      dependencies: [],
      sides_option: false,
      sandwich_type: 'regular',
    },
  ].map(item => ({ ...item, ...(overrides[item.id] || {}) }));
}

async function mockCafeteriaApis(page, items, onPostRequest = null) {
  await page.route('**/sw.js', route => route.abort());
  await page.route('**/api/cafeteria/items', route => route.fulfill({ json: items }));
  await page.route('**/api/cafeteria/self-pickup-status', route => route.fulfill({ json: { is_self_pickup_day: false } }));
  await page.route('**/api/requests/queue-count', route => route.fulfill({ json: { pending: 0, in_progress: 0 } }));
  await page.route(/\/api\/requests($|\?)/, async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      onPostRequest?.(body);
      return route.fulfill({
        status: 201,
        json: {
          request: {
            id: 'request-sandwich-001',
            parsed_item: body.quick_item,
            raw_text: `1x ${body.quick_item}`,
            status: 'confirming',
            live_status: 'confirming',
          },
        },
      });
    }
    return route.fulfill({ json: [] });
  });
  await loginAsStaff(page);
}

test.describe('cafeteria sandwich spread flow', () => {
  test('Peanut Butter Sandwich requires bread and submits selected bread/spread instruction', async ({ page }) => {
    let submittedBody = null;
    await mockCafeteriaApis(page, baseItems(), body => { submittedBody = body; });

    await page.goto('/request');

    await expect(page.getByText('Peanut Butter Sandwich')).toBeVisible();
    await page.getByText('Peanut Butter Sandwich').click();

    await expect(page.getByText('🍞 Choose bread')).toBeVisible();
    await expect(page.getByText('Spread on one slice')).toBeVisible();
    await expect(page.getByText('Spread on both slices')).toBeVisible();

    await page.getByText('Atta Bread').click();
    await page.getByText('Spread on both slices').click();
    await page.getByRole('button', { name: /add to order/i }).click();

    await page.getByRole('button', { name: /review order/i }).click();
    await expect(page.getByText('Spread on both slices, Atta Bread. Uses 2 bread slices')).toBeVisible();
    await page.getByRole('button', { name: /place order/i }).click();

    await expect.poll(() => submittedBody).toMatchObject({
      quick_item: 'Peanut Butter Sandwich',
      quick_bread_type: 'MDRN AT SHK BRD400G',
    });
    expect(submittedBody.quick_instruction).toContain('Spread on both slices');
    expect(submittedBody.quick_instruction).toContain('Uses 2 bread slices');
  });

  test('Mix Fruit Jam Sandwich stays visible but disabled when bread is out of stock', async ({ page }) => {
    const items = baseItems({
      'bread-atta': { stock_today: 0, stock_servings: 0 },
      'bread-milk': { stock_today: 0, stock_servings: 0 },
    });
    await mockCafeteriaApis(page, items);

    await page.goto('/request');

    await expect(page.getByText('Mix Fruit Jam Sandwich')).toBeVisible();
    await expect(page.getByText('Out of stock').first()).toBeVisible();
    await page.getByText('Mix Fruit Jam Sandwich').click();
    await expect(page.getByText('Choose bread')).not.toBeVisible();
  });

  test('hides internal items, keeps water visible, and deduplicates repeated item ids', async ({ page }) => {
    const items = [
      ...baseItems(),
      {
        id: 'jam-dup-001',
        item_name: 'Mix Fruit Jam Sandwich',
        display_name: 'Mix Fruit Jam Sandwich',
        frontend_name: 'Mix Fruit Jam Sandwich',
        category: 'food',
        emoji: '🍓',
        description: 'Choose bread and spread on one or both slices',
        tags: ['sandwich', 'spread'],
        available: true,
        orderable: true,
        stock_today: 1,
        stock_servings: 6,
        dependencies: ['Bread'],
        sides_option: true,
        sandwich_type: 'mix_fruit_jam',
      },
      {
        id: 'jam-dup-001',
        item_name: 'Mix Fruit Jam Sandwich',
        display_name: 'Mix Fruit Jam Sandwich',
        frontend_name: 'Mix Fruit Jam Sandwich',
        category: 'food',
        emoji: '🍓',
        description: 'Choose bread and spread on one or both slices',
        tags: ['sandwich', 'spread'],
        available: true,
        orderable: true,
        stock_today: 1,
        stock_servings: 6,
        dependencies: ['Bread'],
        sides_option: true,
        sandwich_type: 'mix_fruit_jam',
      },
      {
        id: 'water-001',
        item_name: 'Water',
        display_name: 'Water',
        frontend_name: 'Water',
        category: 'refreshment',
        emoji: '💧',
        description: '',
        tags: [],
        available: true,
        orderable: true,
        stock_today: null,
        stock_servings: null,
        dependencies: [],
        sides_option: false,
      },
      {
        id: 'internal-001',
        item_name: 'Monthly rental chargers for May',
        display_name: 'Monthly rental chargers for May',
        frontend_name: 'Monthly rental chargers for May',
        category: 'food',
        emoji: '🔌',
        description: '',
        tags: ['asset'],
        available: true,
        orderable: true,
        stock_today: 1,
        stock_servings: 1,
        dependencies: [],
        sides_option: false,
      },
      {
        id: 'accessory-001',
        item_name: 'Coffee Stirrers',
        display_name: 'Coffee Stirrers',
        frontend_name: 'Coffee Stirrers',
        category: 'food',
        emoji: '🥄',
        description: '',
        tags: ['accessory'],
        available: true,
        orderable: true,
        stock_today: 1,
        stock_servings: 20,
        dependencies: [],
        sides_option: false,
      },
    ];
    await mockCafeteriaApis(page, items);

    await page.goto('/request');

    await expect(page.getByText('Water')).toBeVisible();
    await expect(page.getByText('Monthly rental chargers for May')).toHaveCount(0);
    await expect(page.getByText('Coffee Stirrers')).toHaveCount(0);
    await expect(page.getByText(/Accessories/i)).toHaveCount(0);
    await expect(page.getByText('Mix Fruit Jam Sandwich')).toHaveCount(1);
  });
});
