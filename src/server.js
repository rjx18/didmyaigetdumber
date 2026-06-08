'use strict';

const http = require('http');
const { apiMetricsDays } = require('./metrics');
const { reportRows } = require('./report');

function parsePort(value, fallback = 3587) {
  if (value == null) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function ratioParts(value) {
  const [hits, messages] = String(value || '0/0').split('/').map((item) => Number.parseInt(item, 10));
  return {
    hits: Number.isFinite(hits) ? hits : 0,
    messages: Number.isFinite(messages) ? messages : 0,
  };
}

function pctNumber(value) {
  const parsed = Number.parseFloat(String(value || '0').replace('%', ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function apiDays(options = {}) {
  return reportRows(options).map((row) => {
    const total = ratioParts(row.total_ratio);
    const user = ratioParts(row.user_ratio);
    const assistant = ratioParts(row.assistant_ratio);
    return {
      date: row.date,
      total_pct: pctNumber(row.total_pct),
      user_pct: pctNumber(row.user_pct),
      assistant_pct: pctNumber(row.assistant_pct),
      total_hits: total.hits,
      total_messages: total.messages,
      user_hits: user.hits,
      user_messages: user.messages,
      assistant_hits: assistant.hits,
      assistant_messages: assistant.messages,
      sessions: row.sessions,
      tools: row.tools,
      interrupts: row.interrupts,
    };
  });
}

// harn:assume local-dashboard-server ref=server-dashboard
function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>didmyaigetdumber</title>
  <style>
    :root {
      --bg: #f5f7f8;
      --surface: #ffffff;
      --surface-2: #eef3f1;
      --text: #18212b;
      --muted: #607080;
      --border: #d8e0e3;
      --total: #26766f;
      --user: #bd4d52;
      --assistant: #5068bc;
      --focus: #161f7a;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px;
      line-height: 1.5;
      letter-spacing: 0;
    }

    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 40px;
    }

    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 18px;
    }

    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 700;
    }

    .subtitle {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 14px;
    }

    .controls {
      display: flex;
      align-items: end;
      gap: 10px;
      flex-wrap: wrap;
    }

    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
    }

    input,
    button {
      min-height: 44px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
    }

    input {
      width: 92px;
      padding: 8px 10px;
    }

    button {
      padding: 8px 15px;
      cursor: pointer;
      font-weight: 700;
    }

    button:hover {
      background: var(--surface-2);
    }

    input:focus,
    button:focus {
      outline: 3px solid color-mix(in srgb, var(--focus), transparent 72%);
      outline-offset: 2px;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }

    .stat {
      min-width: 0;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }

    .stat span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .stat strong {
      display: block;
      margin-top: 6px;
      font-size: 26px;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }

    section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-top: 12px;
    }

    .chart-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }

    h2 {
      margin: 0;
      font-size: 18px;
      line-height: 1.25;
    }

    .legend {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 13px;
    }

    .legend span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .swatch {
      width: 12px;
      height: 12px;
      border-radius: 3px;
      display: inline-block;
    }

    svg {
      width: 100%;
      height: 320px;
      display: block;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fbfcfc;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    th,
    td {
      padding: 10px 8px;
      border-bottom: 1px solid var(--border);
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    th:first-child,
    td:first-child {
      text-align: left;
    }

    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }

    .empty {
      color: var(--muted);
      padding: 28px 0;
      text-align: center;
    }

    @media (max-width: 760px) {
      main {
        width: min(100vw - 20px, 1180px);
        padding-top: 18px;
      }

      header,
      .chart-head {
        align-items: stretch;
        flex-direction: column;
      }

      .stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      section {
        padding: 12px;
      }

      .table-wrap {
        overflow-x: auto;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>didmyaigetdumber</h1>
        <p class="subtitle">Local aggregate trend monitor</p>
      </div>
      <form class="controls" id="controls">
        <label>Days
          <input id="days" name="days" type="number" min="1" max="365" value="30">
        </label>
        <button type="submit">Refresh</button>
      </form>
    </header>

    <div class="stats" aria-live="polite">
      <div class="stat"><span>Total hit rate</span><strong id="totalRate">0.0%</strong></div>
      <div class="stat"><span>User hit rate</span><strong id="userRate">0.0%</strong></div>
      <div class="stat"><span>Assistant hit rate</span><strong id="assistantRate">0.0%</strong></div>
      <div class="stat"><span>Messages</span><strong id="messages">0</strong></div>
    </div>

    <section aria-labelledby="chartTitle">
      <div class="chart-head">
        <h2 id="chartTitle">Pattern hit percentages</h2>
        <div class="legend">
          <span><i class="swatch" style="background: var(--total)"></i>Total</span>
          <span><i class="swatch" style="background: var(--user)"></i>User</span>
          <span><i class="swatch" style="background: var(--assistant)"></i>Assistant</span>
        </div>
      </div>
      <svg id="chart" role="img" aria-label="Daily pattern hit percentages"></svg>
    </section>

    <section aria-labelledby="tableTitle">
      <h2 id="tableTitle">Daily totals</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Total</th>
              <th>User</th>
              <th>Assistant</th>
              <th>Messages</th>
              <th>Sessions</th>
              <th>Tools</th>
              <th>Interrupts</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </section>
  </main>
  <script>
    const colors = {
      total: '#26766f',
      user: '#bd4d52',
      assistant: '#5068bc',
      grid: '#d8e0e3',
      text: '#607080',
    };

    function pct(value) {
      return Number(value || 0).toFixed(1) + '%';
    }

    function sum(days, key) {
      return days.reduce((total, day) => total + Number(day[key] || 0), 0);
    }

    function rate(hits, messages) {
      return messages ? (hits / messages) * 100 : 0;
    }

    function pointPath(days, key, width, height, pad) {
      if (!days.length) return '';
      return days.map((day, index) => {
        const x = days.length === 1 ? width / 2 : pad.left + (index * (width - pad.left - pad.right)) / (days.length - 1);
        const y = pad.top + (100 - Number(day[key] || 0)) * (height - pad.top - pad.bottom) / 100;
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
    }

    function renderChart(days) {
      const svg = document.getElementById('chart');
      const width = Math.max(640, svg.clientWidth || 640);
      const height = 320;
      const pad = { top: 22, right: 24, bottom: 38, left: 46 };
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

      if (!days.length) {
        svg.innerHTML = '<text x="' + (width / 2) + '" y="' + (height / 2) + '" text-anchor="middle" fill="' + colors.text + '">No data yet</text>';
        return;
      }

      const grid = [0, 25, 50, 75, 100].map((value) => {
        const y = pad.top + (100 - value) * (height - pad.top - pad.bottom) / 100;
        return '<line x1="' + pad.left + '" y1="' + y + '" x2="' + (width - pad.right) + '" y2="' + y + '" stroke="' + colors.grid + '"></line>' +
          '<text x="' + (pad.left - 10) + '" y="' + (y + 4) + '" text-anchor="end" fill="' + colors.text + '" font-size="12">' + value + '%</text>';
      }).join('');

      const labels = days.map((day, index) => {
        if (days.length > 8 && index % Math.ceil(days.length / 8) !== 0 && index !== days.length - 1) return '';
        const x = days.length === 1 ? width / 2 : pad.left + (index * (width - pad.left - pad.right)) / (days.length - 1);
        return '<text x="' + x + '" y="' + (height - 12) + '" text-anchor="middle" fill="' + colors.text + '" font-size="12">' + day.date.slice(5) + '</text>';
      }).join('');

      const line = (key, color) => '<polyline points="' + pointPath(days, key, width, height, pad) + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>';
      svg.innerHTML = grid + labels + line('total_pct', colors.total) + line('user_pct', colors.user) + line('assistant_pct', colors.assistant);
    }

    function renderTable(days) {
      const body = document.getElementById('rows');
      if (!days.length) {
        body.innerHTML = '<tr><td class="empty" colspan="8">No daily logs found</td></tr>';
        return;
      }
      body.innerHTML = days.slice().reverse().map((day) => '<tr>' +
        '<td>' + day.date + '</td>' +
        '<td>' + pct(day.total_pct) + '</td>' +
        '<td>' + pct(day.user_pct) + '</td>' +
        '<td>' + pct(day.assistant_pct) + '</td>' +
        '<td>' + day.total_messages + '</td>' +
        '<td>' + day.sessions + '</td>' +
        '<td>' + day.tools + '</td>' +
        '<td>' + day.interrupts + '</td>' +
      '</tr>').join('');
    }

    function renderStats(days) {
      const totalHits = sum(days, 'total_hits');
      const totalMessages = sum(days, 'total_messages');
      const userHits = sum(days, 'user_hits');
      const userMessages = sum(days, 'user_messages');
      const assistantHits = sum(days, 'assistant_hits');
      const assistantMessages = sum(days, 'assistant_messages');
      document.getElementById('totalRate').textContent = pct(rate(totalHits, totalMessages));
      document.getElementById('userRate').textContent = pct(rate(userHits, userMessages));
      document.getElementById('assistantRate').textContent = pct(rate(assistantHits, assistantMessages));
      document.getElementById('messages').textContent = String(totalMessages);
    }

    async function load() {
      const days = document.getElementById('days').value || '30';
      const response = await fetch('/api/days?days=' + encodeURIComponent(days));
      const payload = await response.json();
      renderStats(payload.days);
      renderChart(payload.days);
      renderTable(payload.days);
    }

    document.getElementById('controls').addEventListener('submit', (event) => {
      event.preventDefault();
      load();
    });
    window.addEventListener('resize', () => load());
    load();
  </script>
</body>
</html>`;
}
// harn:end local-dashboard-server

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, value) {
  send(res, 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }, `${JSON.stringify(value)}\n`);
}

// harn:assume local-dashboard-server ref=server-http
function createServer(options = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method !== 'GET') {
      send(res, 405, { 'content-type': 'text/plain; charset=utf-8' }, 'method not allowed\n');
      return;
    }

    if (url.pathname === '/api/days') {
      json(res, { days: apiDays({ ...options, days: url.searchParams.get('days') || options.days }) });
      return;
    }

    // harn:assume local-metrics-api ref=server-metrics-api
    if (url.pathname === '/api/metrics/days') {
      json(res, { days: apiMetricsDays({ ...options, days: url.searchParams.get('days') || options.days }) });
      return;
    }
    // harn:end local-metrics-api

    if (url.pathname === '/health') {
      json(res, { ok: true });
      return;
    }

    if (url.pathname === '/favicon.ico') {
      send(res, 204, { 'cache-control': 'no-store' }, '');
      return;
    }

    if (url.pathname === '/') {
      send(res, 200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      }, dashboardHtml());
      return;
    }

    send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found\n');
  });
}

async function startServer(options = {}, io) {
  const host = options.host || '127.0.0.1';
  const port = parsePort(options.port);
  const server = createServer(options);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      io.stdout.write(`didmyaigetdumber dashboard: http://${host}:${address.port}\n`);
      resolve(0);
    });
  });
}
// harn:end local-dashboard-server

module.exports = {
  apiDays,
  apiMetricsDays,
  createServer,
  dashboardHtml,
  parsePort,
  startServer,
};
