const BISTRO_ITEM_NAMES = new Set([
  'filter coffee',
  'strong coffee',
  'black coffee',
  'tea',
  'strong tea',
  'black tea',
  'lemon tea',
  'milk',
  'hot chocolate',
  'badam milk',
]);

const CCD_ITEM_NAMES = new Set([
  'coffee (ccd)',
  'ccd coffee',
  'regular coffee',
  'coffee',
  'espresso',
  'americano',
  'cappuccino',
  'latte',
  'assam tea',
  'ginger tea',
  'elaichi tea',
  'green tea',
  'masala chai',
  'chai',
]);

function normalizeItemName(value) {
  return String(value || '')
    .replace(/\s*\[bread:[^\]]*\]/gi, '')
    .trim()
    .toLowerCase();
}

function itemNamesFromOrder(order) {
  return String(order?.raw_text || order?.parsed_item || '')
    .split(',')
    .map((part) => part.replace(/^\s*\d+\s*x\s*/i, ''))
    .map(normalizeItemName)
    .filter(Boolean);
}

export function getReceiptBrands(order) {
  const brands = new Set();
  for (const itemName of itemNamesFromOrder(order)) {
    if (BISTRO_ITEM_NAMES.has(itemName)) brands.add('TATA MY BISTRO');
    if (CCD_ITEM_NAMES.has(itemName) || itemName.includes('ccd')) {
      brands.add('COFFEE CAFE DAY');
    }
  }
  return [...brands];
}

export function receiptBrandLines(order) {
  return getReceiptBrands(order).map((brand) => `Outlet  ${brand}`);
}
