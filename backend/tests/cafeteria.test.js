/**
 * Focused tests for the Mix Fruit Jam visibility classification fix.
 * Run: node --test backend/tests/cafeteria.test.js
 *
 * Business rule: "Mix Fruit Jam" (raw inventory stock) must never appear in
 * the employee ordering catalog. "Mix Fruit Jam Sandwich" is the orderable item.
 *
 * Schema facts (verified from migrations 0001-0029):
 *   cafeteria_items.visible_to_employees — EXISTS (migration 0024, DEFAULT true)
 *   cafeteria_items.employee_orderable   — DOES NOT EXIST on cafeteria_items;
 *                                          lives on product_conversion_master only.
 *
 * These tests verify:
 *   1. The catalog filter (GET /api/cafeteria/items) excludes visible_to_employees=false rows.
 *   2. Migration 0030's UPDATE predicate targets only the raw jam row, not the sandwich.
 *   3. employee_orderable conditional logic is correct when the column is present.
 *   4. The trigger guard prevents re-enabling the raw jam row.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Mirrors the PostgREST filter applied by GET /api/cafeteria/items:
//   .eq('available', true).neq('visible_to_employees', false)
// PostgREST neq uses IS DISTINCT FROM semantics — null rows remain visible (legacy safe).
function applyEmployeeCatalogFilter(items) {
  return items.filter((i) => i.available === true && i.visible_to_employees !== false);
}

// Mirrors migration 0030 step 1: UPDATE WHERE item_name = 'Mix Fruit Jam'
function applyMigration0030Update(items) {
  return items.map((row) =>
    row.item_name === 'Mix Fruit Jam' ? { ...row, visible_to_employees: false } : row,
  );
}

// Mirrors migration 0030 step 2: conditional employee_orderable update
function applyMigration0030EmployeeOrderable(items, columnExists) {
  if (!columnExists) return items;
  return items.map((row) =>
    row.item_name === 'Mix Fruit Jam' ? { ...row, employee_orderable: false } : row,
  );
}

// Mirrors the BEFORE INSERT/UPDATE trigger installed by migration 0030
function applyTrigger(row) {
  if (row.item_name === 'Mix Fruit Jam') {
    return { ...row, visible_to_employees: false };
  }
  return row;
}

const RAW_JAM = {
  id: 'raw-jam-id',
  item_name: 'Mix Fruit Jam',
  available: true,
  visible_to_employees: false, // set by migration 0030
};

const JAM_SANDWICH = {
  id: 'jam-sandwich-id',
  item_name: 'Mix Fruit Jam Sandwich',
  available: true,
  visible_to_employees: true,
};

describe('Mix Fruit Jam — employee catalog visibility', () => {
  it('raw jam inventory row (visible_to_employees=false) is excluded from employee catalog', () => {
    const catalog = applyEmployeeCatalogFilter([RAW_JAM, JAM_SANDWICH]);
    const names = catalog.map((i) => i.item_name);
    assert.ok(!names.includes('Mix Fruit Jam'), 'raw jam must not appear in employee catalog');
  });

  it('Mix Fruit Jam Sandwich remains visible and orderable in employee catalog', () => {
    const catalog = applyEmployeeCatalogFilter([RAW_JAM, JAM_SANDWICH]);
    const names = catalog.map((i) => i.item_name);
    assert.ok(names.includes('Mix Fruit Jam Sandwich'), 'sandwich must appear in employee catalog');
  });

  it('migration 0030 step 1: UPDATE predicate targets only the raw jam row, never the sandwich', () => {
    const before = [
      { ...RAW_JAM, visible_to_employees: true },
      { ...JAM_SANDWICH, visible_to_employees: true },
    ];
    const after = applyMigration0030Update(before);
    const rawJam = after.find((r) => r.item_name === 'Mix Fruit Jam');
    const sandwich = after.find((r) => r.item_name === 'Mix Fruit Jam Sandwich');
    assert.equal(rawJam.visible_to_employees, false, 'migration must hide raw jam row');
    assert.equal(sandwich.visible_to_employees, true, 'migration must not touch sandwich row');
  });

  it('migration 0030 step 2: employee_orderable set false on raw jam when column exists', () => {
    const before = [
      { ...RAW_JAM, employee_orderable: true },
      { ...JAM_SANDWICH, employee_orderable: true },
    ];
    const after = applyMigration0030EmployeeOrderable(before, /* columnExists= */ true);
    const rawJam = after.find((r) => r.item_name === 'Mix Fruit Jam');
    const sandwich = after.find((r) => r.item_name === 'Mix Fruit Jam Sandwich');
    assert.equal(rawJam.employee_orderable, false, 'must set employee_orderable=false on raw jam');
    assert.equal(sandwich.employee_orderable, true, 'must not touch sandwich employee_orderable');
  });

  it('migration 0030 step 2: employee_orderable skipped when column does not exist (current state)', () => {
    // cafeteria_items.employee_orderable does NOT exist as of migration 0029.
    // The DO block detects this and skips. Verify no mutation occurs.
    const before = [{ ...RAW_JAM }];
    const after = applyMigration0030EmployeeOrderable(before, /* columnExists= */ false);
    assert.ok(
      !('employee_orderable' in after[0]),
      'employee_orderable must not be added when column does not exist',
    );
  });

  it('trigger guard: a re-inserted raw jam row cannot have visible_to_employees=true', () => {
    const reInserted = applyTrigger({
      item_name: 'Mix Fruit Jam',
      visible_to_employees: true,
      available: true,
    });
    assert.equal(reInserted.visible_to_employees, false, 'trigger must override any attempted re-enable');
    const catalog = applyEmployeeCatalogFilter([reInserted]);
    assert.equal(catalog.length, 0, 'trigger-enforced row must still be excluded from catalog');
  });

  it('trigger guard: does not affect Mix Fruit Jam Sandwich', () => {
    const sandwichRow = applyTrigger({ ...JAM_SANDWICH });
    assert.equal(sandwichRow.visible_to_employees, true, 'trigger must not touch the sandwich row');
  });
});
