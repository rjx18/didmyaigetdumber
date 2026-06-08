'use strict';

const { listDailyDates } = require('./report');
const { readDailyLog } = require('./log-store');

function round(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function sumMap(map = {}) {
  return Object.values(map).reduce((sum, value) => sum + Number(value || 0), 0);
}

function shareMap(map = {}) {
  const total = sumMap(map);
  const output = {};
  for (const [key, value] of Object.entries(map)) {
    output[key] = round(ratio(Number(value || 0), total));
  }
  return output;
}

function errorRateMap(calls = {}, failures = {}) {
  const output = {};
  for (const key of new Set([...Object.keys(calls), ...Object.keys(failures)])) {
    output[key] = round(ratio(Number(failures[key] || 0), Number(calls[key] || 0)));
  }
  return output;
}

function average(sum, count) {
  return round(ratio(Number(sum || 0), Number(count || 0)), 2);
}

function tokensPerSecond(tokens, milliseconds) {
  return round(ratio(Number(tokens || 0), Number(milliseconds || 0) / 1000), 2);
}

function sortedWindowSamples(windows = []) {
  return [...windows].sort((a, b) => {
    const aTime = Date.parse(a.sampled_at || '');
    const bTime = Date.parse(b.sampled_at || '');
    return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
  });
}

function windowMetrics(windows = []) {
  const previousByWindow = new Map();
  return sortedWindowSamples(windows).map((sample) => {
    const usedPercent = Number(sample.used_percent || 0);
    const tokensInWindow = Number(sample.tokens_in_window || 0);
    const key = `${sample.kind}:${sample.resets_at}`;
    const sampledAtMs = Date.parse(sample.sampled_at || '');
    const previous = previousByWindow.get(key);
    let burnRateTokensPerHour = null;
    if (previous && Number.isFinite(sampledAtMs) && Number.isFinite(previous.sampledAtMs)) {
      const hours = (sampledAtMs - previous.sampledAtMs) / 3600000;
      if (hours > 0) {
        burnRateTokensPerHour = round((tokensInWindow - previous.tokensInWindow) / hours, 2);
      }
    }
    previousByWindow.set(key, { sampledAtMs, tokensInWindow });
    return {
      kind: sample.kind,
      sampled_at: sample.sampled_at,
      resets_at: sample.resets_at,
      used_percent: usedPercent,
      tokens_in_window: tokensInWindow,
      implied_allowance: usedPercent > 0 ? round(tokensInWindow / (usedPercent / 100), 2) : null,
      burn_rate_tokens_per_hour: burnRateTokensPerHour,
    };
  });
}

// harn:assume local-metrics-api ref=metrics-derivations
function metricsForLog(log) {
  const tokens = log.tokens || {};
  const timings = log.timings_ms || {};
  const toolOutputChars = log.tool_output_chars || {};
  const toolCallsByName = log.tool_calls_by_name || {};
  const toolFailuresByName = log.tool_failures_by_name || {};

  return {
    date: log.date,
    totals: {
      sessions: log.totals.sessions,
      turns: log.totals.turns,
      user_messages: log.totals.user_messages,
      assistant_messages: log.totals.assistant_messages,
      tool_calls: log.totals.tool_calls,
      tool_failures: log.totals.tool_failures,
      runtime_interrupts: log.totals.runtime_interrupts,
      compactions: log.totals.compactions,
    },
    tokens: {
      input: tokens.input,
      output: tokens.output,
      cache_read: tokens.cache_read,
      cache_creation: tokens.cache_creation,
      reasoning_output: tokens.reasoning_output,
      total: tokens.total,
      thinking_chars: tokens.thinking_chars,
      text_chars: tokens.text_chars,
    },
    model_tokens: log.model_tokens || {},
    cache_ratio: round(ratio(tokens.cache_read, tokens.cache_read + tokens.input + tokens.cache_creation)),
    reasoning_share: round(ratio(tokens.reasoning_output, tokens.output)),
    thinking_char_share: round(ratio(tokens.thinking_chars, tokens.thinking_chars + tokens.text_chars)),
    tool_output_chars_total: sumMap(toolOutputChars),
    tool_output_share: shareMap(toolOutputChars),
    tool_call_total_by_name: sumMap(toolCallsByName),
    tool_call_mix: shareMap(toolCallsByName),
    tool_error_rate_by_name: errorRateMap(toolCallsByName, toolFailuresByName),
    timings_ms: {
      avg_turn: average(timings.turn_sum, timings.turn_count),
      avg_ttft: average(timings.ttft_sum, timings.ttft_count),
      avg_tool_latency: average(timings.tool_latency_sum, timings.tool_latency_count),
      output_tokens_per_sec: tokensPerSecond(tokens.output, timings.generation_sum),
      counts: {
        turn: timings.turn_count,
        ttft: timings.ttft_count,
        tool_latency: timings.tool_latency_count,
        generation: timings.generation_count,
      },
    },
    windows: windowMetrics(log.windows || []),
  };
}

function apiMetricsDays(options = {}) {
  const limit = Number.parseInt(options.days || 14, 10);
  const days = Number.isFinite(limit) && limit > 0 ? limit : 14;
  return listDailyDates(options)
    .slice(-days)
    .map((date) => metricsForLog(readDailyLog(date, options)));
}
// harn:end local-metrics-api

module.exports = {
  apiMetricsDays,
  metricsForLog,
  windowMetrics,
};
