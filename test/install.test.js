'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const test = require('node:test');

const { parseOptions } = require('../src/cli');
const { readConfig } = require('../src/config');
const { runInstall, WORD_ART } = require('../src/install');
const { readDailyLog } = require('../src/log-store');

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'didmyaigetdumber-'));
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

function sink() {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

function codexFile(sessionsDir, date = '2026-06-08') {
  const [year, month, day] = date.split('-');
  return path.join(sessionsDir, year, month, day, `rollout-${date}T01-00-00-sanitized.jsonl`);
}

function claudeFile(projectsDir, date = '2026-06-08') {
  return path.join(projectsDir, 'project', `${date}-sanitized.jsonl`);
}

// harn:assume interactive-install-onboarding ref=install-tests
test('installer writes selected hooks and telemetry preference', async () => {
  const baseDir = tempBase();
  const codexConfigPath = path.join(baseDir, 'codex-hooks.json');
  const claudeConfigPath = path.join(baseDir, 'claude-settings.json');
  const stdout = capture();

  assert.equal(await runInstall({
    baseDir,
    codexConfigPath,
    claudeConfigPath,
    yes: true,
    agent: 'all',
    telemetry: 'on',
    backfill: false,
    command: '/tmp/dimyd',
  }, {
    stdin: process.stdin,
    stdout: stdout.stream,
    stderr: sink(),
  }), 0);

  const codex = JSON.parse(fs.readFileSync(codexConfigPath, 'utf8'));
  const claude = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf8'));
  const output = stdout.text();

  assert.equal(codex.hooks.UserPromptSubmit[0].command, '/tmp/dimyd hook');
  assert.equal(claude.hooks.UserPromptSubmit[0].hooks[0].command, '/tmp/dimyd hook');
  assert.equal(readConfig({ baseDir }).telemetry_enabled, true);
  assert.match(output, new RegExp(WORD_ART.split('\n')[0].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(output, /thanks\. this helps compare aggregate model trends/);
  assert.match(output, /skipped historical backfill/);
});

test('installer can backfill Codex and Claude logs through the combined writer', async () => {
  const baseDir = tempBase();
  const codexSessionsDir = path.join(baseDir, 'codex-sessions');
  const claudeProjectsDir = path.join(baseDir, 'claude-projects');

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
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'my mistake' }] },
    },
  ]);

  assert.equal(await runInstall({
    baseDir,
    codexSessionsDir,
    claudeProjectsDir,
    yes: true,
    agent: 'none',
    telemetry: 'off',
  }, {
    stdin: process.stdin,
    stdout: sink(),
    stderr: sink(),
  }), 0);

  const log = readDailyLog('2026-06-08', { baseDir });
  assert.equal(log.totals.sessions, 2);
  assert.equal(log.totals.user_messages, 1);
  assert.equal(log.totals.assistant_messages, 1);
  assert.equal(log.matches.user_1pt.events, 1);
  assert.equal(log.matches.assistant_2pt.events, 1);
  assert.equal(readConfig({ baseDir }).telemetry_enabled, false);
});

test('CLI parser accepts installer options', () => {
  const parsed = parseOptions([
    '--yes',
    '--agent',
    'codex',
    '--telemetry',
    'off',
    '--command',
    'npx --yes @richhardry/didmyaigetdumber@latest',
    '--no-backfill',
    '--dry-run',
  ]);

  assert.deepEqual(parsed.positional, []);
  assert.equal(parsed.options.yes, true);
  assert.equal(parsed.options.agent, 'codex');
  assert.equal(parsed.options.telemetry, 'off');
  assert.equal(parsed.options.backfill, false);
  assert.equal(parsed.options.dryRun, true);
});
// harn:end interactive-install-onboarding
