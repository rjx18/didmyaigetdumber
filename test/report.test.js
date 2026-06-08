'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const test = require('node:test');

const { formatReport, runReport } = require('../src/report');
const { createDailyLog, writeDailyLog } = require('../src/log-store');

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

function writeAggregate(date, options, values) {
  const log = createDailyLog(date);
  Object.assign(log.totals, values.totals || {});
  Object.assign(log.matches.user_1pt, values.user_1pt || {});
  Object.assign(log.matches.user_2pt, values.user_2pt || {});
  Object.assign(log.matches.assistant_1pt, values.assistant_1pt || {});
  Object.assign(log.matches.assistant_2pt, values.assistant_2pt || {});
  writeDailyLog(log, options);
}

// harn:assume daily-report-percentages ref=report-tests
test('reports recent daily aggregate percentages', async () => {
  const baseDir = tempBase();
  const stdout = capture();

  writeAggregate('2026-06-07', { baseDir }, {
    totals: { sessions: 1, user_messages: 10, assistant_messages: 5, tool_calls: 2 },
    user_1pt: { events: 1, line_hits: 2 },
    user_2pt: { events: 1, line_hits: 1 },
    assistant_1pt: { events: 1, line_hits: 1 },
  });
  writeAggregate('2026-06-08', { baseDir }, {
    totals: { sessions: 2, user_messages: 4, assistant_messages: 6, tool_calls: 7, runtime_interrupts: 1 },
    user_1pt: { events: 1, line_hits: 2 },
    assistant_1pt: { events: 1, line_hits: 1 },
    assistant_2pt: { events: 1, line_hits: 2 },
  });

  assert.equal(await runReport({ baseDir, days: '1' }, {
    stdout: stdout.stream,
    stderr: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
  }), 0);

  const output = stdout.text();
  assert.equal(output.includes('2026-06-07'), false);
  assert.match(output, /2026-06-08/);
  assert.match(output, /30\.0%/);
  assert.match(output, /25\.0%/);
  assert.match(output, /33\.3%/);
  assert.match(output, /3\/10/);
  assert.match(output, /1\/4/);
  assert.match(output, /2\/6/);
});

test('formats empty report output without reading raw content', () => {
  assert.equal(formatReport([]), 'no daily logs found\n');
});
// harn:end daily-report-percentages
