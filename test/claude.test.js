'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');

const { normalizeClaudePayload } = require('../src/adapters/claude');
const { handleHook } = require('../src/hook');
const { initClaude, mergeClaudeSettings } = require('../src/init/claude');
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

// harn:assume live-attribution-reconciliation ref=claude-hook-tests
test('normalizes Claude user and assistant hook payloads', () => {
  const user = normalizeClaudePayload({
    hook_event_name: 'UserPromptSubmit',
    prompt: "this doesn't work",
  });
  const assistant = normalizeClaudePayload({
    hook_event_name: 'MessageDisplay',
    message: { text: 'good catch, I missed that' },
  });

  assert.equal(user.scope, 'user');
  assert.equal(user.text, "this doesn't work");
  assert.equal(assistant.scope, 'assistant');
  assert.equal(assistant.text, 'good catch, I missed that');
});

test('handles Claude assistant display hooks through aggregate storage', async () => {
  const baseDir = tempBase();
  const payload = JSON.stringify({
    hook_event_name: 'MessageDisplay',
    message: { text: 'good catch, I missed that' },
    timestamp: '2026-06-08T01:00:00.000Z',
  });

  await handleHook({ baseDir, agent: 'claude' }, {
    stdin: Readable.from([payload]),
    stdout: sink(),
    stderr: sink(),
  });

  const log = readDailyLog('2026-06-08', { baseDir });
  assert.equal(log.totals.assistant_messages, 1);
  assert.equal(log.matches.assistant_1pt.events, 1);
});

// harn:assume live-attribution-reconciliation ref=claude-hook-tail-tests
test('tails Claude transcripts on session end hooks for numeric metrics', async () => {
  const baseDir = tempBase();
  const transcriptPath = path.join(baseDir, 'private-session.jsonl');
  writeJsonl(transcriptPath, [
    {
      timestamp: '2026-06-08T01:00:00.000Z',
      type: 'user',
      message: { role: 'user', content: 'private prompt text' },
    },
    {
      timestamp: '2026-06-08T01:00:20.000Z',
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'hf:moonshotai/Kimi-K2.6',
        usage: { input_tokens: 200, cache_read_input_tokens: 50, output_tokens: 40 },
        content: [
          { type: 'thinking', thinking: 'private thinking text' },
          { type: 'text', text: 'assistant private text' },
          { type: 'tool_use', id: 'toolu-1', name: 'Bash', input: { command: 'ignored command text' } },
        ],
      },
    },
    {
      timestamp: '2026-06-08T01:00:50.000Z',
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu-1', content: 'ignored tool output', is_error: true }],
      },
    },
  ]);

  await handleHook({ baseDir, agent: 'claude' }, {
    stdin: Readable.from([JSON.stringify({
      hook_event_name: 'SessionEnd',
      session_id: 'claude-session-1',
      transcript_path: transcriptPath,
      timestamp: '2026-06-08T01:01:00.000Z',
    })]),
    stdout: sink(),
    stderr: sink(),
  });

  const log = readDailyLog('2026-06-08', { baseDir });
  const serialized = JSON.stringify(log);

  assert.equal(log.tokens.input, 200);
  assert.equal(log.tokens.cache_read, 50);
  assert.equal(log.tokens.output, 40);
  assert.equal(log.tokens.thinking_chars, 'private thinking text'.length);
  assert.equal(log.model_tokens['hf:moonshotai/Kimi-K2.6'].output, 40);
  assert.equal(log.by_model['hf:moonshotai/Kimi-K2.6'].tokens.output, 40);
  assert.equal(log.tool_calls_by_name.Bash, 1);
  assert.equal(log.tool_output_chars.Bash, 'ignored tool output'.length);
  assert.equal(log.tool_failures_by_name.Bash, 1);
  assert.equal(log.totals.turns, 1);
  assert.equal(serialized.includes('private prompt text'), false);
  assert.equal(serialized.includes('assistant private text'), false);
  assert.equal(serialized.includes('ignored command text'), false);
  assert.equal(serialized.includes('ignored tool output'), false);
});
// harn:end live-attribution-reconciliation

test('merges Claude settings without duplicating didmyaigetdumber entries', () => {
  const first = mergeClaudeSettings({}, '/tmp/dimyd');
  const second = mergeClaudeSettings(first, '/tmp/dimyd');

  assert.equal(second.hooks.UserPromptSubmit.length, 1);
  assert.equal(second.hooks.UserPromptSubmit[0].hooks[0].command, '/tmp/dimyd hook');
});

test('writes Claude settings to an explicit path', async () => {
  const baseDir = tempBase();
  const configPath = path.join(baseDir, 'settings.json');

  await initClaude({ configPath, command: '/tmp/dimyd' }, {
    stdout: sink(),
    stderr: sink(),
  });

  const settings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(settings.hooks.MessageDisplay[0].hooks[0].env.DIDMYAIGETDUMBER_AGENT, 'claude');
});
// harn:end live-attribution-reconciliation
