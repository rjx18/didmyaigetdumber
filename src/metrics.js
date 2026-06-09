'use strict';

const { listDailyDates } = require('./report');
const {
  emptyIncrement,
  emptyModelSlice,
  mergeIncrementFields,
  mergeModelSlice,
  readDailyLog,
} = require('./log-store');

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

// harn:assume metric-aggregation-core ref=aggregation-core
function aggregateRootLogs(logs = []) {
  const aggregate = emptyIncrement();
  for (const log of logs) {
    mergeIncrementFields(aggregate, log);
  }
  return aggregate;
}

function aggregateModelLogs(logs = [], model) {
  const aggregate = emptyModelSlice();
  for (const log of logs) {
    if (log.by_model && log.by_model[model]) {
      mergeModelSlice(aggregate, log.by_model[model]);
    }
  }
  return aggregate;
}

function aggregateAllModels(logs = []) {
  const models = new Set();
  for (const log of logs) {
    for (const model of Object.keys(log.by_model || {})) {
      models.add(model);
    }
  }
  return Object.fromEntries([...models].sort().map((model) => [model, aggregateModelLogs(logs, model)]));
}

function matchEvents(matches = {}, key) {
  return Number(matches[key] && matches[key].events || 0);
}

function deriveMetricSlice(slice = {}) {
  const totals = slice.totals || {};
  const matches = slice.matches || {};
  const tokens = slice.tokens || {};
  const timings = slice.timings_ms || {};
  const calls = slice.tool_calls_by_name || {};
  const failures = slice.tool_failures_by_name || {};
  const userMessages = Number(totals.user_messages || 0);
  const assistantMessages = Number(totals.assistant_messages || 0);
  const messages = userMessages + assistantMessages;
  const userHits = matchEvents(matches, 'user_1pt') + matchEvents(matches, 'user_2pt') + matchEvents(matches, 'user_patterns');
  const assistantHits = matchEvents(matches, 'assistant_1pt') + matchEvents(matches, 'assistant_2pt') + matchEvents(matches, 'assistant_patterns');
  const toolCalls = sumMap(calls);
  const toolFailures = sumMap(failures);

  return {
    friction: {
      total: round(ratio(userHits + assistantHits, messages)),
      user: round(ratio(userHits, userMessages)),
      assistant: round(ratio(assistantHits, assistantMessages)),
      numerator: userHits + assistantHits,
      denominator: messages,
    },
    cache_ratio: round(ratio(tokens.cache_read, Number(tokens.cache_read || 0) + Number(tokens.input || 0) + Number(tokens.cache_creation || 0))),
    reasoning_share: round(ratio(tokens.reasoning_output, tokens.output)),
    thinking_char_share: round(ratio(tokens.thinking_chars, Number(tokens.thinking_chars || 0) + Number(tokens.text_chars || 0))),
    tool_call_mix: shareMap(calls),
    tool_error_rate: round(ratio(toolFailures, toolCalls)),
    tool_error_rate_by_name: errorRateMap(calls, failures),
    timings_ms: {
      avg_turn: average(timings.turn_sum, timings.turn_count),
      avg_ttft: average(timings.ttft_sum, timings.ttft_count),
      avg_tool_latency: average(timings.tool_latency_sum, timings.tool_latency_count),
      output_tokens_per_sec: tokensPerSecond(tokens.output, timings.generation_sum),
    },
  };
}

function modelCoverage(logs = []) {
  const root = aggregateRootLogs(logs);
  const models = aggregateAllModels(logs);
  const known = Object.entries(models).filter(([model]) => model !== 'unknown');
  const knownTurns = known.reduce((sum, [, slice]) => sum + Number(slice.totals.turns || 0), 0);
  const knownTokens = known.reduce((sum, [, slice]) => sum + Number(slice.tokens.total || 0), 0);
  const unknown = models.unknown || emptyModelSlice();
  return {
    turns: round(ratio(knownTurns, root.totals.turns)),
    tokens: round(ratio(knownTokens, root.tokens.total)),
    known_turns: knownTurns,
    unknown_turns: Number(unknown.totals.turns || 0),
    known_tokens: knownTokens,
    unknown_tokens: Number(unknown.tokens.total || 0),
  };
}
// harn:end metric-aggregation-core

function resetTimeMs(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    return number < 100000000000 ? number * 1000 : number;
  }
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function nullableRound(value, digits = 2) {
  return Number.isFinite(value) ? round(value, digits) : null;
}

function groupedWindows(windows = []) {
  const groups = new Map();
  for (const sample of sortedWindowSamples(windows)) {
    const key = `${sample.kind}:${sample.resets_at}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(sample);
  }
  return groups;
}

// harn:assume rate-limit-local-estimates ref=rate-limit-derivations
function estimateWindow(samples = [], now = new Date()) {
  const sorted = sortedWindowSamples(samples);
  if (sorted.length === 0) {
    return null;
  }

  const statusByTime = new Map();
  const deltasByTime = new Map();
  let localTokensObserved = 0;
  for (const sample of sorted) {
    const sampledAt = sample.sampled_at;
    const delta = Number(sample.observed_tokens_delta || 0);
    localTokensObserved += delta;
    deltasByTime.set(sampledAt, (deltasByTime.get(sampledAt) || 0) + delta);
    const previous = statusByTime.get(sampledAt);
    if (!previous || Number(sample.used_percent || 0) >= Number(previous.used_percent || 0)) {
      statusByTime.set(sampledAt, sample);
    }
  }

  const statuses = sortedWindowSamples([...statusByTime.values()]);
  const first = statuses[0];
  const latest = statuses[statuses.length - 1];
  const firstMs = Date.parse(first.sampled_at || '');
  const latestMs = Date.parse(latest.sampled_at || '');
  const elapsedHours = (latestMs - firstMs) / 3600000;
  const percentDelta = Number(latest.used_percent || 0) - Number(first.used_percent || 0);
  const percentBurn = elapsedHours > 0 && percentDelta > 0 ? percentDelta / elapsedHours : null;

  const deltaTimes = [...deltasByTime.keys()].sort((a, b) => Date.parse(a) - Date.parse(b));
  const localBurnHours = deltaTimes.length > 1
    ? (Date.parse(deltaTimes[deltaTimes.length - 1]) - Date.parse(deltaTimes[0])) / 3600000
    : 0;
  const localBurnTokens = deltaTimes.slice(1).reduce((sum, timestamp) => sum + deltasByTime.get(timestamp), 0);
  const localTokenBurn = localBurnHours > 0 && localBurnTokens > 0 ? localBurnTokens / localBurnHours : null;

  const usedPercent = Number(latest.used_percent || 0);
  // Local token deltas cover all transcripts observed on this machine, while
  // used_percent is account-wide; this allowance is intentionally a local estimate.
  const localAllowance = usedPercent > 0 && localTokensObserved > 0
    ? localTokensObserved / (usedPercent / 100)
    : null;
  const localRemaining = localAllowance == null ? null : Math.max(0, localAllowance - localTokensObserved);
  const localEta = localRemaining != null && localTokenBurn > 0 ? localRemaining / localTokenBurn : null;
  const percentEta = percentBurn > 0 ? (100 - usedPercent) / percentBurn : null;
  const resetMs = resetTimeMs(latest.resets_at);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const timeToReset = resetMs == null || !Number.isFinite(nowMs) ? null : Math.max(0, (resetMs - nowMs) / 3600000);

  return {
    kind: latest.kind,
    usedPercent,
    burnPctPointsPerHour: nullableRound(percentBurn),
    percentTimeToExhaustHrs: nullableRound(percentEta),
    timeToResetHrs: nullableRound(timeToReset),
    resetsFirst: percentEta != null && timeToReset != null ? timeToReset < percentEta : null,
    localTokensObserved,
    localTokenBurnPerHour: nullableRound(localTokenBurn),
    localAllowanceEstimate: nullableRound(localAllowance),
    localTimeToExhaustHrs: nullableRound(localEta),
    sampledAt: latest.sampled_at,
    resetsAt: latest.resets_at,
  };
}

function currentRateLimits(windows = [], options = {}) {
  const now = options.now || new Date();
  const trailingMs = new Date(now).getTime() - 14 * 86400000;
  const groups = [...groupedWindows(windows).values()];
  const estimates = groups.map((samples) => estimateWindow(samples, now)).filter(Boolean);
  const result = {};

  for (const kind of ['5h', 'weekly']) {
    const matching = estimates
      .filter((estimate) => estimate.kind === kind)
      .sort((a, b) => Date.parse(a.sampledAt || '') - Date.parse(b.sampledAt || ''));
    const current = matching[matching.length - 1] || null;
    const rolling = median(matching
      .filter((estimate) => Date.parse(estimate.sampledAt || '') >= trailingMs)
      .map((estimate) => estimate.localAllowanceEstimate));
    result[kind === '5h' ? 'fiveHour' : 'weekly'] = current
      ? { ...current, localAllowanceEstimateRolling: nullableRound(rolling) }
      : null;
  }
  return result;
}
// harn:end rate-limit-local-estimates

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
  aggregateAllModels,
  aggregateModelLogs,
  aggregateRootLogs,
  apiMetricsDays,
  currentRateLimits,
  deriveMetricSlice,
  estimateWindow,
  metricsForLog,
  modelCoverage,
  windowMetrics,
};
