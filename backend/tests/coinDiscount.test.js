import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateCoinDiscount } from '../src/lib/tokens.js';

const policy = {
  discount_enabled: true,
  discount_amount: 15,
};

describe('cafeteria coin discount rules', () => {
  it('applies the configured discount to the product token price', () => {
    assert.equal(calculateCoinDiscount({ unitTokens: 50, qty: 1, policy }), 15);
  });

  it('does not apply when the customer opts out', () => {
    assert.equal(calculateCoinDiscount({ unitTokens: 50, qty: 1, policy, applyDiscount: false }), 0);
  });

  it('applies the fixed discount once per unit', () => {
    assert.equal(calculateCoinDiscount({ unitTokens: 20, qty: 3, policy }), 45);
  });

  it('never discounts a disabled policy', () => {
    assert.equal(calculateCoinDiscount({ unitTokens: 50, qty: 1, policy: { ...policy, discount_enabled: false } }), 0);
  });

  it('does not apply when the configured balance threshold is unavailable', () => {
    assert.equal(calculateCoinDiscount({
      unitTokens: 50,
      qty: 1,
      policy: { ...policy, discount_coins_required: 20 },
      discountBudget: 19,
    }), 0);
  });
});