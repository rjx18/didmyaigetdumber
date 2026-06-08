'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const test = require('node:test');

const { formatMetricsReport, runMetricsReport } = require('../src/metrics-report');
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

function writeMetricsDay(date, options) {
  const log = createDailyLog(date);
  Object.assign(log.totals, { assistant_messages: 2 });
  Object.assign(log.tokens, { input: 100, cache_read: 50, output: 40, reasoning_output: 10, total: 190, thinking_chars: 20, text_chars: 30 });
  Object.assign(log.tool_calls_by_name, { Read: 1, Bash: 1 });
  Object.assign(log.tool_output_chars, { Bash: 300, Read: 100 });
  Object.assign(log.timings_ms, { turn_sum: 3000, turn_count: 2, generation_sum: 2000, generation_count: 2 });
  log.windows.push(
    { kind: '5h', sampled_at: '2026-06-08T01:00:00.000Z', resets_at: 1780901738, used_percent: 10, tokens_in_window: 100 },
    { kind: '5h', sampled_at: '2026-06-08T02:00:00.000Z', resets_at: 1780901738, used_percent: 20, tokens_in_window: 300 },
  );
  writeDailyLog(log, options);
}

// harn:assume cli-metrics-report ref=metrics-report-tests
test('formats empty metrics report output', () => {
  assert.equal(formatMetricsReport([]), 'no daily metric logs found\n');
});

test('runs metrics report with aggregate rows', async () => {
  const baseDir = tempBase();
  const stdout = capture();
  writeMetricsDay('2026-06-08', { baseDir });

  assert.equal(await runMetricsReport({ baseDir, days: '1' }, {
    stdout: stdout.stream,
    stderr: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
  }), 0);

  const output = stdout.text();
  assert.match(output, /date\s+tokens\s+cache/);
  assert.match(output, /2026-06-08/);
  assert.match(output, /190/);
  assert.match(output, /33\.3%/);
  assert.match(output, /25\.0%/);
  assert.match(output, /40\.0%/);
  assert.match(output, /Bash:75\.0%/);
  assert.match(output, /20\.0%/);
  assert.match(output, /1\.5k/);
  assert.match(output, /200/);
});
// harn:end cli-metrics-report
