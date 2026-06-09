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

// harn:assume daily-metrics-log-schema ref=store-tests
test('creates a schema v3 daily metrics log', () => {
  const log = createDailyLog('2026-06-08', new Date('2026-06-08T02:00:00.000Z'));

  assert.deepEqual(Object.keys(log).sort(), [
    'by_model',
    'date',
    'matches',
    'model_tokens',
    'schema_version',
    'timings_ms',
    'tokens',
    'tool_calls_by_name',
    'tool_failures_by_name',
    'tool_latency_ms_by_name',
    'tool_output_chars',
    'totals',
    'updated_at',
    'windows',
  ]);
  assert.equal(log.schema_version, 3);
  assert.equal(log.date, '2026-06-08');
  assert.equal(log.totals.turns, 0);
  assert.equal(log.totals.compactions, 0);
  assert.equal(log.totals.user_messages, 0);
  assert.equal(log.matches.user_1pt.events, 0);
  assert.equal(log.matches.user_2pt.events, 0);
  assert.equal(log.tokens.input, 0);
  assert.equal(log.timings_ms.turn_sum, 0);
  assert.deepEqual(log.windows, []);
  assert.equal(Object.hasOwn(log, 'text'), false);
});

test('applies metrics increments without storing event text', () => {
  const increment = emptyIncrement();
  increment.totals.user_messages = 1;
  increment.matches.user_1pt.events = 1;
  increment.matches.user_1pt.line_hits = 3;
  increment.tokens.input = 100;
  increment.tokens.output = 30;
  increment.tool_output_chars.Bash = 500;
  increment.tool_calls_by_name.Read = 2;
  increment.tool_failures_by_name.Bash = 1;
  increment.model_tokens['gpt-5.4'] = { input: 100, output: 30, total: 130 };
  increment.timings_ms.turn_sum = 1200;
  increment.timings_ms.turn_count = 1;
  increment.tool_latency_ms_by_name.Bash = 700;
  increment.windows.push({
    kind: '5h',
    sampled_at: '2026-06-08T03:00:00.000Z',
    resets_at: 1780901738,
    used_percent: 73,
    tokens_in_window: 42000,
    observed_tokens_delta: 130,
  });

  const log = applyIncrement(createDailyLog('2026-06-08'), increment, new Date('2026-06-08T03:00:00.000Z'));
  const second = applyIncrement(log, increment, new Date('2026-06-08T03:05:00.000Z'));

  assert.equal(second.totals.user_messages, 2);
  assert.equal(second.matches.user_1pt.events, 2);
  assert.equal(second.matches.user_1pt.line_hits, 6);
  assert.equal(second.tokens.input, 200);
  assert.equal(second.tool_output_chars.Bash, 1000);
  assert.equal(second.tool_calls_by_name.Read, 4);
  assert.equal(second.tool_failures_by_name.Bash, 2);
  assert.equal(second.model_tokens['gpt-5.4'].total, 260);
  assert.equal(second.timings_ms.turn_sum, 2400);
  assert.equal(second.timings_ms.turn_count, 2);
  assert.equal(second.tool_latency_ms_by_name.Bash, 1400);
  assert.equal(second.windows.length, 2);
  assert.equal(second.windows[0].observed_tokens_delta, 130);
  assert.equal(JSON.stringify(second).includes('raw prompt'), false);
});

test('ensures and reads a daily log file', () => {
  const baseDir = tempBase();
  const options = { baseDir };
  const date = '2026-06-08';

  ensureDailyLog(date, options);

  assert.equal(fs.existsSync(dailyLogPath(date, options)), true);
  assert.equal(readDailyLog(date, options).date, date);
});

test('normalizes v1 daily logs into schema v3 metrics fields', () => {
  const baseDir = tempBase();
  const date = '2026-06-08';
  const normalized = normalizeDailyLog({
    schema_version: 1,
    date,
    raw_prompt: 'sanitized raw prompt',
    command: 'sanitized command',
    totals: { user_messages: 1, raw_total: 10 },
    matches: {
      user_1pt: { events: 1, line_hits: 1 },
      user_patterns: { events: 2, line_hits: 3 },
    },
    tokens: { input: 11 },
    tool_output_chars: { Bash: 42, '/tmp/private': 100 },
    model_tokens: { 'hf:moonshotai/Kimi-K2.6': { output: 7 } },
    windows: [
      { kind: '5h', sampled_at: '2026-06-08T04:00:00.000Z', resets_at: '1780901738', used_percent: 0, tokens_in_window: 0 },
    ],
  }, date);

  writeDailyLog(normalized, { baseDir });
  const fileText = fs.readFileSync(dailyLogPath(date, { baseDir }), 'utf8');

  assert.equal(normalized.schema_version, 3);
  assert.equal(fileText.includes('sanitized raw prompt'), false);
  assert.equal(fileText.includes('sanitized command'), false);
  assert.equal(fileText.includes('/tmp/private'), false);
  assert.equal(readDailyLog(date, { baseDir }).totals.user_messages, 1);
  assert.equal(readDailyLog(date, { baseDir }).totals.raw_total, undefined);
  assert.equal(readDailyLog(date, { baseDir }).matches.user_patterns.events, 2);
  assert.equal(readDailyLog(date, { baseDir }).tokens.input, 11);
  assert.equal(readDailyLog(date, { baseDir }).model_tokens['hf:moonshotai/Kimi-K2.6'].output, 7);
  assert.equal(readDailyLog(date, { baseDir }).windows[0].used_percent, 0);
});

// harn:assume per-model-daily-log-schema ref=store-model-tests
test('normalizes and additively merges attributable per-model slices', () => {
  const first = emptyIncrement();
  first.by_model['gpt-5.4'] = {
    totals: { sessions: 9, turns: 1, user_messages: 1, tool_calls: 2 },
    matches: { user_1pt: { events: 1, line_hits: 2 } },
    tokens: { input: 100, output: 20, total: 120 },
    tool_calls_by_name: { Read: 2 },
    timings_ms: { turn_sum: 500, turn_count: 1 },
  };
  first.by_model['/private/model-path'] = {
    totals: { turns: 1 },
    tokens: { total: 10 },
  };

  const second = applyIncrement(applyIncrement(createDailyLog('2026-06-08'), first), first);

  assert.equal(second.by_model['gpt-5.4'].totals.turns, 2);
  assert.equal(second.by_model['gpt-5.4'].totals.user_messages, 2);
  assert.equal(second.by_model['gpt-5.4'].totals.sessions, undefined);
  assert.equal(second.by_model['gpt-5.4'].matches.user_1pt.line_hits, 4);
  assert.equal(second.by_model['gpt-5.4'].tokens.total, 240);
  assert.equal(second.by_model['gpt-5.4'].tool_calls_by_name.Read, 4);
  assert.equal(second.by_model['gpt-5.4'].timings_ms.turn_sum, 1000);
  assert.equal(second.by_model.unknown.totals.turns, 2);
  assert.equal(second.model_tokens['gpt-5.4'].total, 240);
  assert.equal(second.model_tokens.unknown.total, 20);
});

test('seeds v3 per-model token slices from legacy model_tokens', () => {
  const normalized = normalizeDailyLog({
    schema_version: 2,
    date: '2026-06-08',
    model_tokens: {
      'gpt-5.4': { input: 10, output: 5, total: 15 },
      '/private/model-path': { total: 99 },
    },
  });

  assert.equal(normalized.by_model['gpt-5.4'].tokens.total, 15);
  assert.equal(normalized.by_model['gpt-5.4'].totals.turns, 0);
  assert.equal(normalized.by_model['/private/model-path'], undefined);
  assert.equal(normalized.model_tokens['gpt-5.4'].total, 15);
});
// harn:end per-model-daily-log-schema
// harn:end daily-metrics-log-schema

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
  increment.matches.user_1pt.events = 1;

  updateDailyLog(date, increment, options);
  updateDailyLog(date, increment, options);

  const log = readDailyLog(date, options);
  assert.equal(log.totals.user_messages, 2);
  assert.equal(log.matches.user_1pt.events, 2);
  assert.equal(fs.existsSync(dailyLockPath(date, options)), false);
});
// harn:end daily-log-locking
