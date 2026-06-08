'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const test = require('node:test');

const { backfillClaude } = require('../src/backfills/claude');
const { runBackfill } = require('../src/backfill');
const { initClaude } = require('../src/init/claude');
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

function claudeFile(projectsDir, date = '2026-06-08') {
  return path.join(projectsDir, 'project', `${date}-sanitized.jsonl`);
}

function codexFile(sessionsDir, date = '2026-06-08') {
  const [year, month, day] = date.split('-');
  return path.join(sessionsDir, year, month, day, `rollout-${date}T01-00-00-sanitized.jsonl`);
}

// harn:assume claude-historical-backfill ref=claude-backfill-tests
test('backfills sanitized Claude JSONL records into aggregate daily logs', () => {
  const baseDir = tempBase();
  const claudeProjectsDir = path.join(baseDir, 'projects');

  writeJsonl(claudeFile(claudeProjectsDir), [
    {
      timestamp: '2026-06-08T01:00:00.000Z',
      type: 'user',
      message: { role: 'user', content: "this is wrong and I don't want that" },
    },
    {
      timestamp: '2026-06-08T01:01:00.000Z',
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'hf:moonshotai/Kimi-K2.6',
        usage: {
          input_tokens: 210,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 40,
          output_tokens: 50,
        },
        content: [
          { type: 'text', text: 'my mistake, good catch' },
          { type: 'thinking', thinking: 'ignored thinking text' },
          { type: 'tool_use', id: 'toolu-1', name: 'Bash', input: { command: 'ignored command text' } },
        ],
      },
    },
    {
      timestamp: '2026-06-08T01:03:00.000Z',
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu-1', content: 'ignored output text', is_error: true }],
      },
    },
    {
      timestamp: '2026-06-08T01:04:00.000Z',
      type: 'system',
      subtype: 'api_error',
      level: 'error',
      error: { message: 'ignored error text' },
    },
  ], ['{not valid json']);

  const result = backfillClaude({ baseDir, claudeProjectsDir });
  const log = readDailyLog('2026-06-08', { baseDir });
  const serialized = JSON.stringify(log);

  assert.equal(result.files, 1);
  assert.equal(result.days, 1);
  assert.equal(result.created, 1);
  assert.equal(result.malformed, 1);
  assert.equal(log.totals.sessions, 1);
  assert.equal(log.totals.user_messages, 1);
  assert.equal(log.totals.assistant_messages, 1);
  assert.equal(log.totals.tool_calls, 1);
  assert.equal(log.totals.tool_failures, 1);
  assert.equal(log.totals.runtime_interrupts, 1);
  assert.equal(log.matches.user_1pt.events, 1);
  assert.equal(log.matches.assistant_1pt.events, 1);
  assert.equal(log.tokens.input, 210);
  assert.equal(log.tokens.cache_creation, 10);
  assert.equal(log.tokens.cache_read, 40);
  assert.equal(log.tokens.output, 50);
  assert.equal(log.tokens.thinking_chars, 'ignored thinking text'.length);
  assert.equal(log.model_tokens['hf:moonshotai/Kimi-K2.6'].output, 50);
  assert.equal(log.tool_calls_by_name.Bash, 1);
  assert.equal(log.tool_output_chars.Bash, 'ignored output text'.length);
  assert.equal(log.tool_failures_by_name.Bash, 1);
  assert.equal(log.timings_ms.turn_count, 1);
  assert.equal(log.timings_ms.tool_latency_count, 1);
  assert.equal(log.totals.turns, 1);
  assert.equal(serialized.includes("don't want"), false);
  assert.equal(serialized.includes('good catch'), false);
  assert.equal(serialized.includes('ignored thinking text'), false);
  assert.equal(serialized.includes('ignored command text'), false);
  assert.equal(serialized.includes('ignored output text'), false);
  assert.equal(serialized.includes('ignored error text'), false);
});

test('runs Claude backfill through dispatcher and init backfill flag', async () => {
  const baseDir = tempBase();
  const claudeProjectsDir = path.join(baseDir, 'projects');
  const stdout = capture();

  writeJsonl(claudeFile(claudeProjectsDir), [
    {
      timestamp: '2026-06-08T01:00:00.000Z',
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'still broken' }] },
    },
  ]);

  assert.equal(await runBackfill('claude', { baseDir, claudeProjectsDir }, {
    stdout: stdout.stream,
    stderr: sink(),
  }), 0);
  assert.match(stdout.text(), /claude backfill: files=1 days=1 created=1 skipped=0 overwritten=0/);

  const nextBaseDir = tempBase();
  const nextProjectsDir = path.join(nextBaseDir, 'projects');
  const configPath = path.join(nextBaseDir, 'settings.json');
  writeJsonl(claudeFile(nextProjectsDir), [
    {
      timestamp: '2026-06-08T01:00:00.000Z',
      type: 'user',
      message: { role: 'user', content: 'this is wrong' },
    },
  ]);

  assert.equal(await initClaude({
    baseDir: nextBaseDir,
    claudeProjectsDir: nextProjectsDir,
    configPath,
    command: '/tmp/dimyd',
    backfill: true,
  }, {
    stdout: sink(),
    stderr: sink(),
  }), 0);

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const log = readDailyLog('2026-06-08', { baseDir: nextBaseDir });
  assert.equal(config.hooks.UserPromptSubmit[0].hooks[0].command, '/tmp/dimyd hook');
  assert.equal(log.totals.sessions, 1);
  assert.equal(log.totals.user_messages, 1);
});

test('backfill all merges Codex and Claude same-day aggregates before writing', async () => {
  const baseDir = tempBase();
  const codexSessionsDir = path.join(baseDir, 'codex-sessions');
  const claudeProjectsDir = path.join(baseDir, 'claude-projects');
  const stdout = capture();

  writeJsonl(codexFile(codexSessionsDir), [
    {
      timestamp: '2026-06-08T01:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'still broken' },
    },
  ]);
  writeJsonl(claudeFile(claudeProjectsDir), [
    {
      timestamp: '2026-06-08T01:00:00.000Z',
      type: 'user',
      message: { role: 'user', content: 'this is wrong' },
    },
  ]);

  assert.equal(await runBackfill('all', { baseDir, codexSessionsDir, claudeProjectsDir }, {
    stdout: stdout.stream,
    stderr: sink(),
  }), 0);

  const log = readDailyLog('2026-06-08', { baseDir });
  assert.match(stdout.text(), /all backfill: codex_files=1 claude_files=1 days=1 created=1 skipped=0 overwritten=0/);
  assert.equal(log.totals.sessions, 2);
  assert.equal(log.totals.user_messages, 2);
  assert.equal(log.matches.user_1pt.events, 2);
});

test('skips Claude sessions in the didmyaigetdumber project', () => {
  const baseDir = tempBase();
  const claudeProjectsDir = path.join(baseDir, 'projects');
  const selfFile = path.join(claudeProjectsDir, '-home-xiongjr-git-didmyaigetdumber', '2026-06-08-session.jsonl');

  writeJsonl(selfFile, [
    {
      timestamp: '2026-06-08T01:00:00.000Z',
      type: 'user',
      message: { role: 'user', content: 'this is wrong' },
    },
  ]);

  const excluded = backfillClaude({ baseDir, claudeProjectsDir });
  assert.equal(excluded.files, 0);
  assert.equal(excluded.days, 0);

  const included = backfillClaude({ baseDir, claudeProjectsDir, overwrite: true, excludeProject: null });
  assert.equal(included.files, 1);
  assert.equal(included.days, 1);
});
// harn:end claude-historical-backfill
