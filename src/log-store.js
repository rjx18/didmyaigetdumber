'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHEMA_VERSION = 2;

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
  'user_1pt',
  'user_2pt',
  'assistant_1pt',
  'assistant_2pt',
];

const LEGACY_MATCH_KEYS = [
  'user_patterns',
  'assistant_patterns',
];

const TOKEN_KEYS = [
  'input',
  'output',
  'cache_read',
  'cache_creation',
  'reasoning_output',
  'total',
  'thinking_chars',
  'text_chars',
];

const TIMING_KEYS = [
  'turn_sum',
  'turn_count',
  'ttft_sum',
  'ttft_count',
  'tool_latency_sum',
  'tool_latency_count',
  'generation_sum',
  'generation_count',
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

function emptyTokens() {
  return Object.fromEntries(TOKEN_KEYS.map((key) => [key, 0]));
}

function emptyTimings() {
  return Object.fromEntries(TIMING_KEYS.map((key) => [key, 0]));
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function sanitizeLabel(value, options = {}) {
  const label = String(value == null ? '' : value).trim();
  if (!label || label.length > 120 || /[\x00-\x1f\x7f\s]/.test(label)) {
    return null;
  }
  if (!options.allowSlash && /[\\/]/.test(label)) {
    return null;
  }
  if (/[\\]/.test(label) || label.startsWith('/') || label.startsWith('~/') || label.startsWith('./') || label.startsWith('../')) {
    return null;
  }
  if (label.includes('/../') || label.includes('/./') || label.includes('//')) {
    return null;
  }
  return label;
}

function normalizeNumberMap(input, options = {}) {
  const output = {};
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  for (const [key, value] of Object.entries(source)) {
    const safeKey = sanitizeLabel(key, options);
    const amount = numeric(value);
    if (safeKey && amount) {
      output[safeKey] = (output[safeKey] || 0) + amount;
    }
  }
  return output;
}

function normalizeTokens(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const tokens = emptyTokens();
  for (const key of TOKEN_KEYS) {
    tokens[key] = numeric(source[key]);
  }
  return tokens;
}

function normalizeTotals(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const totals = emptyTotals();
  for (const key of TOTAL_KEYS) {
    totals[key] = numeric(source[key]);
  }
  return totals;
}

function normalizeMatchCounters(input) {
  const current = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    events: numeric(current.events),
    line_hits: numeric(current.line_hits),
  };
}

function normalizeMatches(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const matches = emptyMatches();
  for (const key of MATCH_KEYS) {
    matches[key] = normalizeMatchCounters(source[key]);
  }
  for (const key of LEGACY_MATCH_KEYS) {
    if (source[key]) {
      matches[key] = normalizeMatchCounters(source[key]);
    }
  }
  return matches;
}

function normalizeTimings(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const timings = emptyTimings();
  for (const key of TIMING_KEYS) {
    timings[key] = numeric(source[key]);
  }
  return timings;
}

function normalizeModelTokens(input) {
  const output = {};
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  for (const [model, counters] of Object.entries(source)) {
    const safeModel = sanitizeLabel(model, { allowSlash: true });
    if (!safeModel) {
      continue;
    }
    const tokens = normalizeTokens(counters);
    if (TOKEN_KEYS.some((key) => tokens[key] > 0)) {
      output[safeModel] = tokens;
    }
  }
  return output;
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normalizeReset(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return normalizeTimestamp(value);
}

function normalizeWindowSample(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const kind = sanitizeLabel(input.kind);
  const sampledAt = normalizeTimestamp(input.sampled_at);
  const resetsAt = normalizeReset(input.resets_at);
  const usedPercent = Number(input.used_percent);
  if (!kind || !sampledAt || !resetsAt || !Number.isFinite(usedPercent) || usedPercent < 0) {
    return null;
  }
  return {
    kind,
    sampled_at: sampledAt,
    resets_at: resetsAt,
    used_percent: usedPercent,
    tokens_in_window: numeric(input.tokens_in_window),
  };
}

function normalizeWindows(input) {
  return (Array.isArray(input) ? input : [])
    .map((sample) => normalizeWindowSample(sample))
    .filter(Boolean);
}

function addCounters(target, increment, keys) {
  const source = increment && typeof increment === 'object' ? increment : {};
  for (const key of keys) {
    target[key] = numeric(target[key]) + numeric(source[key]);
  }
}

function mergeNumberMap(target, increment, options = {}) {
  const normalized = normalizeNumberMap(increment, options);
  for (const [key, value] of Object.entries(normalized)) {
    target[key] = numeric(target[key]) + value;
  }
}

function mergeModelTokens(target, increment) {
  const normalized = normalizeModelTokens(increment);
  for (const [model, tokens] of Object.entries(normalized)) {
    target[model] ||= emptyTokens();
    addCounters(target[model], tokens, TOKEN_KEYS);
  }
}

function ensureMetricContainers(target) {
  target.totals = normalizeTotals(target.totals);
  target.matches = normalizeMatches(target.matches);
  target.tokens = normalizeTokens(target.tokens);
  target.tool_output_chars = normalizeNumberMap(target.tool_output_chars);
  target.tool_calls_by_name = normalizeNumberMap(target.tool_calls_by_name);
  target.tool_failures_by_name = normalizeNumberMap(target.tool_failures_by_name);
  target.model_tokens = normalizeModelTokens(target.model_tokens);
  target.timings_ms = normalizeTimings(target.timings_ms);
  target.tool_latency_ms_by_name = normalizeNumberMap(target.tool_latency_ms_by_name);
  target.windows = normalizeWindows(target.windows);

  return target;
}

// harn:assume daily-metrics-log-schema ref=store-schema
function createDailyLog(date = localDate(), now = new Date()) {
  return {
    schema_version: SCHEMA_VERSION,
    date,
    updated_at: now.toISOString(),
    totals: emptyTotals(),
    matches: emptyMatches(),
    tokens: emptyTokens(),
    tool_output_chars: {},
    tool_calls_by_name: {},
    tool_failures_by_name: {},
    model_tokens: {},
    timings_ms: emptyTimings(),
    tool_latency_ms_by_name: {},
    windows: [],
  };
}

function normalizeDailyLog(input, date = localDate(), now = new Date()) {
  const source = input && typeof input === 'object' ? input : {};
  const log = {
    schema_version: SCHEMA_VERSION,
    date: source.date || date,
    updated_at: source.updated_at || now.toISOString(),
    totals: source.totals || {},
    matches: source.matches || {},
    tokens: source.tokens || {},
    tool_output_chars: source.tool_output_chars || {},
    tool_calls_by_name: source.tool_calls_by_name || {},
    tool_failures_by_name: source.tool_failures_by_name || {},
    model_tokens: source.model_tokens || {},
    timings_ms: source.timings_ms || {},
    tool_latency_ms_by_name: source.tool_latency_ms_by_name || {},
    windows: source.windows || [],
  };

  return ensureMetricContainers(log);
}

function emptyIncrement() {
  return {
    totals: emptyTotals(),
    matches: emptyMatches(),
    tokens: emptyTokens(),
    tool_output_chars: {},
    tool_calls_by_name: {},
    tool_failures_by_name: {},
    model_tokens: {},
    timings_ms: emptyTimings(),
    tool_latency_ms_by_name: {},
    windows: [],
  };
}

function mergeIncrementFields(target, increment = {}) {
  ensureMetricContainers(target);
  addCounters(target.totals, increment.totals, TOTAL_KEYS);

  for (const key of MATCH_KEYS) {
    const matchInc = increment.matches && increment.matches[key] ? increment.matches[key] : {};
    target.matches[key].events += numeric(matchInc.events);
    target.matches[key].line_hits += numeric(matchInc.line_hits);
  }

  addCounters(target.tokens, increment.tokens, TOKEN_KEYS);
  mergeNumberMap(target.tool_output_chars, increment.tool_output_chars);
  mergeNumberMap(target.tool_calls_by_name, increment.tool_calls_by_name);
  mergeNumberMap(target.tool_failures_by_name, increment.tool_failures_by_name);
  mergeModelTokens(target.model_tokens, increment.model_tokens);
  addCounters(target.timings_ms, increment.timings_ms, TIMING_KEYS);
  mergeNumberMap(target.tool_latency_ms_by_name, increment.tool_latency_ms_by_name);
  target.windows.push(...normalizeWindows(increment.windows));
  return target;
}

function applyIncrement(log, increment, now = new Date()) {
  const next = normalizeDailyLog(log, log.date, now);
  mergeIncrementFields(next, increment);
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
// harn:end daily-metrics-log-schema

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
  SCHEMA_VERSION,
  TIMING_KEYS,
  TOKEN_KEYS,
  TOTAL_KEYS,
  acquireDailyLock,
  applyIncrement,
  baseDir,
  createDailyLog,
  dailyLockPath,
  dailyLogPath,
  emptyIncrement,
  emptyTimings,
  emptyTokens,
  ensureDailyLog,
  localDate,
  locksDir,
  logsDir,
  mergeIncrementFields,
  normalizeDailyLog,
  normalizeModelTokens,
  normalizeNumberMap,
  normalizeTimings,
  normalizeTokens,
  normalizeWindows,
  readDailyLog,
  releaseDailyLock,
  updateDailyLog,
  withDailyLogLock,
  writeDailyLog,
  writeDailyLogAtomic,
};
