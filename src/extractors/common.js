'use strict';

const { TOKEN_KEYS } = require('../log-store');

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

function addTokenUsage(increment, usage, model) {
  const tokens = tokenUsageFromProvider(usage);
  if (!TOKEN_KEYS.some((key) => tokens[key] > 0)) {
    return tokens;
  }

  addTokens(increment.tokens, tokens);
  const safeModel = safeModelName(model);
  if (safeModel) {
    increment.model_tokens[safeModel] ||= Object.fromEntries(TOKEN_KEYS.map((key) => [key, 0]));
    addTokens(increment.model_tokens[safeModel], tokens);
  }
  return tokens;
}

function parseTime(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function isoTime(value) {
  const parsed = parseTime(value);
  return parsed ? parsed.toISOString() : null;
}

function durationMs(start, end) {
  const startTime = parseTime(start);
  const endTime = parseTime(end);
  if (!startTime || !endTime) {
    return 0;
  }
  return Math.max(0, endTime.getTime() - startTime.getTime());
}

function addDuration(increment, sumKey, countKey, ms) {
  const amount = number(ms);
  if (!amount) {
    return;
  }
  increment.timings_ms[sumKey] += amount;
  increment.timings_ms[countKey] += 1;
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

// harn:assume numeric-transcript-extractors ref=extractor-common
function incrementToolCall(increment, name) {
  addMap(increment.tool_calls_by_name, safeToolName(name));
}

function incrementToolOutput(increment, name, output) {
  addMap(increment.tool_output_chars, safeToolName(name), contentLength(output));
}

function incrementToolFailure(increment, name) {
  addMap(increment.tool_failures_by_name, safeToolName(name));
}
// harn:end numeric-transcript-extractors

module.exports = {
  addDuration,
  addMap,
  addTokenUsage,
  contentLength,
  durationMs,
  incrementToolCall,
  incrementToolFailure,
  incrementToolOutput,
  isoTime,
  number,
  safeModelName,
  safeToolName,
  tokenUsageFromProvider,
};
