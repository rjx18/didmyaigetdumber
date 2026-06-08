'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const test = require('node:test');

const { backfillCodex } = require('../src/backfills/codex');
const { runBackfill } = require('../src/backfill');
const { initCodex } = require('../src/init/codex');
const { readDailyLog } = require('../src/log-store');

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'didmyaigetdumber-'));
}

function sink() {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

function capture() {
  let output = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    }),
    text: () => output,
  };
}

function writeJsonl(filePath, records, extraLines = []) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    ...records.map((record) => JSON.stringify(record)),
    ...extraLines,
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function sessionFile(sessionsDir, date = '2026-06-08') {
  const [year, month, day] = date.split('-');
  return path.join(sessionsDir, year, month, day, `rollout-${date}T01-00-00-sanitized.jsonl`);
}

// harn:assume codex-historical-backfill ref=codex-backfill-tests
test('backfills sanitized Codex JSONL records into aggregate daily logs', () => {
  const baseDir = tempBase();
  const codexSessionsDir = path.join(baseDir, 'sessions');

  writeJsonl(sessionFile(codexSessionsDir), [
    {
      timestamp: '2026-06-08T01:00:00.000Z',
      type: 'session_meta',
      payload: { timestamp: '2026-06-08T01:00:00.000Z' },
    },
    {
      timestamp: '2026-06-08T01:01:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: "this is wrong and I don't want that" },
    },
    {
      timestamp: '2026-06-08T01:02:00.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'my mistake, good catch' },
    },
    {
      timestamp: '2026-06-08T01:03:00.000Z',
      type: 'response_item',
      payload: { type: 'function_call', name: 'tool', arguments: 'ignored command text', call_id: 'call-1' },
    },
    {
      timestamp: '2026-06-08T01:04:00.000Z',
      type: 'response_item',
      payload: { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'ignored query' } },
    },
    {
      timestamp: '2026-06-08T01:05:00.000Z',
      type: 'response_item',
      payload: { type: 'function_call_output', output: 'ignored output text', call_id: 'call-1' },
    },
    {
      timestamp: '2026-06-08T01:06:00.000Z',
      type: 'event_msg',
      payload: { type: 'turn_aborted', reason: 'cancelled' },
    },
  ], ['{not valid json']);

  const result = backfillCodex({ baseDir, codexSessionsDir });
  const log = readDailyLog('2026-06-08', { baseDir });
  const serialized = JSON.stringify(log);

  assert.equal(result.files, 1);
  assert.equal(result.days, 1);
  assert.equal(result.created, 1);
  assert.equal(result.malformed, 1);
  assert.equal(log.totals.sessions, 1);
  assert.equal(log.totals.user_messages, 1);
  assert.equal(log.totals.assistant_messages, 1);
  assert.equal(log.totals.tool_calls, 2);
  assert.equal(log.totals.runtime_interrupts, 1);
  assert.equal(log.matches.user_patterns.events, 1);
  assert.equal(log.matches.assistant_patterns.events, 1);
  assert.equal(serialized.includes("don't want"), false);
  assert.equal(serialized.includes('good catch'), false);
  assert.equal(serialized.includes('ignored command text'), false);
  assert.equal(serialized.includes('ignored output text'), false);
});

test('runs Codex backfill through dispatcher and init backfill flag', async () => {
  const baseDir = tempBase();
  const codexSessionsDir = path.join(baseDir, 'sessions');
  const stdout = capture();

  writeJsonl(sessionFile(codexSessionsDir), [
    {
      timestamp: '2026-06-08T01:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'still broken' },
    },
  ]);

  assert.equal(await runBackfill('codex', { baseDir, codexSessionsDir }, {
    stdout: stdout.stream,
    stderr: sink(),
  }), 0);
  assert.match(stdout.text(), /codex backfill: files=1 days=1 created=1 skipped=0 overwritten=0/);

  const nextBaseDir = tempBase();
  const nextSessionsDir = path.join(nextBaseDir, 'sessions');
  const configPath = path.join(nextBaseDir, 'hooks.json');
  writeJsonl(sessionFile(nextSessionsDir), [
    {
      timestamp: '2026-06-08T01:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'this is wrong' },
    },
  ]);

  assert.equal(await initCodex({
    baseDir: nextBaseDir,
    codexSessionsDir: nextSessionsDir,
    configPath,
    command: '/tmp/dimyd',
    backfill: true,
  }, {
    stdout: sink(),
    stderr: sink(),
  }), 0);

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const log = readDailyLog('2026-06-08', { baseDir: nextBaseDir });
  assert.equal(config.hooks.UserPromptSubmit[0].name, 'didmyaigetdumber');
  assert.equal(log.totals.sessions, 1);
  assert.equal(log.totals.user_messages, 1);
});
// harn:end codex-historical-backfill
