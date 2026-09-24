import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getReceiptBrands, receiptBrandLines } from './receiptBrand.js';

describe('receipt brand detection', () => {
  it('identifies Coffee Cafe Day orders', () => {
    assert.deepEqual(getReceiptBrands({ raw_text: '1x Coffee (CCD)' }), ['COFFEE CAFE DAY']);
  });

  it('identifies TATA My Bistro orders', () => {
    assert.deepEqual(getReceiptBrands({ raw_text: '2x Filter Coffee, 1x Strong Tea' }), ['TATA MY BISTRO']);
  });

  it('prints both outlet labels for a mixed order', () => {
    assert.deepEqual(
      receiptBrandLines({ raw_text: '1x Coffee (CCD), 1x Filter Coffee' }),
      ['Outlet  COFFEE CAFE DAY', 'Outlet  TATA MY BISTRO']
    );
  });

  it('does not label unrelated pantry orders', () => {
    assert.deepEqual(getReceiptBrands({ raw_text: '1x Bread' }), []);
  });
});
