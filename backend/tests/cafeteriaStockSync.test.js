import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { syncCafeteriaStockFields } from '../src/routes/cafeteria.js';

describe('syncCafeteriaStockFields()', () => {
  it('keeps stock_today and stock_servings in sync when toggling out of stock', () => {
    const result = syncCafeteriaStockFields({ stock_today: 0 });
    assert.equal(result.stock_today, 0);
    assert.equal(result.stock_servings, 0);
  });

  it('keeps both fields null together when restoring availability', () => {
    const result = syncCafeteriaStockFields({ stock_servings: null });
    assert.equal(result.stock_today, null);
    assert.equal(result.stock_servings, null);
  });
});
