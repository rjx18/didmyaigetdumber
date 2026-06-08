'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { apiDays, apiMetricsDays, createServer, parsePort } = require('../src/server');
const { createDailyLog, writeDailyLog } = require('../src/log-store');

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'didmyaigetdumber-'));
}

function writeAggregate(date, options, values) {
  const log = createDailyLog(date);
  Object.assign(log.totals, values.totals || {});
  Object.assign(log.matches.user_1pt, values.user_1pt || {});
  Object.assign(log.matches.user_2pt, values.user_2pt || {});
  Object.assign(log.matches.assistant_1pt, values.assistant_1pt || {});
  Object.assign(log.matches.assistant_2pt, values.assistant_2pt || {});
  Object.assign(log.tokens, values.tokens || {});
  Object.assign(log.tool_output_chars, values.tool_output_chars || {});
  Object.assign(log.tool_calls_by_name, values.tool_calls_by_name || {});
  Object.assign(log.tool_failures_by_name, values.tool_failures_by_name || {});
  Object.assign(log.model_tokens, values.model_tokens || {});
  Object.assign(log.timings_ms, values.timings_ms || {});
  log.windows.push(...(values.windows || []));
  writeDailyLog(log, options);
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

// harn:assume local-dashboard-server ref=server-tests
test('serves aggregate day data as JSON', async () => {
  const baseDir = tempBase();
  writeAggregate('2026-06-07', { baseDir }, {
    totals: { user_messages: 8, assistant_messages: 2 },
    user_1pt: { events: 1, line_hits: 1 },
    user_2pt: { events: 1, line_hits: 1 },
    assistant_1pt: { events: 1, line_hits: 1 },
  });
  writeAggregate('2026-06-08', { baseDir }, {
    totals: { sessions: 2, user_messages: 4, assistant_messages: 6, tool_calls: 3, runtime_interrupts: 1 },
    user_1pt: { events: 1, line_hits: 2 },
    assistant_1pt: { events: 1, line_hits: 1 },
    assistant_2pt: { events: 1, line_hits: 2 },
  });

  assert.equal(parsePort('0'), 0);
  assert.equal(parsePort('bad'), 3587);

  const days = apiDays({ baseDir, days: 1 });
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '2026-06-08');
  assert.equal(days[0].total_pct, 30);
  assert.equal(days[0].user_pct, 25);
  assert.equal(days[0].assistant_pct, 33.3);
  assert.equal(days[0].total_messages, 10);
  assert.equal(days[0].sessions, 2);
});

// harn:assume local-metrics-api ref=server-metrics-tests
test('serves aggregate metrics day data as JSON', async () => {
  const baseDir = tempBase();
  writeAggregate('2026-06-08', { baseDir }, {
    totals: { sessions: 1, turns: 2, user_messages: 3, assistant_messages: 2, tool_calls: 2, tool_failures: 1, compactions: 1 },
    tokens: { input: 100, cache_read: 50, cache_creation: 25, output: 40, reasoning_output: 10, total: 215, thinking_chars: 20, text_chars: 30 },
    model_tokens: { 'gpt-5.4': { input: 100, output: 40, total: 140 } },
    tool_output_chars: { Bash: 300, Read: 100 },
    tool_calls_by_name: { Bash: 1, Read: 1 },
    tool_failures_by_name: { Bash: 1 },
    timings_ms: { turn_sum: 3000, turn_count: 2, ttft_sum: 1000, ttft_count: 1, tool_latency_sum: 400, tool_latency_count: 2, generation_sum: 2000, generation_count: 2 },
    windows: [
      { kind: '5h', sampled_at: '2026-06-08T01:00:00.000Z', resets_at: 1780901738, used_percent: 10, tokens_in_window: 100 },
      { kind: '5h', sampled_at: '2026-06-08T02:00:00.000Z', resets_at: 1780901738, used_percent: 20, tokens_in_window: 300 },
    ],
  });

  const days = apiMetricsDays({ baseDir, days: 1 });
  const serialized = JSON.stringify(days);

  assert.equal(days.length, 1);
  assert.equal(days[0].date, '2026-06-08');
  assert.equal(days[0].totals.turns, 2);
  assert.equal(days[0].tokens.input, 100);
  assert.equal(days[0].cache_ratio, 0.2857);
  assert.equal(days[0].reasoning_share, 0.25);
  assert.equal(days[0].thinking_char_share, 0.4);
  assert.equal(days[0].tool_output_share.Bash, 0.75);
  assert.equal(days[0].tool_call_mix.Read, 0.5);
  assert.equal(days[0].tool_error_rate_by_name.Bash, 1);
  assert.equal(days[0].timings_ms.avg_turn, 1500);
  assert.equal(days[0].timings_ms.output_tokens_per_sec, 20);
  assert.equal(days[0].windows[0].implied_allowance, 1000);
  assert.equal(days[0].windows[1].burn_rate_tokens_per_hour, 200);
  assert.equal(serialized.includes('private'), false);

  const server = createServer({ baseDir });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/metrics/days?days=1`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.days[0].tool_output_share.Bash, 0.75);
  } finally {
    await close(server);
  }
});
// harn:end local-metrics-api

test('serves dashboard UI and API over HTTP', async () => {
  const baseDir = tempBase();

  writeAggregate('2026-06-08', { baseDir }, {
    totals: { user_messages: 1, assistant_messages: 1 },
    user_1pt: { events: 1, line_hits: 1 },
  });

  const server = createServer({ baseDir });
  const port = await listen(server);
  try {
    const apiResponse = await fetch(`http://127.0.0.1:${port}/api/days?days=7`);
    const apiPayload = await apiResponse.json();
    const pageResponse = await fetch(`http://127.0.0.1:${port}/`);
    const page = await pageResponse.text();
    const faviconResponse = await fetch(`http://127.0.0.1:${port}/favicon.ico`);

    assert.equal(apiResponse.status, 200);
    assert.equal(apiPayload.days.length, 1);
    assert.equal(apiPayload.days[0].total_pct, 50);
    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.headers.get('content-type'), /text\/html/);
    assert.match(page, /<div id="root">/);
    assert.match(page, /vendor\/react\.production\.min\.js/);
    assert.equal(faviconResponse.status, 204);
  } finally {
    await close(server);
  }
});
// harn:end local-dashboard-server

// harn:assume ui-static-asset-serving ref=server-tests-static
test('serves vendored static UI assets and blocks path escapes', async () => {
  const baseDir = tempBase();
  const server = createServer({ baseDir });
  const port = await listen(server);
  try {
    const css = await fetch(`http://127.0.0.1:${port}/styles.css`);
    const react = await fetch(`http://127.0.0.1:${port}/vendor/react.production.min.js`);
    const font = await fetch(`http://127.0.0.1:${port}/vendor/fonts/ibm-plex-mono-400.woff2`);
    const missing = await fetch(`http://127.0.0.1:${port}/package.json`);
    const escaped = await fetch(`http://127.0.0.1:${port}/vendor/../../package.json`);
    const encoded = await fetch(`http://127.0.0.1:${port}/%2e%2e%2fpackage.json`);

    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.equal(react.status, 200);
    assert.match(react.headers.get('content-type'), /javascript/);
    assert.equal(font.status, 200);
    assert.match(font.headers.get('content-type'), /font\/woff2/);
    assert.equal(missing.status, 404);
    assert.equal(escaped.status, 404);
    assert.equal(encoded.status, 404);
  } finally {
    await close(server);
  }
});
// harn:end ui-static-asset-serving
