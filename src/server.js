'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { apiMetricsDays } = require('./metrics');
const { reportRows } = require('./report');
const { buildUiData } = require('./ui-data');

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

// harn:assume ui-static-asset-serving ref=server-static
const UI_DIR = path.resolve(__dirname, 'ui');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jsx': 'text/babel; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Resolve a request path to a file inside UI_DIR, or null if it escapes the root.
function resolveUiFile(pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = path.resolve(UI_DIR, rel);
  if (target !== UI_DIR && !target.startsWith(UI_DIR + path.sep)) {
    return null;
  }
  return target;
}

function serveStatic(res, pathname) {
  let file;
  try {
    file = resolveUiFile(pathname);
  } catch (_error) {
    file = null; // malformed percent-encoding
  }
  if (!file) {
    send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found\n');
    return;
  }

  let data;
  try {
    data = fs.readFileSync(file);
  } catch (_error) {
    send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found\n');
    return;
  }

  const type = CONTENT_TYPES[path.extname(file)] || 'application/octet-stream';
  send(res, 200, { 'content-type': type, 'cache-control': 'no-store' }, data);
}
// harn:end ui-static-asset-serving

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

    // harn:assume rolling-status-metrics-api ref=server-ui-api
    if (url.pathname === '/api/ui') {
      json(res, { data: buildUiData({ ...options, days: url.searchParams.get('days') || options.days }) });
      return;
    }
    // harn:end rolling-status-metrics-api

    if (url.pathname === '/health') {
      json(res, { ok: true });
      return;
    }

    if (url.pathname === '/favicon.ico') {
      send(res, 204, { 'cache-control': 'no-store' }, '');
      return;
    }

    serveStatic(res, url.pathname);
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
  parsePort,
  serveStatic,
  startServer,
};
