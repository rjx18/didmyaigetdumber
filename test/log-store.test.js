'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  acquireDailyLock,
  applyIncrement,
  createDailyLog,
  dailyLockPath,
  dailyLogPath,
  emptyIncrement,
  ensureDailyLog,
  normalizeDailyLog,
  readDailyLog,
  releaseDailyLock,
  updateDailyLog,
  writeDailyLog,
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

test('normalizes daily logs to aggregate-only fields', () => {
  const baseDir = tempBase();
  const date = '2026-06-08';
  const normalized = normalizeDailyLog({
    date,
    raw_prompt: 'sanitized raw prompt',
    command: 'sanitized command',
    totals: { user_messages: 1 },
    matches: { user_patterns: { events: 1, line_hits: 1 } },
  }, date);

  writeDailyLog(normalized, { baseDir });
  const fileText = fs.readFileSync(dailyLogPath(date, { baseDir }), 'utf8');

  assert.deepEqual(Object.keys(normalized).sort(), ['date', 'matches', 'schema_version', 'totals', 'updated_at']);
  assert.equal(fileText.includes('sanitized raw prompt'), false);
  assert.equal(fileText.includes('sanitized command'), false);
  assert.equal(readDailyLog(date, { baseDir }).totals.user_messages, 1);
});
// harn:end daily-aggregate-log-schema

// harn:assume daily-log-locking ref=lock-tests
test('acquires and releases date-scoped lock directories', () => {
  const baseDir = tempBase();
  const options = { baseDir };
  const date = '2026-06-08';

  const lockPath = acquireDailyLock(date, options);

  assert.equal(lockPath, dailyLockPath(date, options));
  assert.equal(fs.existsSync(lockPath), true);

  releaseDailyLock(lockPath);

  assert.equal(fs.existsSync(lockPath), false);
});

test('recovers stale lock directories', () => {
  const baseDir = tempBase();
  const options = { baseDir, staleMs: 1, waitMs: 1 };
  const date = '2026-06-08';
  const staleLock = dailyLockPath(date, options);
  fs.mkdirSync(staleLock, { recursive: true });
  const old = new Date(Date.now() - 1000);
  fs.utimesSync(staleLock, old, old);

  const lockPath = acquireDailyLock(date, options);

  assert.equal(lockPath, staleLock);
  releaseDailyLock(lockPath);
});

test('updates daily logs inside the lock using aggregate increments', () => {
  const baseDir = tempBase();
  const options = { baseDir };
  const date = '2026-06-08';
  const increment = emptyIncrement();
  increment.totals.user_messages = 1;
  increment.matches.user_patterns.events = 1;

  updateDailyLog(date, increment, options);
  updateDailyLog(date, increment, options);

  const log = readDailyLog(date, options);
  assert.equal(log.totals.user_messages, 2);
  assert.equal(log.matches.user_patterns.events, 2);
  assert.equal(fs.existsSync(dailyLockPath(date, options)), false);
});
// harn:end daily-log-locking
