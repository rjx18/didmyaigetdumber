'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { dailyLogPath, readDailyLog, writeDailyLog } = require('../src/log-store');
const { apiDays } = require('../src/server');
const { buildUiData } = require('../src/ui-data');

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'didmyaigetdumber-'));
}

// harn:assume aggregate-only-safety-checks ref=privacy-tests
test('public day API exposes only aggregate allowlisted fields', () => {
  const baseDir = tempBase();
  writeDailyLog({
    schema_version: 2,
    date: '2026-06-08',
    updated_at: '2026-06-08T01:00:00.000Z',
    raw_prompt: 'sanitized raw prompt',
    file_path: 'sanitized file path',
    command: 'sanitized command',
    totals: {
      sessions: 1,
      user_messages: 4,
      assistant_messages: 6,
      tool_calls: 2,
      runtime_interrupts: 1,
    },
    matches: {
      user_1pt: { events: 1, line_hits: 2 },
      user_2pt: { events: 1, line_hits: 1 },
      assistant_1pt: { events: 1, line_hits: 1 },
      assistant_2pt: { events: 1, line_hits: 2 },
    },
    tokens: { input: 100, output: 25 },
    tool_output_chars: {
      Bash: 400,
      '/home/user/private/file.js': 999,
    },
    tool_calls_by_name: {
      Read: 2,
      '../private-script': 1,
    },
    model_tokens: {
      'hf:moonshotai/Kimi-K2.6': { input: 100, output: 25, total: 125 },
      '/home/user/model-path': { input: 999 },
    },
    timings_ms: { turn_sum: 1000, turn_count: 1 },
    windows: [
      {
        kind: '5h',
        sampled_at: '2026-06-08T01:00:00.000Z',
        resets_at: 1780901738,
        used_percent: 12,
        tokens_in_window: 100,
        path: '/home/user/private/file.js',
      },
    ],
  }, { baseDir });

  const rows = apiDays({ baseDir, days: 1 });
  const serialized = JSON.stringify(rows);
  const fileText = fs.readFileSync(dailyLogPath('2026-06-08', { baseDir }), 'utf8');
  const log = readDailyLog('2026-06-08', { baseDir });
  const allowed = [
    'assistant_hits',
    'assistant_messages',
    'assistant_pct',
    'date',
    'interrupts',
    'sessions',
    'tools',
    'total_hits',
    'total_messages',
    'total_pct',
    'user_hits',
    'user_messages',
    'user_pct',
  ];

  assert.deepEqual(Object.keys(rows[0]).sort(), allowed);
  assert.equal(log.tokens.input, 100);
  assert.equal(log.tool_output_chars.Bash, 400);
  assert.equal(log.tool_output_chars['/home/user/private/file.js'], undefined);
  assert.equal(log.tool_calls_by_name['../private-script'], undefined);
  assert.equal(log.model_tokens['hf:moonshotai/Kimi-K2.6'].total, 125);
  assert.equal(serialized.includes('sanitized raw prompt'), false);
  assert.equal(serialized.includes('sanitized file path'), false);
  assert.equal(serialized.includes('sanitized command'), false);
  assert.equal(fileText.includes('sanitized raw prompt'), false);
  assert.equal(fileText.includes('sanitized file path'), false);
  assert.equal(fileText.includes('sanitized command'), false);
  assert.equal(fileText.includes('/home/user/private/file.js'), false);
});

test('UI data payload exposes only aggregate values and safe labels', () => {
  const baseDir = tempBase();
  writeDailyLog({
    schema_version: 2,
    date: '2026-06-08',
    raw_prompt: 'sanitized raw prompt',
    file_path: 'sanitized file path',
    command: 'sanitized command',
    totals: { sessions: 1, user_messages: 4, assistant_messages: 6, tool_calls: 3 },
    matches: { user_1pt: { events: 1, line_hits: 1 } },
    tokens: { input: 100, output: 25, total: 125 },
    tool_output_chars: { Bash: 400, '/home/user/private/file.js': 999 },
    tool_calls_by_name: { Read: 2, '../private-script': 1 },
    model_tokens: {
      'hf:moonshotai/Kimi-K2.6': { input: 100, output: 25, total: 125 },
      '/home/user/model-path': { input: 999, total: 999 },
    },
    windows: [
      { kind: '5h', sampled_at: '2026-06-08T01:00:00.000Z', resets_at: 1780901738, used_percent: 12, tokens_in_window: 100, path: '/home/user/private/file.js' },
    ],
  }, { baseDir });

  const data = buildUiData({ baseDir, days: 7 });
  const serialized = JSON.stringify(data);

  // safe labels survive; path-like labels are dropped on write
  assert.ok(data.tools.mix.some((tool) => tool.name === 'Read'));
  assert.ok(data.tools.mix.every((tool) => !tool.name.includes('/')));
  assert.ok(data.models.some((model) => model.name === 'hf:moonshotai/Kimi-K2.6'));
  assert.ok(data.models.every((model) => !model.name.startsWith('/')));

  // no raw content of any kind in the serialized payload
  assert.equal(serialized.includes('sanitized raw prompt'), false);
  assert.equal(serialized.includes('sanitized file path'), false);
  assert.equal(serialized.includes('sanitized command'), false);
  assert.equal(serialized.includes('/home/user/private/file.js'), false);
  assert.equal(serialized.includes('../private-script'), false);
  assert.equal(serialized.includes('/home/user/model-path'), false);
});

test('per-model slices retain aggregate counters without retaining unsafe model labels', () => {
  const baseDir = tempBase();
  writeDailyLog({
    schema_version: 3,
    date: '2026-06-08',
    by_model: {
      'gpt-5.4': { totals: { turns: 1 }, tokens: { total: 10 } },
      '/home/user/private-model': { totals: { turns: 2 }, tokens: { total: 20 } },
    },
  }, { baseDir });

  const fileText = fs.readFileSync(dailyLogPath('2026-06-08', { baseDir }), 'utf8');
  const log = readDailyLog('2026-06-08', { baseDir });

  assert.equal(log.by_model['gpt-5.4'].totals.turns, 1);
  assert.equal(log.by_model.unknown.totals.turns, 2);
  assert.equal(fileText.includes('/home/user/private-model'), false);
});
// harn:end aggregate-only-safety-checks
