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
