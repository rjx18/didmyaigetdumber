'use strict';

const {
  TOKEN_KEYS,
  emptyIncrement,
  emptyModelSlice,
  localDate,
  mergeIncrementFields,
} = require('../log-store');
const { localHour } = require('../hourly-store');

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function safeLabel(value, options = {}) {
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

function safeToolName(value, fallback = 'unknown') {
  return safeLabel(value) || fallback;
}

function safeModelName(value) {
  return safeLabel(value, { allowSlash: true });
}

function modelKey(value) {
  return safeModelName(value) || 'unknown';
}

function addMap(map, key, amount = 1, options = {}) {
  const safeKey = safeLabel(key, options);
  const count = number(amount);
  if (!safeKey || !count) {
    return;
  }
  map[safeKey] = (map[safeKey] || 0) + count;
}

function tokenUsageFromProvider(usage = {}) {
  const input = number(usage.input_tokens);
  const output = number(usage.output_tokens);
  const cacheRead = number(usage.cached_input_tokens || usage.cache_read_input_tokens);
  const cacheCreation = number(usage.cache_creation_input_tokens);
  const reasoningOutput = number(usage.reasoning_output_tokens);
  const total = number(usage.total_tokens) || input + output + cacheRead + cacheCreation;
  return {
    input,
    output,
    cache_read: cacheRead,
    cache_creation: cacheCreation,
    reasoning_output: reasoningOutput,
    total,
    thinking_chars: number(usage.thinking_chars),
    text_chars: number(usage.text_chars),
  };
}

function addTokens(target, tokens) {
  for (const key of TOKEN_KEYS) {
    target[key] += number(tokens[key]);
  }
}

function modelSlice(increment, model) {
  const key = modelKey(model);
  increment.by_model[key] ||= emptyModelSlice();
  return increment.by_model[key];
}

function addTokenUsage(increment, usage, model) {
  const tokens = tokenUsageFromProvider(usage);
  if (!TOKEN_KEYS.some((key) => tokens[key] > 0)) {
    return tokens;
  }
  addTokens(increment.tokens, tokens);
  addTokens(modelSlice(increment, model).tokens, tokens);
  return tokens;
}

function parseTime(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isoTime(value) {
  const parsed = parseTime(value);
  return parsed ? parsed.toISOString() : null;
}

function dateKey(value, fallback = '') {
  const parsed = parseTime(value);
  return parsed ? localDate(parsed) : fallback;
}

function incrementForDate(dayMap, timestamp, fallbackDate = '') {
  const date = dateKey(timestamp, fallbackDate || localDate());
  if (!dayMap.has(date)) {
    dayMap.set(date, emptyIncrement());
  }
  return dayMap.get(date);
}

// harn:assume sub-daily-hourly-storage ref=hourly-extraction
function hourKey(value, fallback = '') {
  const parsed = parseTime(value);
  return parsed ? localHour(parsed) : fallback;
}

function incrementForHour(hourMap, timestamp, fallbackHour = '') {
  const hour = hourKey(timestamp, fallbackHour || localHour());
  if (!hourMap.has(hour)) {
    hourMap.set(hour, emptyIncrement());
  }
  return hourMap.get(hour);
}
// harn:end sub-daily-hourly-storage

function aggregateDayMap(dayMap) {
  const increment = emptyIncrement();
  for (const daily of dayMap.values()) {
    mergeIncrementFields(increment, daily);
  }
  return increment;
}

function durationMs(start, end) {
  const startTime = parseTime(start);
  const endTime = parseTime(end);
  if (!startTime || !endTime) {
    return 0;
  }
  return Math.max(0, endTime.getTime() - startTime.getTime());
}

function addDuration(increment, sumKey, countKey, ms, model) {
  const amount = number(ms);
  if (!amount) {
    return;
  }
  increment.timings_ms[sumKey] += amount;
  increment.timings_ms[countKey] += 1;
  const timings = modelSlice(increment, model).timings_ms;
  timings[sumKey] += amount;
  timings[countKey] += 1;
}

function contentLength(value) {
  if (value == null) {
    return 0;
  }
  if (typeof value === 'string') {
    return value.length;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + contentLength(item), 0);
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') {
      return value.text.length;
    }
    if (typeof value.content === 'string' || Array.isArray(value.content)) {
      return contentLength(value.content);
    }
    try {
      return JSON.stringify(value).length;
    } catch (_error) {
      return 0;
    }
  }
  return String(value).length;
}

// harn:assume date-scoped-transcript-metrics ref=extractor-common
// harn:assume turn-model-attribution ref=extractor-common
function incrementToolCall(increment, name, model) {
  const tool = safeToolName(name);
  addMap(increment.tool_calls_by_name, tool);
  addMap(modelSlice(increment, model).tool_calls_by_name, tool);
}

function incrementToolOutput(increment, name, output, model) {
  const tool = safeToolName(name);
  const length = contentLength(output);
  addMap(increment.tool_output_chars, tool, length);
  addMap(modelSlice(increment, model).tool_output_chars, tool, length);
}

function incrementToolFailure(increment, name, model) {
  const tool = safeToolName(name);
  addMap(increment.tool_failures_by_name, tool);
  addMap(modelSlice(increment, model).tool_failures_by_name, tool);
}
// harn:end turn-model-attribution
// harn:end date-scoped-transcript-metrics

module.exports = {
  addDuration,
  addMap,
  addTokenUsage,
  aggregateDayMap,
  contentLength,
  dateKey,
  durationMs,
  incrementForDate,
  incrementForHour,
  incrementToolCall,
  incrementToolFailure,
  incrementToolOutput,
  isoTime,
  hourKey,
  modelKey,
  modelSlice,
  number,
  safeModelName,
  safeToolName,
  tokenUsageFromProvider,
};
