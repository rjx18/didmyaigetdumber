'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');

const { normalizeCodexPayload } = require('../src/adapters/codex');
const { handleHook } = require('../src/hook');
const { mergeCodexHooksConfig, initCodex } = require('../src/init/codex');
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

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

// harn:assume codex-live-hook-counting ref=codex-hook-tests
test('normalizes Codex user prompt payloads', () => {
  const normalized = normalizeCodexPayload({
    event_type: 'UserPromptSubmit',
    prompt: "this doesn't work",
  });

  assert.equal(normalized.agent, 'codex');
  assert.equal(normalized.scope, 'user');
  assert.equal(normalized.text, "this doesn't work");
});

test('handles Codex user prompt hooks through aggregate storage', async () => {
  const baseDir = tempBase();
  const payload = JSON.stringify({
    event_type: 'UserPromptSubmit',
    prompt: "this doesn't work and I don't want a new file",
    timestamp: '2026-06-08T01:00:00.000Z',
  });

  await handleHook({ baseDir }, {
    stdin: Readable.from([payload]),
    stdout: sink(),
    stderr: sink(),
  });

  const log = readDailyLog('2026-06-08', { baseDir });
  assert.equal(log.totals.user_messages, 1);
  assert.equal(log.matches.user_1pt.events, 1);
  assert.equal(log.matches.user_1pt.line_hits >= 2, true);
});

// harn:assume live-hook-numeric-tail-integration ref=codex-hook-tail-tests
test('tails Codex transcripts on stop hooks for numeric metrics', async () => {
  const baseDir = tempBase();
  const transcriptPath = path.join(baseDir, 'private-session.jsonl');
  writeJsonl(transcriptPath, [
    { timestamp: '2026-06-08T01:00:00.000Z', type: 'turn_context', payload: { model: 'gpt-5.4', cwd: '/private/project' } },
    { timestamp: '2026-06-08T01:00:01.000Z', type: 'event_msg', payload: { type: 'task_started' } },
    { timestamp: '2026-06-08T01:00:05.000Z', type: 'response_item', payload: { type: 'function_call', name: 'Bash', call_id: 'call-1', arguments: 'ignored command text' } },
    { timestamp: '2026-06-08T01:00:15.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: 'ignored output text' } },
    {
      timestamp: '2026-06-08T01:00:20.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 4, total_tokens: 150 } },
        rate_limits: { primary: { used_percent: 10, window_minutes: 300, resets_at: 1780901738 } },
      },
    },
    { timestamp: '2026-06-08T01:00:30.000Z', type: 'event_msg', payload: { type: 'task_complete' } },
  ]);

  await handleHook({ baseDir }, {
    stdin: Readable.from([JSON.stringify({
      event_type: 'Stop',
      session_id: 'codex-session-1',
      transcript_path: transcriptPath,
      timestamp: '2026-06-08T01:00:31.000Z',
    })]),
    stdout: sink(),
    stderr: sink(),
  });

  const log = readDailyLog('2026-06-08', { baseDir });
  const serialized = JSON.stringify(log);

  assert.equal(log.tokens.input, 100);
  assert.equal(log.tokens.reasoning_output, 4);
  assert.equal(log.model_tokens['gpt-5.4'].total, 150);
  assert.equal(log.tool_calls_by_name.Bash, 1);
  assert.equal(log.tool_output_chars.Bash, 'ignored output text'.length);
  assert.equal(log.windows[0].tokens_in_window, 150);
  assert.equal(log.totals.turns, 1);
  assert.equal(serialized.includes('/private/project'), false);
  assert.equal(serialized.includes('ignored command text'), false);
  assert.equal(serialized.includes('ignored output text'), false);
});
// harn:end live-hook-numeric-tail-integration

test('merges Codex hook config without duplicating didmyaigetdumber entries', () => {
  const first = mergeCodexHooksConfig({}, '/tmp/dimyd');
  const second = mergeCodexHooksConfig(first, '/tmp/dimyd');

  assert.equal(second.hooks.UserPromptSubmit.length, 1);
  assert.equal(second.hooks.UserPromptSubmit[0].command, '/tmp/dimyd hook');
});

test('writes Codex hook config to an explicit path', async () => {
  const baseDir = tempBase();
  const configPath = path.join(baseDir, 'hooks.json');

  await initCodex({ configPath, command: '/tmp/dimyd' }, {
    stdout: sink(),
    stderr: sink(),
  });

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.hooks.SessionStart[0].name, 'didmyaigetdumber');
});
// harn:end codex-live-hook-counting
