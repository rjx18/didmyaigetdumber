'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { writeDailyLog } = require('../src/log-store');
const { apiDays } = require('../src/server');

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'didmyaigetdumber-'));
}

// harn:assume aggregate-only-safety-checks ref=privacy-tests
test('public day API exposes only aggregate allowlisted fields', () => {
  const baseDir = tempBase();
  writeDailyLog({
    schema_version: 1,
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
      user_patterns: { events: 1, line_hits: 2 },
      assistant_patterns: { events: 2, line_hits: 3 },
    },
  }, { baseDir });

  const rows = apiDays({ baseDir, days: 1 });
  const serialized = JSON.stringify(rows);
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
  assert.equal(serialized.includes('sanitized raw prompt'), false);
  assert.equal(serialized.includes('sanitized file path'), false);
  assert.equal(serialized.includes('sanitized command'), false);
});
// harn:end aggregate-only-safety-checks
