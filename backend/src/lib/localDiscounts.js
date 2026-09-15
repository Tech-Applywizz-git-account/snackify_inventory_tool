import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config/cafeteria-discounts.json');
const filePath = process.env.LOCAL_DISCOUNTS_FILE || defaultFile;

export function useLocalDiscounts() {
  return process.env.USE_LOCAL_DISCOUNTS === 'true' || process.env.NODE_ENV !== 'production';
}

export async function loadLocalDiscounts() {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function saveLocalDiscount(skuCode, policy) {
  const current = await loadLocalDiscounts();
  current[String(skuCode).toUpperCase()] = {
    discount_enabled: Boolean(policy.discount_enabled),
    discount_amount: Number(policy.discount_amount) || 0,
    discount_coins_required: Number(policy.discount_coins_required ?? policy.discount_amount) || 0,
  };
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  return current[String(skuCode).toUpperCase()];
}

export function applyLocalDiscounts(rows, policies) {
  return (rows || []).map((row) => ({
    ...row,
    ...(policies[String(row.sku_code || '').toUpperCase()] || {}),
  }));
}

export function discountPolicyRows(rows, policies) {
  return applyLocalDiscounts(rows, policies).map((row) => ({
    id: row.id,
    sku_code: row.sku_code,
    display_name: row.display_name,
    kind: row.kind,
    tokens: row.tokens,
    active: row.active,
    discount_enabled: Boolean(row.discount_enabled),
    discount_amount: Number(row.discount_amount) || 0,
  }));
}
