'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const test = require('node:test');

const { runDoctor } = require('../src/doctor');

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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writePatterns(root, userPattern, assistantPattern) {
  const dir = path.join(root, 'patterns', 'en');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'user-1pt.md'), `${userPattern}\n`);
  fs.writeFileSync(path.join(dir, 'user-2pt.md'), '\n');
  fs.writeFileSync(path.join(dir, 'assistant-1pt.md'), `${assistantPattern}\n`);
  fs.writeFileSync(path.join(dir, 'assistant-2pt.md'), '\n');
}

// harn:assume doctor-health-checks ref=doctor-tests
test('doctor reports ok setup checks', async () => {
  const baseDir = tempBase();
  const stdout = capture();
  const codexConfigPath = path.join(baseDir, 'codex-hooks.json');
  const claudeConfigPath = path.join(baseDir, 'claude-settings.json');

  writeJson(codexConfigPath, {
    hooks: {
      UserPromptSubmit: [{ name: 'didmyaigetdumber', env: { DIDMYAIGETDUMBER_AGENT: 'codex' } }],
    },
  });
  writeJson(claudeConfigPath, {
    hooks: {
      UserPromptSubmit: [{ matcher: '', hooks: [{ env: { DIDMYAIGETDUMBER_AGENT: 'claude' } }] }],
    },
  });

  assert.equal(await runDoctor({ baseDir, codexConfigPath, claudeConfigPath, date: '2026-06-08' }, {
    stdout: stdout.stream,
    stderr: sink(),
  }), 0);

  const output = stdout.text();
  assert.match(output, /ok patterns:/);
  assert.match(output, /ok logs:/);
  assert.match(output, /ok locks:/);
  assert.match(output, /ok codex hooks:/);
  assert.match(output, /ok claude hooks:/);
  assert.match(output, /doctor ok/);
});

test('doctor returns nonzero for regex compile failures', async () => {
  const baseDir = tempBase();
  const root = path.join(baseDir, 'package-root');
  const stdout = capture();
  writePatterns(root, '[', 'mistake');

  assert.equal(await runDoctor({
    baseDir,
    root,
    codexConfigPath: path.join(baseDir, 'missing-codex.json'),
    claudeConfigPath: path.join(baseDir, 'missing-claude.json'),
  }, {
    stdout: stdout.stream,
    stderr: sink(),
  }), 1);

  const output = stdout.text();
  assert.match(output, /error patterns:/);
  assert.match(output, /warn codex hooks:/);
  assert.match(output, /warn claude hooks:/);
  assert.match(output, /doctor failed:/);
});
// harn:end doctor-health-checks
