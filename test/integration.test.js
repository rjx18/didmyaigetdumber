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
const { listHourlyKeys, readHourlyLog } = require('../src/hourly-store');
const { aggregateRootLogs } = require('../src/metrics');
const { runReport } = require('../src/report');
const { apiDays, apiMetricsDays, createServer } = require('../src/server');

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

function metricSlice(log) {
  return {
    turns: log.totals.turns,
    compactions: log.totals.compactions,
    tokens: log.tokens,
    model_tokens: log.model_tokens,
    tool_output_chars: log.tool_output_chars,
    tool_calls_by_name: log.tool_calls_by_name,
    tool_failures_by_name: log.tool_failures_by_name,
    timings_ms: log.timings_ms,
    tool_latency_ms_by_name: log.tool_latency_ms_by_name,
    windows: log.windows,
  };
}

function metricFixtureRecords() {
  const codex = [
    { timestamp: '2026-06-09T01:00:00.000Z', type: 'session_meta', payload: { cwd: '/private/project' } },
    { timestamp: '2026-06-09T01:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5.4', cwd: '/private/project' } },
    { timestamp: '2026-06-09T01:00:02.000Z', type: 'event_msg', payload: { type: 'task_started' } },
    { timestamp: '2026-06-09T01:00:05.000Z', type: 'response_item', payload: { type: 'function_call', name: 'Bash', call_id: 'call-1', arguments: 'ignored command text' } },
    { timestamp: '2026-06-09T01:00:15.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: 'ignored output text' } },
    {
      timestamp: '2026-06-09T01:00:20.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 5, total_tokens: 150 } },
        rate_limits: { primary: { used_percent: 10, window_minutes: 300, resets_at: 1780901738 } },
      },
    },
    { timestamp: '2026-06-09T01:00:30.000Z', type: 'event_msg', payload: { type: 'task_complete' } },
  ];
  const claude = [
    { timestamp: '2026-06-09T01:01:00.000Z', type: 'user', message: { role: 'user', content: 'private prompt text' } },
    {
      timestamp: '2026-06-09T01:01:20.000Z',
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
      timestamp: '2026-06-09T01:01:50.000Z',
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu-1', content: 'ignored tool output', is_error: true }],
      },
    },
  ];
  return { codex, claude };
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

// harn:assume metrics-v3-end-to-end-verification ref=integration-metrics-tests
test('backfill and live tailing produce the same metric deltas', async () => {
  const backfillBase = tempBase();
  const liveBase = tempBase();
  const codexSessionsDir = path.join(backfillBase, 'codex-sessions');
  const claudeProjectsDir = path.join(backfillBase, 'claude-projects');
  const liveCodexTranscript = path.join(liveBase, 'codex-live.jsonl');
  const liveClaudeTranscript = path.join(liveBase, 'claude-live.jsonl');
  const { codex, claude } = metricFixtureRecords();

  writeJsonl(codexFile(codexSessionsDir, '2026-06-09'), codex);
  writeJsonl(claudeFile(claudeProjectsDir, '2026-06-09'), claude);
  writeJsonl(liveCodexTranscript, codex);
  writeJsonl(liveClaudeTranscript, claude);

  assert.equal(await runBackfill('all', { baseDir: backfillBase, codexSessionsDir, claudeProjectsDir }, {
    stdout: sink(),
    stderr: sink(),
  }), 0);

  await handleHook({ baseDir: liveBase }, {
    stdin: Readable.from([JSON.stringify({
      event_type: 'Stop',
      session_id: 'codex-live-session',
      transcript_path: liveCodexTranscript,
      timestamp: '2026-06-09T01:00:31.000Z',
    })]),
    stdout: sink(),
    stderr: sink(),
  });
  await handleHook({ baseDir: liveBase, agent: 'claude' }, {
    stdin: Readable.from([JSON.stringify({
      hook_event_name: 'SessionEnd',
      session_id: 'claude-live-session',
      transcript_path: liveClaudeTranscript,
      timestamp: '2026-06-09T01:02:00.000Z',
    })]),
    stdout: sink(),
    stderr: sink(),
  });

  const backfillLog = readDailyLog('2026-06-09', { baseDir: backfillBase });
  const liveLog = readDailyLog('2026-06-09', { baseDir: liveBase });
  const metricsRows = apiMetricsDays({ baseDir: liveBase, days: 1 });
  const serialized = JSON.stringify({ backfillLog, liveLog, metricsRows });

  assert.deepEqual(metricSlice(liveLog), metricSlice(backfillLog));
  assert.equal(metricsRows[0].tokens.input, 300);
  assert.equal(metricsRows[0].tool_output_share.Bash, 1);
  assert.equal(metricsRows[0].windows[0].implied_allowance, 1500);
  assert.equal(serialized.includes('/private/project'), false);
  assert.equal(serialized.includes('private prompt text'), false);
  assert.equal(serialized.includes('assistant private text'), false);
  assert.equal(serialized.includes('private thinking text'), false);
  assert.equal(serialized.includes('ignored command text'), false);
  assert.equal(serialized.includes('ignored output text'), false);
  assert.equal(serialized.includes('ignored tool output'), false);
});
// harn:end metrics-v3-end-to-end-verification
// harn:end end-to-end-verification

// harn:assume sub-daily-hourly-storage ref=hourly-backfill-tests
test('complete-day hourly backfill aggregates match the daily aggregate', async () => {
  const baseDir = tempBase();
  const codexSessionsDir = path.join(baseDir, 'codex-sessions');
  const claudeProjectsDir = path.join(baseDir, 'claude-projects');
  const { codex, claude } = metricFixtureRecords();
  writeJsonl(codexFile(codexSessionsDir, '2026-06-09'), codex);
  writeJsonl(claudeFile(claudeProjectsDir, '2026-06-09'), claude);

  await runBackfill('all', {
    baseDir,
    codexSessionsDir,
    claudeProjectsDir,
    now: new Date('2026-06-09T12:00:00'),
  }, { stdout: sink(), stderr: sink() });

  const daily = aggregateRootLogs([readDailyLog('2026-06-09', { baseDir })]);
  const hourly = aggregateRootLogs(
    listHourlyKeys({ baseDir }).filter((hour) => hour.startsWith('2026-06-09')).map((hour) => readHourlyLog(hour, { baseDir }))
  );
  assert.deepEqual(hourly, daily);
});
// harn:end sub-daily-hourly-storage

// harn:assume sub-daily-hourly-storage ref=hourly-hook-tests
test('live transcript tails persist the same numeric metrics by hour and day', async () => {
  const baseDir = tempBase();
  const transcript = path.join(baseDir, 'codex-live.jsonl');
  const { codex } = metricFixtureRecords();
  writeJsonl(transcript, codex);

  await handleHook({ baseDir, now: new Date('2026-06-09T12:00:00') }, {
    stdin: Readable.from([JSON.stringify({
      event_type: 'Stop',
      session_id: 'hourly-live-session',
      transcript_path: transcript,
      timestamp: '2026-06-09T01:00:31.000Z',
    })]),
    stdout: sink(),
    stderr: sink(),
  });

  const daily = readDailyLog('2026-06-09', { baseDir });
  const hour = listHourlyKeys({ baseDir }).find((key) => key.startsWith('2026-06-09'));
  assert.deepEqual(metricSlice(readHourlyLog(hour, { baseDir })), metricSlice(daily));
});
// harn:end sub-daily-hourly-storage
