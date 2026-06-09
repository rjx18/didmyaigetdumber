'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  aggregateModelLogs,
  aggregateRootLogs,
  currentRateLimits,
  deriveMetricSlice,
  estimateWindow,
  modelCoverage,
} = require('../src/metrics');
const { createDailyLog, emptyModelSlice } = require('../src/log-store');

// harn:assume metric-aggregation-core ref=aggregation-tests
test('aggregates raw slices before deriving rates and timings', () => {
  const first = createDailyLog('2026-06-01');
  Object.assign(first.totals, { turns: 3, user_messages: 8, assistant_messages: 2 });
  Object.assign(first.matches.user_1pt, { events: 2 });
  Object.assign(first.tokens, { input: 100, cache_read: 100, output: 20, total: 120 });
  Object.assign(first.timings_ms, { turn_sum: 3000, turn_count: 3 });
  first.by_model.known = emptyModelSlice();
  first.by_model.known.totals.turns = 3;
  first.by_model.known.tokens.total = 100;

  const second = createDailyLog('2026-06-02');
  Object.assign(second.totals, { turns: 1, user_messages: 1, assistant_messages: 1 });
  Object.assign(second.matches.user_1pt, { events: 1 });
  Object.assign(second.matches.assistant_1pt, { events: 1 });
  Object.assign(second.tokens, { input: 100, output: 20, total: 80 });
  Object.assign(second.timings_ms, { turn_sum: 3000, turn_count: 1 });
  second.by_model.unknown = emptyModelSlice();
  second.by_model.unknown.totals.turns = 1;
  second.by_model.unknown.tokens.total = 50;

  const aggregate = aggregateRootLogs([first, second]);
  const derived = deriveMetricSlice(aggregate);

  assert.equal(derived.friction.total, 0.3333);
  assert.equal(derived.friction.numerator, 4);
  assert.equal(derived.friction.denominator, 12);
  assert.equal(derived.cache_ratio, 0.3333);
  assert.equal(derived.timings_ms.avg_turn, 1500);
  assert.equal(aggregateModelLogs([first, second], 'known').totals.turns, 3);
  assert.deepEqual(modelCoverage([first, second]), {
    turns: 0.75,
    tokens: 0.5,
    known_turns: 3,
    unknown_turns: 1,
    known_tokens: 100,
    unknown_tokens: 50,
  });
});
// harn:end metric-aggregation-core

// harn:assume rate-limit-local-estimates ref=rate-limit-tests
test('sums concurrent local session deltas and derives both rate-limit ETAs', () => {
  const reset = '2026-06-09T05:00:00.000Z';
  const windows = [
    { kind: '5h', sampled_at: '2026-06-09T01:00:00.000Z', resets_at: reset, used_percent: 10, observed_tokens_delta: 100 },
    { kind: '5h', sampled_at: '2026-06-09T01:00:00.000Z', resets_at: reset, used_percent: 10, observed_tokens_delta: 200 },
    { kind: '5h', sampled_at: '2026-06-09T02:00:00.000Z', resets_at: reset, used_percent: 20, observed_tokens_delta: 100 },
    { kind: '5h', sampled_at: '2026-06-09T02:00:00.000Z', resets_at: reset, used_percent: 20, observed_tokens_delta: 100 },
  ];

  const limits = currentRateLimits(windows, { now: new Date('2026-06-09T02:00:00.000Z') });

  assert.equal(limits.fiveHour.localTokensObserved, 500);
  assert.equal(limits.fiveHour.localTokenBurnPerHour, 200);
  assert.equal(limits.fiveHour.localAllowanceEstimate, 2500);
  assert.equal(limits.fiveHour.localAllowanceEstimateRolling, 2500);
  assert.equal(limits.fiveHour.localTimeToExhaustHrs, 10);
  assert.equal(limits.fiveHour.burnPctPointsPerHour, 10);
  assert.equal(limits.fiveHour.percentTimeToExhaustHrs, 8);
  assert.equal(limits.fiveHour.timeToResetHrs, 3);
  assert.equal(limits.fiveHour.resetsFirst, true);
});

test('leaves unavailable local estimates and non-positive percentage slopes null', () => {
  const estimate = estimateWindow([
    { kind: '5h', sampled_at: '2026-06-09T01:00:00.000Z', resets_at: '2026-06-09T05:00:00.000Z', used_percent: 30, tokens_in_window: 100 },
    { kind: '5h', sampled_at: '2026-06-09T02:00:00.000Z', resets_at: '2026-06-09T05:00:00.000Z', used_percent: 20, tokens_in_window: 200 },
  ], new Date('2026-06-09T02:00:00.000Z'));

  assert.equal(estimate.localTokensObserved, 0);
  assert.equal(estimate.localAllowanceEstimate, null);
  assert.equal(estimate.localTimeToExhaustHrs, null);
  assert.equal(estimate.burnPctPointsPerHour, null);
  assert.equal(estimate.percentTimeToExhaustHrs, null);
});
// harn:end rate-limit-local-estimates
