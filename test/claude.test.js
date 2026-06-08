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

// harn:assume claude-live-hook-counting ref=claude-hook-tests
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
  assert.equal(log.matches.assistant_patterns.events, 1);
});

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
// harn:end claude-live-hook-counting
