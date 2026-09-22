import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../config/cafeteria_discounts.json',
);

function normaliseEntry(entry = {}, basePrice = 0) {
  const discountCoins = Math.max(0, Math.min(Number(entry.discount_coins) || 0, basePrice));
  const enabled = entry.enabled === true && discountCoins > 0;
  const effectivePrice = enabled ? basePrice - discountCoins : basePrice;
  return {
    enabled,
    discount_coins: discountCoins,
    discount_percent: basePrice > 0 ? Math.round((discountCoins / basePrice) * 100) : 0,
    effective_token_price: effectivePrice,
  };
}

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.items === 'object' ? parsed : { items: {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { items: {} };
    throw error;
  }
}

async function writeConfig(config) {
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function applyCafeteriaDiscount(item, config = null) {
  const basePrice = Number(item?.token_price ?? item?.coin_price) || 0;
  const settings = config || await readConfig();
  const discount = normaliseEntry(settings.items[String(item?.id)] || {}, basePrice);
  return {
    ...item,
    discount_enabled: discount.enabled,
    discount_coins: discount.discount_coins,
    discount_percent: discount.discount_percent,
    original_token_price: basePrice,
    token_price: discount.effective_token_price,
    coin_price: discount.effective_token_price,
  };
}

export async function applyDiscounts(items, config = null) {
  const settings = config || await readConfig();
  return Promise.all((items || []).map((item) => applyCafeteriaDiscount(item, settings)));
}

export async function getDiscountSettings(items) {
  const settings = await readConfig();
  return applyDiscounts(items, settings);
}

export async function updateDiscount(id, entry, basePrice) {
  const settings = await readConfig();
  const normalized = normaliseEntry(entry, basePrice);
  settings.items[String(id)] = {
    enabled: normalized.enabled,
    discount_coins: normalized.discount_coins,
  };
  await writeConfig(settings);
  return normalized;
}
