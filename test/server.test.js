'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { apiDays, createServer, dashboardHtml, parsePort } = require('../src/server');
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

test('serves dashboard HTML and API over HTTP', async () => {
  const baseDir = tempBase();
  const html = dashboardHtml();
  assert.match(html, /<svg id="chart"/);
  assert.match(html, /\/api\/days/);

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
    assert.match(page, /didmyaigetdumber/);
    assert.equal(faviconResponse.status, 204);
  } finally {
    await close(server);
  }
});
// harn:end local-dashboard-server
