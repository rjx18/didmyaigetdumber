'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');

const { runBackfill } = require('../src/backfill');
const { handleHook } = require('../src/hook');
const { readDailyLog } = require('../src/log-store');
const { runReport } = require('../src/report');
const { apiDays, createServer } = require('../src/server');

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

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

function codexFile(sessionsDir, date = '2026-06-07') {
  const [year, month, day] = date.split('-');
  return path.join(sessionsDir, year, month, day, `rollout-${date}T01-00-00-sanitized.jsonl`);
}

function claudeFile(projectsDir, date = '2026-06-07') {
  return path.join(projectsDir, 'project', `${date}-sanitized.jsonl`);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

// harn:assume end-to-end-verification ref=integration-tests
test('simulated hook, backfill, report, and server workflow stays aggregate-only', async () => {
  const baseDir = tempBase();
  const codexSessionsDir = path.join(baseDir, 'codex-sessions');
  const claudeProjectsDir = path.join(baseDir, 'claude-projects');
  const liveText = "this is wrong and I don't want that";
  const codexText = 'still broken';
  const assistantText = 'my mistake, good catch';

  await handleHook({ baseDir }, {
    stdin: Readable.from([JSON.stringify({
      event_type: 'UserPromptSubmit',
      prompt: liveText,
      timestamp: '2026-06-08T01:00:00.000Z',
    })]),
    stdout: sink(),
    stderr: sink(),
  });

  writeJsonl(codexFile(codexSessionsDir), [
    {
      timestamp: '2026-06-07T01:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: codexText },
    },
  ]);
  writeJsonl(claudeFile(claudeProjectsDir), [
    {
      timestamp: '2026-06-07T01:00:00.000Z',
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: assistantText }] },
    },
    {
      timestamp: '2026-06-07T01:01:00.000Z',
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'tool', input: { command: 'sanitized command' } }] },
    },
  ]);

  assert.equal(await runBackfill('all', { baseDir, codexSessionsDir, claudeProjectsDir }, {
    stdout: sink(),
    stderr: sink(),
  }), 0);

  const liveLog = readDailyLog('2026-06-08', { baseDir });
  const historyLog = readDailyLog('2026-06-07', { baseDir });
  assert.equal(liveLog.totals.user_messages, 1);
  assert.equal(liveLog.matches.user_1pt.events, 1);
  assert.equal(historyLog.totals.sessions, 2);
  assert.equal(historyLog.totals.user_messages, 1);
  assert.equal(historyLog.totals.assistant_messages, 1);
  assert.equal(historyLog.totals.tool_calls, 1);
  assert.equal(historyLog.matches.user_1pt.events, 1);
  assert.equal(historyLog.matches.assistant_1pt.events, 1);

  const report = capture();
  assert.equal(await runReport({ baseDir, days: '7' }, {
    stdout: report.stream,
    stderr: sink(),
  }), 0);
  assert.match(report.text(), /2026-06-07/);
  assert.match(report.text(), /2026-06-08/);

  const apiRows = apiDays({ baseDir, days: 7 });
  assert.equal(apiRows.length, 2);
  assert.equal(apiRows[0].date, '2026-06-07');
  assert.equal(apiRows[1].date, '2026-06-08');

  const server = createServer({ baseDir });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/days?days=7`);
    const payload = await response.json();
    const serialized = JSON.stringify({
      liveLog,
      historyLog,
      apiRows,
      payload,
      report: report.text(),
    });

    assert.equal(response.status, 200);
    assert.equal(payload.days.length, 2);
    assert.equal(serialized.includes(liveText), false);
    assert.equal(serialized.includes(codexText), false);
    assert.equal(serialized.includes(assistantText), false);
    assert.equal(serialized.includes('sanitized command'), false);
  } finally {
    await close(server);
  }
});
// harn:end end-to-end-verification
