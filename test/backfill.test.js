'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  groupIncrement,
  writeBackfillDays,
} = require('../src/backfill');
const {
  emptyIncrement,
  readDailyLog,
} = require('../src/log-store');

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'didmyaigetdumber-'));
}

function userIncrement(count) {
  const increment = emptyIncrement();
  increment.totals.user_messages = count;
  increment.matches.user_1pt.events = count;
  increment.matches.user_1pt.line_hits = count * 2;
  increment.tokens.input = count * 100;
  increment.tool_output_chars.Bash = count * 50;
  increment.tool_calls_by_name.Bash = count;
  increment.model_tokens['gpt-5.4'] = { input: count * 100, total: count * 100 };
  increment.timings_ms.turn_sum = count * 1000;
  increment.timings_ms.turn_count = count;
  increment.windows.push({
    kind: '5h',
    sampled_at: `2026-06-08T0${count}:00:00.000Z`,
    resets_at: 1780901738,
    used_percent: count,
    tokens_in_window: count * 100,
  });
  return increment;
}

// harn:assume backfill-idempotent-writes ref=backfill-core-tests
test('groups increments by date and creates missing daily logs', () => {
  const baseDir = tempBase();
  const dayMap = new Map();
  groupIncrement(dayMap, '2026-06-08', userIncrement(1));
  groupIncrement(dayMap, '2026-06-08', userIncrement(2));

  const result = writeBackfillDays(dayMap, { baseDir });
  const log = readDailyLog('2026-06-08', { baseDir });

  assert.deepEqual(result, { created: 1, skipped: 0, overwritten: 0 });
  assert.equal(log.totals.user_messages, 3);
  assert.equal(log.matches.user_1pt.line_hits, 6);
  assert.equal(log.tokens.input, 300);
  assert.equal(log.tool_output_chars.Bash, 150);
  assert.equal(log.tool_calls_by_name.Bash, 3);
  assert.equal(log.model_tokens['gpt-5.4'].input, 300);
  assert.equal(log.timings_ms.turn_sum, 3000);
  assert.equal(log.timings_ms.turn_count, 3);
  assert.equal(log.windows.length, 2);
});

test('skips existing daily logs unless overwrite is set', () => {
  const baseDir = tempBase();
  const dayMap = new Map();
  groupIncrement(dayMap, '2026-06-08', userIncrement(1));

  assert.deepEqual(writeBackfillDays(dayMap, { baseDir }), { created: 1, skipped: 0, overwritten: 0 });
  assert.deepEqual(writeBackfillDays(dayMap, { baseDir }), { created: 0, skipped: 1, overwritten: 0 });
  assert.deepEqual(writeBackfillDays(dayMap, { baseDir, overwrite: true }), { created: 0, skipped: 0, overwritten: 1 });
});
// harn:end backfill-idempotent-writes
