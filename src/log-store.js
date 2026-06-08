'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TOTAL_KEYS = [
  'sessions',
  'user_messages',
  'assistant_messages',
  'tool_calls',
  'tool_failures',
  'permission_requests',
  'permission_denied',
  'runtime_interrupts',
];

const MATCH_KEYS = [
  'user_patterns',
  'assistant_patterns',
];

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function baseDir(options = {}) {
  return options.baseDir || path.join(os.homedir(), '.didmyaigetdumber');
}

function logsDir(options = {}) {
  return path.join(baseDir(options), 'logs');
}

function locksDir(options = {}) {
  return path.join(baseDir(options), 'locks');
}

function dailyLogPath(date, options = {}) {
  return path.join(logsDir(options), `${date}.json`);
}

function dailyLockPath(date, options = {}) {
  return path.join(locksDir(options), `${date}.lock`);
}

function emptyTotals() {
  return Object.fromEntries(TOTAL_KEYS.map((key) => [key, 0]));
}

function emptyMatches() {
  return Object.fromEntries(MATCH_KEYS.map((key) => [key, { events: 0, line_hits: 0 }]));
}

// harn:assume daily-aggregate-log-schema ref=store-schema
function createDailyLog(date = localDate(), now = new Date()) {
  return {
    schema_version: 1,
    date,
    updated_at: now.toISOString(),
    totals: emptyTotals(),
    matches: emptyMatches(),
  };
}

function normalizeDailyLog(input, date = localDate(), now = new Date()) {
  const source = input && typeof input === 'object' ? input : {};
  const log = {
    schema_version: source.schema_version || 1,
    date: source.date || date,
    updated_at: source.updated_at || now.toISOString(),
  };

  const totals = { ...(source.totals || {}) };
  for (const key of TOTAL_KEYS) {
    totals[key] = Number.isFinite(totals[key]) ? totals[key] : 0;
  }
  log.totals = totals;

  const matches = { ...(source.matches || {}) };
  for (const key of MATCH_KEYS) {
    const current = matches[key] || {};
    matches[key] = {
      events: Number.isFinite(current.events) ? current.events : 0,
      line_hits: Number.isFinite(current.line_hits) ? current.line_hits : 0,
    };
  }
  log.matches = matches;

  return log;
}

function emptyIncrement() {
  return {
    totals: emptyTotals(),
    matches: emptyMatches(),
  };
}

function applyIncrement(log, increment, now = new Date()) {
  const next = normalizeDailyLog(log, log.date, now);
  const inc = increment || {};

  for (const key of TOTAL_KEYS) {
    next.totals[key] += Number(inc.totals && inc.totals[key] ? inc.totals[key] : 0);
  }

  for (const key of MATCH_KEYS) {
    const matchInc = inc.matches && inc.matches[key] ? inc.matches[key] : {};
    next.matches[key].events += Number(matchInc.events || 0);
    next.matches[key].line_hits += Number(matchInc.line_hits || 0);
  }

  next.updated_at = now.toISOString();
  return next;
}

function readDailyLog(date = localDate(), options = {}) {
  const filePath = dailyLogPath(date, options);
  if (!fs.existsSync(filePath)) {
    return createDailyLog(date);
  }
  return normalizeDailyLog(JSON.parse(fs.readFileSync(filePath, 'utf8')), date);
}

function writeDailyLogAtomic(log, options = {}) {
  const normalized = normalizeDailyLog(log, log.date);
  fs.mkdirSync(logsDir(options), { recursive: true });
  const targetPath = dailyLogPath(normalized.date, options);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`);
  fs.renameSync(tempPath, targetPath);
  return normalized;
}

function writeDailyLog(log, options = {}) {
  return writeDailyLogAtomic(log, options);
}

function ensureDailyLog(date = localDate(), options = {}) {
  const filePath = dailyLogPath(date, options);
  if (fs.existsSync(filePath)) {
    return readDailyLog(date, options);
  }
  return writeDailyLog(createDailyLog(date), options);
}
// harn:end daily-aggregate-log-schema

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// harn:assume daily-log-locking ref=lock-and-atomic-write
function acquireDailyLock(date, options = {}) {
  const lockPath = dailyLockPath(date, options);
  const waitMs = options.waitMs || 25;
  const staleMs = options.staleMs || 30000;
  fs.mkdirSync(locksDir(options), { recursive: true });

  while (true) {
    try {
      fs.mkdirSync(lockPath);
      return lockPath;
    } catch (error) {
      if (error && error.code !== 'EEXIST') {
        throw error;
      }

      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (!statError || statError.code !== 'ENOENT') {
          throw statError;
        }
      }

      sleepMs(waitMs);
    }
  }
}

function releaseDailyLock(lockPath) {
  fs.rmSync(lockPath, { recursive: true, force: true });
}

function withDailyLogLock(date, fn, options = {}) {
  const lockPath = acquireDailyLock(date, options);
  try {
    return fn();
  } finally {
    releaseDailyLock(lockPath);
  }
}

function updateDailyLog(date = localDate(), increment = emptyIncrement(), options = {}) {
  return withDailyLogLock(date, () => {
    const current = readDailyLog(date, options);
    const next = applyIncrement(current, increment);
    return writeDailyLogAtomic(next, options);
  }, options);
}
// harn:end daily-log-locking

module.exports = {
  MATCH_KEYS,
  TOTAL_KEYS,
  acquireDailyLock,
  applyIncrement,
  baseDir,
  createDailyLog,
  dailyLockPath,
  dailyLogPath,
  emptyIncrement,
  ensureDailyLog,
  localDate,
  locksDir,
  logsDir,
  normalizeDailyLog,
  readDailyLog,
  releaseDailyLock,
  updateDailyLog,
  withDailyLogLock,
  writeDailyLog,
  writeDailyLogAtomic,
};
