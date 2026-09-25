import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasBookedMealForDate } from '../src/routes/mealReviews.js';

function mockSupabase(booking) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: booking, error: null }),
          }),
        }),
      }),
    }),
  };
}

describe('meal review booking gate', () => {
  it('returns false for users without a booked meal for the day', async () => {
    const result = await hasBookedMealForDate('user-1', '2026-09-25', mockSupabase(null));
    assert.equal(result, false);
  });

  it('returns false when the booking is marked as skip', async () => {
    const result = await hasBookedMealForDate('user-2', '2026-09-25', mockSupabase({ choice: 'skip' }));
    assert.equal(result, false);
  });

  it('returns true when the user has a real meal booking for the day', async () => {
    const result = await hasBookedMealForDate('user-3', '2026-09-25', mockSupabase({ choice: 'veg' }));
    assert.equal(result, true);
  });
});
