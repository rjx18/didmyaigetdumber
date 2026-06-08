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
