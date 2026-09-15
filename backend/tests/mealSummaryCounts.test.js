import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMealCountSummary } from '../src/routes/meals.js';

describe('buildMealCountSummary()', () => {
  it('separates booked vs skipped counts and keeps extra food types', () => {
    const summary = buildMealCountSummary([
      { choice: 'veg' },
      { choice: 'non_veg' },
      { choice: 'egg' },
      { choice: 'skip' },
      { choice: 'vegan' },
    ]);

    assert.equal(summary.veg, 1);
    assert.equal(summary.non_veg, 1);
    assert.equal(summary.egg, 1);
    assert.equal(summary.skip, 1);
    assert.deepEqual(summary.others, { vegan: 1 });
    assert.equal(summary.booked_count, 4);
    assert.equal(summary.skipped_count, 1);
    assert.equal(summary.total_count, 5);
  });
});
