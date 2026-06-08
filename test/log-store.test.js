'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  applyIncrement,
  createDailyLog,
  dailyLogPath,
  emptyIncrement,
  ensureDailyLog,
  readDailyLog,
} = require('../src/log-store');

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'didmyaigetdumber-'));
}

// harn:assume daily-aggregate-log-schema ref=store-tests
test('creates a minimal aggregate-only daily log', () => {
  const log = createDailyLog('2026-06-08', new Date('2026-06-08T02:00:00.000Z'));

  assert.deepEqual(Object.keys(log).sort(), ['date', 'matches', 'schema_version', 'totals', 'updated_at']);
  assert.equal(log.date, '2026-06-08');
  assert.equal(log.totals.user_messages, 0);
  assert.equal(log.matches.user_patterns.events, 0);
  assert.equal(Object.hasOwn(log, 'text'), false);
});

test('applies aggregate increments without storing event text', () => {
  const increment = emptyIncrement();
  increment.totals.user_messages = 1;
  increment.matches.user_patterns.events = 1;
  increment.matches.user_patterns.line_hits = 3;

  const log = applyIncrement(createDailyLog('2026-06-08'), increment, new Date('2026-06-08T03:00:00.000Z'));

  assert.equal(log.totals.user_messages, 1);
  assert.equal(log.matches.user_patterns.events, 1);
  assert.equal(log.matches.user_patterns.line_hits, 3);
  assert.equal(JSON.stringify(log).includes('raw prompt'), false);
});

test('ensures and reads a daily log file', () => {
  const baseDir = tempBase();
  const options = { baseDir };
  const date = '2026-06-08';

  ensureDailyLog(date, options);

  assert.equal(fs.existsSync(dailyLogPath(date, options)), true);
  assert.equal(readDailyLog(date, options).date, date);
});
// harn:end daily-aggregate-log-schema
