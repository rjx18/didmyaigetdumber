'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildUiData } = require('../src/ui-data');
const { createDailyLog, writeDailyLog } = require('../src/log-store');

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'didmyaigetdumber-'));
}

function writeAggregate(date, options, values) {
  const log = createDailyLog(date);
  Object.assign(log.totals, values.totals || {});
  Object.assign(log.matches.user_1pt, values.user_1pt || {});
  Object.assign(log.matches.user_2pt, values.user_2pt || {});
  Object.assign(log.matches.assistant_1pt, values.assistant_1pt || {});
  Object.assign(log.matches.assistant_2pt, values.assistant_2pt || {});
  Object.assign(log.tokens, values.tokens || {});
  Object.assign(log.tool_output_chars, values.tool_output_chars || {});
  Object.assign(log.tool_calls_by_name, values.tool_calls_by_name || {});
  Object.assign(log.tool_failures_by_name, values.tool_failures_by_name || {});
  Object.assign(log.model_tokens, values.model_tokens || {});
  Object.assign(log.timings_ms, values.timings_ms || {});
  log.windows.push(...(values.windows || []));
  writeDailyLog(log, options);
}

// harn:assume rolling-status-metrics-api ref=ui-data-tests
test('builds aggregate UI payload with derived series and range aggregates', () => {
  const baseDir = tempBase();
  writeAggregate('2026-06-08', { baseDir }, {
    totals: {
      sessions: 2, turns: 4, user_messages: 10, assistant_messages: 10,
      tool_calls: 8, runtime_interrupts: 1, compactions: 1,
    },
    user_1pt: { events: 2 },
    user_2pt: { events: 1 },
    assistant_1pt: { events: 1 },
    tokens: {
      input: 100, output: 50, cache_read: 200, cache_creation: 100,
      reasoning_output: 10, total: 460, thinking_chars: 20, text_chars: 80,
    },
    tool_calls_by_name: { Read: 5, Bash: 3 },
    tool_failures_by_name: { Bash: 1 },
    tool_output_chars: { Read: 1000, Bash: 2000 },
    model_tokens: { 'gpt-5-codex': { total: 460 } },
    timings_ms: {
      turn_sum: 8000, turn_count: 4, ttft_sum: 1000, ttft_count: 1,
      tool_latency_sum: 800, tool_latency_count: 4, generation_sum: 5000, generation_count: 4,
    },
    windows: [
      { kind: '5h', sampled_at: '2026-06-08T01:00:00.000Z', resets_at: 1780901738, used_percent: 10, tokens_in_window: 100 },
      { kind: '5h', sampled_at: '2026-06-08T02:00:00.000Z', resets_at: 1780901738, used_percent: 30, tokens_in_window: 300 },
    ],
  });

  const data = buildUiData({ baseDir, days: 1, asOf: '2026-06-08', now: new Date('2026-06-08T02:00:00.000Z') });

  assert.equal(data.N, 1);
  assert.deepEqual(data.days, ['2026-06-08']);

  // friction
  assert.equal(data.friction.total[0], 20);   // (3 user + 1 asst) / 20 msgs
  assert.equal(data.friction.user[0], 30);     // 3 / 10
  assert.equal(data.friction.assistant[0], 10); // 1 / 10
  assert.equal(data.friction.t1[0], 15);       // (2 + 1) / 20
  assert.equal(data.friction.t2[0], 5);        // (1 + 0) / 20

  // activity
  assert.equal(data.activity.sessions[0], 2);
  assert.equal(data.activity.messages[0], 20);
  assert.equal(data.activity.compactions[0], 1);

  // tokens
  assert.equal(data.tokens.total[0], 460);
  assert.equal(data.tokens.comp.cacheRead[0], 200);
  assert.equal(data.tokens.perSession[0], 230); // 460 / 2

  // ratios
  assert.equal(data.cache.hit[0], 0.5);         // 200 / (200 + 100 + 100)
  assert.equal(data.reasoning.codex[0], 0.2);   // 10 / 50
  assert.equal(data.tools.perMsg[0], 0.4);      // 8 / 20

  // timing
  assert.equal(data.timing.turnDuration[0], 2); // 2000ms -> 2s
  assert.equal(data.timing.throughput[0], 10);  // 50 / (5000/1000)

  // tool mix (range aggregate, sorted by count)
  assert.equal(data.tools.mix[0].name, 'Read');
  assert.equal(data.tools.mix[0].count, 5);
  assert.equal(data.tools.mix[0].errRate, 0);
  assert.equal(data.tools.mix[0].outChars, 1000);
  assert.equal(data.tools.mix[1].name, 'Bash');
  assert.equal(data.tools.mix[1].errRate, 0.3333);

  // models
  assert.deepEqual(data.models, [{ id: 'gpt-5-codex', name: 'gpt-5-codex', tokens: 460, attributedTurns: 0 }]);
  assert.equal(data.apiVersion, 2);
  assert.equal(data.range.granularity, 'day');
  assert.equal(data.all.rolling.tokensPerDay.current, 32.8571);
  assert.equal(data.all.status.verdict, 'degraded');

  // limits
  assert.equal(data.limits.windowUsedPct, 0.3);
  assert.deepEqual(data.limits.windowHistory, [0.1, 0.3]);
  assert.equal(data.limits.burnRate, 200);
});

test('builds calendar-aligned rolling and per-model views', () => {
  const baseDir = tempBase();
  writeAggregate('2026-05-20', { baseDir }, {
    totals: { turns: 1, user_messages: 10 },
    user_1pt: { events: 1 },
    tokens: { total: 140 },
    model_tokens: { 'gpt-test': { total: 140 } },
  });
  writeAggregate('2026-06-03', { baseDir }, {
    totals: { turns: 2, user_messages: 10 },
    user_1pt: { events: 2 },
    tokens: { total: 280 },
    model_tokens: { 'gpt-test': { total: 280 } },
  });

  const data = buildUiData({ baseDir, days: 7, asOf: '2026-06-09', now: new Date('2026-06-09T00:00:00.000Z') });

  assert.equal(data.days.length, 7);
  assert.deepEqual(data.days.slice(-2), ['2026-06-08', '2026-06-09']);
  assert.equal(data.N, 1);
  assert.equal(data.all.rolling.friction.current, 0.2);
  assert.equal(data.all.rolling.friction.previous, 0.1);
  assert.equal(data.all.rolling.tokensPerDay.current, 20);
  assert.equal(data.all.rolling.tokensPerDay.previous, 10);
  assert.equal(data.byModel['gpt-test'].rolling.tokensPerDay.current, 20);
  assert.equal(data.byModel['gpt-test'].coverage.tokens, 1);
});

test('builds empty payload for an empty range without throwing', () => {
  const baseDir = tempBase();
  const data = buildUiData({ baseDir, days: 30 });
  assert.equal(data.N, 0);
  assert.equal(data.days.length, 30);
  assert.deepEqual(data.tools.mix, []);
  assert.deepEqual(data.models, []);
  assert.equal(data.limits.windowUsedPct, 0);
  assert.deepEqual(data.limits.windowHistory, []);
});
// harn:end rolling-status-metrics-api
