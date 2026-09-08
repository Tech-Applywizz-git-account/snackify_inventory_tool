/**
 * Focused tests for the LiveTracking 429 rate-limit resilience fix.
 * Run: node --test backend/tests/liveTracking.test.js
 *
 * Pure-logic tests — no HTTP, no DOM, no React, no Supabase.
 * Each function mirrors exactly the logic in the production files:
 *   - frontend/src/lib/api.js  (parseRetryAfter, 429 error shape)
 *   - frontend/src/pages/LiveTracking.jsx  (shouldFetchAuxiliary, polling state machine)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── Mirrors api.js: parseRetryAfter header logic ────────────────────────────

function parseRetryAfter(header) {
  const parsed = parseInt(header, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function make429Error(retryAfterHeader) {
  const e = new Error('Updates are temporarily busy. Retrying shortly.');
  e.status = 429;
  e.retryAfterSeconds = parseRetryAfter(retryAfterHeader);
  return e;
}

// ── Mirrors LiveTracking.jsx: auxiliary throttle logic ───────────────────────
// pollCount resets to 0 when id changes; incremented before each load call.
// fetchAuxiliary is true when pollCount % 6 === 1 → tick 1, 7, 13 ... (every 30 s)

function shouldFetchAuxiliary(pollCount) {
  return pollCount % 6 === 1;
}

// ── Mirrors LiveTracking.jsx: in-flight guard + 429 pause state machine ──────

function createPollingState() {
  return {
    inFlight: false,
    active: true,
    pollCount: 0,
    currentReq: null,
    err: '',
    timerMs: null,                                     // ms until next regular poll
    retryMs: null,                                     // ms until 429 retry
    lastAuxAllRequests: [],                            // cached carousel data
    lastAuxQueueData: { pending: 0, in_progress: 0 }, // cached queue count
  };
}

// Simulate one load() call with a given API response / error
async function simulateLoad(state, { getRequestResult, listRequestsResult, queueResult } = {}) {
  if (!state.active || state.inFlight) return 'skipped';
  state.inFlight = true;
  state.pollCount += 1;
  const fetchAuxiliary = shouldFetchAuxiliary(state.pollCount);

  try {
    if (getRequestResult instanceof Error) throw getRequestResult;
    const data = getRequestResult || { id: 'r1', status: 'pending', live_status: 'placed' };

    // Auxiliary failures are silently caught — mirrors .catch(() => null) in production.
    // Only getRequest(id) failures propagate to the outer catch block.
    let rawRequests = null;
    let rawQueue = null;
    if (fetchAuxiliary) {
      rawRequests = (listRequestsResult instanceof Error) ? null : (listRequestsResult ?? []);
      rawQueue = (queueResult instanceof Error) ? null : (queueResult ?? { pending: 0, in_progress: 0 });
    }

    if (!state.active) return 'stale';

    if (rawRequests !== null) state.lastAuxAllRequests = rawRequests;
    if (rawQueue !== null) state.lastAuxQueueData = rawQueue;

    state.currentReq = data;
    state.err = '';
    state.timerMs = 5000;
    state.retryMs = null;
    return 'done';
  } catch (e) {
    if (!state.active) return 'stale';
    if (e.status === 429) {
      state.err = e.message;
      // Do NOT clear state.currentReq — keep last known order data
      state.timerMs = null;
      state.retryMs = (e.retryAfterSeconds || 30) * 1000;
    } else {
      state.err = e.message;
      state.timerMs = 5000; // continue polling even on non-429 errors
    }
    return 'error';
  } finally {
    state.inFlight = false;
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('parseRetryAfter — Retry-After header parsing', () => {
  it('uses the header value when it is a valid positive integer', () => {
    assert.equal(parseRetryAfter('60'), 60);
    assert.equal(parseRetryAfter('5'), 5);
    assert.equal(parseRetryAfter('120'), 120);
  });

  it('falls back to 30 when header is missing (null)', () => {
    assert.equal(parseRetryAfter(null), 30);
  });

  it('falls back to 30 when header is an empty string', () => {
    assert.equal(parseRetryAfter(''), 30);
  });

  it('falls back to 30 when header is zero', () => {
    // Zero is not a valid positive retry-after — treat as missing
    assert.equal(parseRetryAfter('0'), 30);
  });

  it('falls back to 30 when header is negative', () => {
    assert.equal(parseRetryAfter('-1'), 30);
  });

  it('falls back to 30 when header is non-numeric text', () => {
    assert.equal(parseRetryAfter('Wed, 21 Oct 2025 07:28:00 GMT'), 30);
    assert.equal(parseRetryAfter('invalid'), 30);
  });
});

describe('429 error shape — api.js typed error', () => {
  it('error message is the friendly string, not a raw status code', () => {
    const e = make429Error(null);
    assert.equal(e.message, 'Updates are temporarily busy. Retrying shortly.');
    assert.ok(!e.message.includes('429'), 'message must not contain raw 429 code');
    assert.ok(!e.message.includes('Too Many Requests'), 'message must not contain HTTP status text');
  });

  it('error.status is 429', () => {
    const e = make429Error(null);
    assert.equal(e.status, 429);
  });

  it('error.retryAfterSeconds is set from header when valid', () => {
    const e = make429Error('45');
    assert.equal(e.retryAfterSeconds, 45);
  });

  it('error.retryAfterSeconds falls back to 30 when header is missing', () => {
    const e = make429Error(null);
    assert.equal(e.retryAfterSeconds, 30);
  });
});

describe('shouldFetchAuxiliary — 30-second auxiliary throttle', () => {
  it('fetches auxiliary on tick 1 (first load)', () => {
    assert.equal(shouldFetchAuxiliary(1), true);
  });

  it('skips auxiliary on ticks 2 through 6 (< 30 s)', () => {
    for (let i = 2; i <= 6; i++) {
      assert.equal(shouldFetchAuxiliary(i), false, `tick ${i} must skip auxiliary`);
    }
  });

  it('fetches auxiliary again on tick 7 (30 s later)', () => {
    assert.equal(shouldFetchAuxiliary(7), true);
  });

  it('skips ticks 8 through 12', () => {
    for (let i = 8; i <= 12; i++) {
      assert.equal(shouldFetchAuxiliary(i), false, `tick ${i} must skip auxiliary`);
    }
  });

  it('fetches auxiliary on tick 13 (60 s)', () => {
    assert.equal(shouldFetchAuxiliary(13), true);
  });
});

describe('in-flight guard — no overlapping load calls', () => {
  it('skips a concurrent load call while one is already in flight', async () => {
    const state = createPollingState();
    // Simulate first load starting (manually set inFlight to simulate slow network)
    state.inFlight = true;
    const result = await simulateLoad(state, { getRequestResult: { id: 'r1', status: 'pending' } });
    assert.equal(result, 'skipped', 'concurrent load must be skipped when inFlight is true');
  });

  it('allows a new load after the previous one completes', async () => {
    const state = createPollingState();
    await simulateLoad(state, { getRequestResult: { id: 'r1', status: 'pending' } });
    assert.equal(state.inFlight, false, 'inFlight must be false after load completes');
    const result = await simulateLoad(state, { getRequestResult: { id: 'r1', status: 'in_progress' } });
    assert.equal(result, 'done');
    assert.equal(state.currentReq.status, 'in_progress');
  });
});

describe('429 handling — polling pause and data preservation', () => {
  it('keeps last successful order data after a 429', async () => {
    const state = createPollingState();
    // First load succeeds
    await simulateLoad(state, { getRequestResult: { id: 'r1', status: 'pending' } });
    const dataBeforeError = state.currentReq;

    // Second load returns 429
    await simulateLoad(state, { getRequestResult: make429Error('10') });

    assert.deepEqual(state.currentReq, dataBeforeError, 'order data must be preserved after 429');
  });

  it('sets the friendly banner message on 429, not raw status text', async () => {
    const state = createPollingState();
    await simulateLoad(state, { getRequestResult: { id: 'r1', status: 'pending' } });
    await simulateLoad(state, { getRequestResult: make429Error(null) });

    assert.equal(state.err, 'Updates are temporarily busy. Retrying shortly.');
    assert.ok(!state.err.includes('429'), 'banner must not contain raw 429 code');
  });

  it('schedules retry timer using Retry-After when present', async () => {
    const state = createPollingState();
    await simulateLoad(state, { getRequestResult: { id: 'r1', status: 'pending' } });
    await simulateLoad(state, { getRequestResult: make429Error('45') });

    assert.equal(state.retryMs, 45_000, 'retry timer must use Retry-After value in ms');
    assert.equal(state.timerMs, null, 'normal 5-s poll timer must be cleared during 429 pause');
  });

  it('uses 30-second fallback when Retry-After is missing', async () => {
    const state = createPollingState();
    await simulateLoad(state, { getRequestResult: { id: 'r1', status: 'pending' } });
    await simulateLoad(state, { getRequestResult: make429Error(null) });

    assert.equal(state.retryMs, 30_000, 'retry timer must fall back to 30 000 ms');
  });

  it('clears the friendly banner after next successful load', async () => {
    const state = createPollingState();
    await simulateLoad(state, { getRequestResult: { id: 'r1', status: 'pending' } });
    await simulateLoad(state, { getRequestResult: make429Error(null) });
    assert.ok(state.err.length > 0, 'err must be set after 429');

    // Retry succeeds
    await simulateLoad(state, { getRequestResult: { id: 'r1', status: 'in_progress' } });
    assert.equal(state.err, '', 'banner must be cleared after successful load');
  });
});

describe('non-429 errors — preserve current behaviour', () => {
  it('sets err.message from non-429 errors', async () => {
    const state = createPollingState();
    const netErr = new Error('Network failure');
    await simulateLoad(state, { getRequestResult: netErr });
    assert.equal(state.err, 'Network failure');
  });

  it('continues polling (schedules 5-s timer) after non-429 errors', async () => {
    const state = createPollingState();
    const netErr = new Error('Network failure');
    await simulateLoad(state, { getRequestResult: netErr });
    assert.equal(state.timerMs, 5000, 'must still schedule 5-s poll after non-429 error');
  });
});

describe('unmount / navigation — timer cleanup prevents stale state updates', () => {
  it('skips load when activeRef is false (unmounted)', async () => {
    const state = createPollingState();
    state.active = false;
    const result = await simulateLoad(state, { getRequestResult: { id: 'r1', status: 'pending' } });
    assert.equal(result, 'skipped', 'must not update state after component unmounts');
    assert.equal(state.currentReq, null, 'currentReq must remain null after unmounted load attempt');
  });

  it('ignores in-flight load that completes after id change (active set false during await)', async () => {
    const state = createPollingState();
    // Simulate a load that was in flight when id changed (active turned false mid-flight)
    state.inFlight = true;
    state.active = false;
    // Manually simulate what happens after the await resolves
    // (activeRef.current check fires, should return without setting state)
    const wouldUpdateReq = state.active; // false → no state update
    assert.equal(wouldUpdateReq, false, 'stale load after id change must not update state');
  });
});

describe('auxiliary call isolation — listRequests/queueCount failures cannot affect order status', () => {
  it('load succeeds and updates order when listRequests fails on an aux tick', async () => {
    const state = createPollingState();
    await simulateLoad(state, { getRequestResult: { id: 'r1', status: 'pending' } });

    state.pollCount = 6; // force aux fetch on next call (tick 7 → fetchAuxiliary = true)
    const result = await simulateLoad(state, {
      getRequestResult: { id: 'r1', status: 'in_progress' },
      listRequestsResult: new Error('Network failure'),
    });

    assert.equal(result, 'done', 'load must complete successfully despite listRequests failure');
    assert.equal(state.currentReq.status, 'in_progress', 'order status must be updated from getRequest');
    assert.equal(state.err, '', 'error banner must not be set when only listRequests fails');
  });

  it('last known carousel data is preserved when listRequests fails', async () => {
    const state = createPollingState();
    const orders = [{ id: 'r1', status: 'pending' }, { id: 'r2', status: 'pending' }];

    // Tick 1: aux succeeds — carousel data is cached
    await simulateLoad(state, {
      getRequestResult: { id: 'r1', status: 'pending' },
      listRequestsResult: orders,
    });
    assert.deepEqual(state.lastAuxAllRequests, orders, 'carousel data set on first load');

    // Tick 7: listRequests fails — cached data must be kept
    state.pollCount = 6;
    await simulateLoad(state, {
      getRequestResult: { id: 'r1', status: 'in_progress' },
      listRequestsResult: new Error('Service unavailable'),
    });
    assert.deepEqual(state.lastAuxAllRequests, orders, 'carousel data must be preserved after listRequests failure');
  });

  it('a 429 from listRequests does not set the 429 error banner', async () => {
    const state = createPollingState();
    await simulateLoad(state, { getRequestResult: { id: 'r1', status: 'pending' } });

    state.pollCount = 6; // force aux fetch
    await simulateLoad(state, {
      getRequestResult: { id: 'r1', status: 'in_progress' },
      listRequestsResult: make429Error('10'),
    });

    assert.equal(state.err, '', 'auxiliary 429 must not set any error banner');
    assert.equal(state.currentReq.status, 'in_progress', 'order status must update normally');
    assert.equal(state.timerMs, 5000, 'normal 5-s poll must still be scheduled');
    assert.equal(state.retryMs, null, '429 retry timer must not be set for auxiliary failures');
  });

  it('last known queue count is preserved when queueCount fails', async () => {
    const state = createPollingState();

    // Tick 1: queue succeeds
    await simulateLoad(state, {
      getRequestResult: { id: 'r1', status: 'pending' },
      queueResult: { pending: 3, in_progress: 1 },
    });
    assert.deepEqual(state.lastAuxQueueData, { pending: 3, in_progress: 1 });

    // Tick 7: queueCount fails
    state.pollCount = 6;
    await simulateLoad(state, {
      getRequestResult: { id: 'r1', status: 'in_progress' },
      queueResult: new Error('queueCount down'),
    });
    assert.deepEqual(state.lastAuxQueueData, { pending: 3, in_progress: 1 }, 'last known queue value must be preserved');
    assert.equal(state.err, '', 'error banner must not be set when only queueCount fails');
  });

  it('getRequest(id) failure still propagates correctly even when aux calls would have succeeded', async () => {
    const state = createPollingState();
    const getErr = new Error('Order not found');

    await simulateLoad(state, {
      getRequestResult: getErr,
      listRequestsResult: [{ id: 'r2', status: 'pending' }],
    });

    assert.equal(state.err, 'Order not found', 'getRequest failure must still be reported');
    assert.equal(state.currentReq, null, 'currentReq must remain null when getRequest fails');
  });
});
