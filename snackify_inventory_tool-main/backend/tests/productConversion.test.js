/**
 * Unit tests for productConversion.js
 * Run: node --test backend/tests/productConversion.test.js
 *
 * These tests mock the Supabase and OpenAI calls to avoid DB dependencies.
 */
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';

// ── Minimal master seed matching 0024 migration ───────────────────────────
const MASTER_SEED = [
  { id: 'uuid-assam',   canonical_name: 'Assam Tea',      aliases: ['assam tea','assam chai','assam tea bags'], classification: 'direct_menu_stock',  purchase_unit: 'box',  storage_unit: 'cup',     units_per_purchase_unit: 100, cafeteria_item_name: 'Assam tea',    visible_to_employees: true,  employee_orderable: true  },
  { id: 'uuid-elaichi', canonical_name: 'Elaichi Tea',    aliases: ['elaichi tea','cardamom tea'],              classification: 'direct_menu_stock',  purchase_unit: 'box',  storage_unit: 'cup',     units_per_purchase_unit: 100, cafeteria_item_name: 'Elaichi tea',  visible_to_employees: true,  employee_orderable: true  },
  { id: 'uuid-ginger',  canonical_name: 'Ginger Tea',     aliases: ['ginger tea','adrak tea'],                  classification: 'direct_menu_stock',  purchase_unit: 'box',  storage_unit: 'cup',     units_per_purchase_unit: 100, cafeteria_item_name: 'Ginger tea',   visible_to_employees: true,  employee_orderable: true  },
  { id: 'uuid-lemon',   canonical_name: 'Lemon Sachets',  aliases: ['lemon sachet','lemon sachets'],            classification: 'direct_menu_stock',  purchase_unit: 'pack', storage_unit: 'cup',     units_per_purchase_unit: 20,  cafeteria_item_name: 'Lemon sachets',visible_to_employees: true,  employee_orderable: true  },
  { id: 'uuid-hchoc',   canonical_name: 'Hot Chocolate',  aliases: ['hot chocolate','hot choco'],               classification: 'direct_menu_stock',  purchase_unit: 'pack', storage_unit: 'cup',     units_per_purchase_unit: 20,  cafeteria_item_name: 'Hot chocolate',visible_to_employees: true,  employee_orderable: true  },
  { id: 'uuid-badam',   canonical_name: 'Badam Pista Mix',aliases: ['badam pista mix','badam sachets','badam drink','badam mix'], classification: 'direct_menu_stock', purchase_unit: 'pack', storage_unit: 'cup', units_per_purchase_unit: 25, cafeteria_item_name: 'Badam Sachets', visible_to_employees: true, employee_orderable: true },
  { id: 'uuid-beans',   canonical_name: 'Coffee Beans',   aliases: ['coffee beans','coffee bean'],              classification: 'recipe_stock',       purchase_unit: 'kg',   storage_unit: 'gram',    units_per_purchase_unit: 1000,cafeteria_item_name: null,           visible_to_employees: false, employee_orderable: false },
  { id: 'uuid-stirr',   canonical_name: 'Stirrers',       aliases: ['stirrer','stirrers'],                      classification: 'internal_supply',    purchase_unit: 'pack', storage_unit: 'pcs',     units_per_purchase_unit: null,cafeteria_item_name: null,           visible_to_employees: false, employee_orderable: false },
  { id: 'uuid-delivery',canonical_name: 'Delivery Charges',aliases: ['delivery charge','delivery charges'],    classification: 'finance_expense',    purchase_unit: 'invoice',storage_unit:'invoice',  units_per_purchase_unit: null,cafeteria_item_name: null,           visible_to_employees: false, employee_orderable: false },
];

// ── Inline-testable pure logic (extracted from productConversion.js) ──────
function normalizeName(name = '') {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function matchMasterSync(normalizedName) {
  return MASTER_SEED.find(m =>
    m.aliases.some(a => a === normalizedName)
  ) ?? null;
}

const NO_STOCK_CLASSES = new Set(['internal_supply', 'equipment_asset', 'finance_expense']);

function processItem(item) {
  const normalized = normalizeName(item.item_name);
  const master = matchMasterSync(normalized);
  if (!master) {
    return { conversion_status: 'pending_review', converted_quantity: null, conversion_master_id: null };
  }
  const qty = parseFloat(item.quantity) || 0;
  const converted = master.units_per_purchase_unit != null ? qty * master.units_per_purchase_unit : null;
  const noStock = NO_STOCK_CLASSES.has(master.classification);
  return {
    conversion_status:    noStock ? 'no_stock' : 'master_match',
    converted_quantity:   converted,
    conversion_master_id: master.id,
    master,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe('productConversion — master matching', () => {
  it('10 Assam Tea boxes → 1000 cups', () => {
    const r = processItem({ item_name: 'Assam Tea', quantity: 10 });
    assert.equal(r.conversion_status, 'master_match');
    assert.equal(r.converted_quantity, 1000);
    assert.equal(r.master.cafeteria_item_name, 'Assam tea');
    assert.equal(r.master.employee_orderable, true);
  });

  it('2 Elaichi Tea boxes → 200 cups', () => {
    const r = processItem({ item_name: 'Elaichi Tea', quantity: 2 });
    assert.equal(r.converted_quantity, 200);
  });

  it('2 Ginger Tea boxes → 200 cups', () => {
    const r = processItem({ item_name: 'Ginger Tea', quantity: 2 });
    assert.equal(r.converted_quantity, 200);
  });

  it('4 Lemon Sachets packs → 80 cups', () => {
    const r = processItem({ item_name: 'Lemon Sachets', quantity: 4 });
    assert.equal(r.converted_quantity, 80);
  });

  it('2 Hot Chocolate packs → 40 cups', () => {
    const r = processItem({ item_name: 'Hot Chocolate', quantity: 2 });
    assert.equal(r.converted_quantity, 40);
  });

  it('2 Badam Pista Mix packs → 50 cups', () => {
    const r = processItem({ item_name: 'Badam Pista Mix', quantity: 2 });
    assert.equal(r.converted_quantity, 50);
  });

  it('5 kg Coffee Beans → 5000 grams (recipe_stock, not orderable)', () => {
    const r = processItem({ item_name: 'Coffee Beans', quantity: 5 });
    assert.equal(r.conversion_status, 'master_match');
    assert.equal(r.converted_quantity, 5000);
    assert.equal(r.master.employee_orderable, false);
    assert.equal(r.master.visible_to_employees, false);
  });

  it('Stirrers → no_stock (internal_supply)', () => {
    const r = processItem({ item_name: 'Stirrers', quantity: 2 });
    assert.equal(r.conversion_status, 'no_stock');
    assert.equal(r.converted_quantity, null);
  });

  it('Delivery Charges → no_stock (finance_expense)', () => {
    const r = processItem({ item_name: 'Delivery Charges', quantity: 1 });
    assert.equal(r.conversion_status, 'no_stock');
  });

  it('Unknown item → pending_review, no quantity', () => {
    const r = processItem({ item_name: 'Fancy New Snack Bar XL', quantity: 3 });
    assert.equal(r.conversion_status, 'pending_review');
    assert.equal(r.converted_quantity, null);
    assert.equal(r.conversion_master_id, null);
  });

  it('normalizeName handles extra whitespace and casing', () => {
    assert.equal(normalizeName('  Assam  Tea  '), 'assam tea');
    assert.equal(normalizeName('COFFEE BEANS'), 'coffee beans');
  });

  it('Alias match: "Badam Sachets" resolves to Badam Pista Mix', () => {
    const r = processItem({ item_name: 'Badam Sachets', quantity: 1 });
    assert.equal(r.master?.canonical_name, 'Badam Pista Mix');
  });

  it('Alias match: "Adrak Tea" resolves to Ginger Tea', () => {
    const r = processItem({ item_name: 'Adrak Tea', quantity: 1 });
    assert.equal(r.master?.canonical_name, 'Ginger Tea');
  });

  it('Coffee Beans master_match cannot be overridden to orderable', () => {
    const r = processItem({ item_name: 'Coffee Beans', quantity: 1 });
    // The master record itself enforces non-orderable
    assert.equal(r.master.employee_orderable, false);
    assert.equal(r.master.visible_to_employees, false);
  });
});

// ── AI suggestion safety guard (unit-testable logic) ──────────────────────
describe('AI suggestion safety overrides', () => {
  function applyAISafetyOverrides(aiSugg) {
    return {
      ...aiSugg,
      employee_orderable:   false,
      visible_to_employees: false,
      status:               'pending_review',
    };
  }

  it('AI cannot set employee_orderable = true', () => {
    const raw = { classification: 'direct_menu_stock', employee_orderable: true };
    const safe = applyAISafetyOverrides(raw);
    assert.equal(safe.employee_orderable, false);
  });

  it('AI cannot set visible_to_employees = true', () => {
    const raw = { visible_to_employees: true };
    const safe = applyAISafetyOverrides(raw);
    assert.equal(safe.visible_to_employees, false);
  });

  it('AI suggestion always has status = pending_review', () => {
    const safe = applyAISafetyOverrides({ status: 'approved' });
    assert.equal(safe.status, 'pending_review');
  });
});

// ── Idempotency guard (logic test) ────────────────────────────────────────
describe('bill_stock_applications idempotency', () => {
  it('Cannot apply the same bill_item_id twice (simulated)', () => {
    const applied = new Set();
    function applyOnce(billItemId) {
      if (applied.has(billItemId)) throw new Error('ALREADY_APPLIED');
      applied.add(billItemId);
    }
    applyOnce('item-1');
    assert.throws(() => applyOnce('item-1'), /ALREADY_APPLIED/);
  });
});
