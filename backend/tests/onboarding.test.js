/**
 * Focused regression tests for the snack-selection mutual exclusivity fix.
 * Run: node --test backend/tests/onboarding.test.js
 *
 * Pure-logic tests — no React, no DOM, no Supabase.
 * Each helper mirrors the exact logic added to Onboarding.jsx:
 *   - toggleSnack()  →  the new dedicated snack handler
 *   - normalizeSnackPrefs()  →  the defensive save normalization in finish()
 *
 * Business rule: 'none' (No Snacks) is mutually exclusive with all real snacks.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Mirrors toggleSnack() in Onboarding.jsx
function toggleSnack(snacks, value) {
  if (value === 'none') {
    return snacks.includes('none') ? [] : ['none'];
  }
  const base = snacks.filter((s) => s !== 'none');
  return base.includes(value) ? base.filter((s) => s !== value) : [...base, value];
}

// Mirrors the defensive normalization in finish():
//   prefs.snacks.includes('none') ? [] : prefs.snacks
function normalizeSnackPrefs(snacks) {
  return snacks.includes('none') ? [] : snacks;
}

describe('toggleSnack — No Snacks mutual exclusivity', () => {
  it('selecting No Snacks after multiple real snacks clears them all', () => {
    let snacks = [];
    snacks = toggleSnack(snacks, 'Bread + Peanut Butter');
    snacks = toggleSnack(snacks, 'Biscuits');
    assert.deepEqual(snacks, ['Bread + Peanut Butter', 'Biscuits']);

    snacks = toggleSnack(snacks, 'none');
    assert.deepEqual(snacks, ['none'], 'No Snacks must replace all real snacks');
  });

  it('selecting a real snack after No Snacks removes none and adds the snack', () => {
    let snacks = ['none'];
    snacks = toggleSnack(snacks, 'Biscuits');
    assert.deepEqual(snacks, ['Biscuits'], 'none must be removed when a real snack is selected');
  });

  it('multiple real snacks can be selected together', () => {
    let snacks = [];
    snacks = toggleSnack(snacks, 'Bread + Peanut Butter');
    snacks = toggleSnack(snacks, 'Bread + Jam');
    snacks = toggleSnack(snacks, 'Biscuits');
    assert.deepEqual(snacks, ['Bread + Peanut Butter', 'Bread + Jam', 'Biscuits']);
    assert.ok(!snacks.includes('none'), 'none must not appear when real snacks are selected');
  });

  it('clicking selected No Snacks again clears the selection', () => {
    let snacks = ['none'];
    snacks = toggleSnack(snacks, 'none');
    assert.deepEqual(snacks, [], 'clicking No Snacks a second time must clear it');
  });

  it('deselecting the only real snack leaves an empty list', () => {
    let snacks = ['Biscuits'];
    snacks = toggleSnack(snacks, 'Biscuits');
    assert.deepEqual(snacks, []);
  });

  it('real snack added after No Snacks does not retain none in the array', () => {
    let snacks = ['none'];
    snacks = toggleSnack(snacks, 'Bread + Jam');
    assert.ok(!snacks.includes('none'));
    assert.ok(snacks.includes('Bread + Jam'));
  });

  it('toggling the same real snack twice returns to empty', () => {
    let snacks = [];
    snacks = toggleSnack(snacks, 'Bread + Peanut Butter');
    snacks = toggleSnack(snacks, 'Bread + Peanut Butter');
    assert.deepEqual(snacks, []);
  });
});

describe('normalizeSnackPrefs — finish() defensive save guard', () => {
  it('saves empty array when none is the only element', () => {
    assert.deepEqual(normalizeSnackPrefs(['none']), []);
  });

  it('saves empty array when none coexists with real snacks (conflict state)', () => {
    // This state cannot occur in normal UI flow after the fix, but guards against
    // any legacy data or edge case reaching finish().
    assert.deepEqual(normalizeSnackPrefs(['none', 'Biscuits']), []);
    assert.deepEqual(normalizeSnackPrefs(['none', 'Bread + Peanut Butter', 'Bread + Jam']), []);
  });

  it('saves real snacks unchanged when none is absent', () => {
    assert.deepEqual(
      normalizeSnackPrefs(['Bread + Peanut Butter', 'Biscuits']),
      ['Bread + Peanut Butter', 'Biscuits'],
    );
  });

  it('saves empty array unchanged (no preferences set)', () => {
    assert.deepEqual(normalizeSnackPrefs([]), []);
  });

  it('persistence payload never contains none alongside real snacks', () => {
    const conflicting = ['none', 'Biscuits'];
    const saved = normalizeSnackPrefs(conflicting);
    assert.ok(!saved.includes('none'), 'none must not appear in saved payload');
    assert.ok(
      !saved.some((s) => s !== 'none'),
      'real snacks must not appear when none was present',
    );
  });
});
