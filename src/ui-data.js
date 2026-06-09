'use strict';

const { listDailyDates } = require('./report');
const { emptyModelSlice, localDate, readDailyLog } = require('./log-store');
const {
  aggregateAllModels,
  aggregateModelLogs,
  aggregateRootLogs,
  currentRateLimits,
  deriveMetricSlice,
  metricsForLog,
  modelCoverage,
  windowMetrics,
} = require('./metrics');

const STATUS_THRESHOLDS = {
  friction: 0.085,
  cache: 0.6,
  toolError: 0.09,
};

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function div(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function parseDays(value, fallback = 30) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function calendarDates(asOf, count) {
  const end = new Date(`${asOf}T12:00:00`);
  const dates = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setDate(end.getDate() - offset);
    dates.push(localDate(date));
  }
  return dates;
}

function logForModel(date, slice) {
  const model = slice || emptyModelSlice();
  return {
    date,
    totals: model.totals,
    matches: model.matches,
    tokens: model.tokens,
    tool_output_chars: model.tool_output_chars,
    tool_calls_by_name: model.tool_calls_by_name,
    tool_failures_by_name: model.tool_failures_by_name,
    model_tokens: {},
    timings_ms: model.timings_ms,
    tool_latency_ms_by_name: model.tool_latency_ms_by_name,
    windows: [],
  };
}

function sumMap(map = {}) {
  return Object.values(map).reduce((sum, value) => sum + num(value), 0);
}

function buildSeries(logs, slices = logs) {
  const friction = { total: [], user: [], assistant: [], t1: [], t2: [] };
  const activity = { sessions: [], turns: [], messages: [], userMsgs: [], asstMsgs: [], interrupts: [], compactions: [] };
  const tokens = { total: [], comp: { input: [], output: [], cacheRead: [], cacheCreate: [], reasoning: [] }, perSession: [] };
  const cache = { hit: [] };
  const reasoning = { codex: [], claude: [] };
  const tools = { perMsg: [], mix: [] };
  const timing = { turnDuration: [], ttft: [], throughput: [], toolLatency: [] };
  const callAgg = {};
  const failAgg = {};
  const outAgg = {};

  slices.forEach((slice, i) => {
    const m = metricsForLog(slice);
    const userMsgs = num(slice.totals.user_messages);
    const asstMsgs = num(slice.totals.assistant_messages);
    const messages = userMsgs + asstMsgs;
    const derived = deriveMetricSlice(slice);
    const t1 = num(slice.matches.user_1pt && slice.matches.user_1pt.events)
      + num(slice.matches.assistant_1pt && slice.matches.assistant_1pt.events);
    const t2 = num(slice.matches.user_2pt && slice.matches.user_2pt.events)
      + num(slice.matches.assistant_2pt && slice.matches.assistant_2pt.events);

    friction.total.push(round(derived.friction.total * 100, 3));
    friction.user.push(round(derived.friction.user * 100, 3));
    friction.assistant.push(round(derived.friction.assistant * 100, 3));
    friction.t1.push(round(div(t1, messages) * 100, 3));
    friction.t2.push(round(div(t2, messages) * 100, 3));
    activity.sessions.push(num(slice.totals.sessions));
    activity.turns.push(num(slice.totals.turns));
    activity.messages.push(messages);
    activity.userMsgs.push(userMsgs);
    activity.asstMsgs.push(asstMsgs);
    activity.interrupts.push(num(slice.totals.runtime_interrupts));
    activity.compactions.push(num(slice.totals.compactions));
    tokens.total.push(num(m.tokens.total));
    tokens.comp.input.push(num(m.tokens.input));
    tokens.comp.output.push(num(m.tokens.output));
    tokens.comp.cacheRead.push(num(m.tokens.cache_read));
    tokens.comp.cacheCreate.push(num(m.tokens.cache_creation));
    tokens.comp.reasoning.push(num(m.tokens.reasoning_output));
    tokens.perSession.push(Math.round(div(num(m.tokens.total), num(slice.totals.sessions))));
    cache.hit.push(num(m.cache_ratio));
    reasoning.codex.push(num(m.reasoning_share));
    reasoning.claude.push(num(m.thinking_char_share));
    tools.perMsg.push(round(div(num(slice.totals.tool_calls), messages), 3));
    timing.turnDuration.push(round(div(num(m.timings_ms.avg_turn), 1000), 2));
    timing.ttft.push(num(m.timings_ms.avg_ttft));
    timing.throughput.push(num(m.timings_ms.output_tokens_per_sec));
    timing.toolLatency.push(num(m.timings_ms.avg_tool_latency));

    for (const [name, count] of Object.entries(slice.tool_calls_by_name || {})) {
      callAgg[name] = (callAgg[name] || 0) + num(count);
    }
    for (const [name, count] of Object.entries(slice.tool_failures_by_name || {})) {
      failAgg[name] = (failAgg[name] || 0) + num(count);
    }
    for (const [name, count] of Object.entries(slice.tool_output_chars || {})) {
      outAgg[name] = (outAgg[name] || 0) + num(count);
    }
  });

  tools.mix = Object.keys(callAgg)
    .map((name) => ({
      name,
      count: callAgg[name],
      errRate: round(div(failAgg[name] || 0, callAgg[name]), 4),
      outChars: outAgg[name] || 0,
    }))
    .sort((a, b) => b.count - a.count);

  return { friction, activity, tokens, cache, reasoning, tools, timing };
}

function rollingValue(current, previous) {
  const change = current - previous;
  return {
    current: round(current),
    previous: round(previous),
    change: round(change),
    changeRatio: previous === 0 ? null : round(change / Math.abs(previous)),
  };
}

function rollingMetrics(current, previous, days = 14) {
  const currentDerived = deriveMetricSlice(current);
  const previousDerived = deriveMetricSlice(previous);
  const currentMessages = num(current.totals.user_messages) + num(current.totals.assistant_messages);
  const previousMessages = num(previous.totals.user_messages) + num(previous.totals.assistant_messages);
  return {
    friction: rollingValue(currentDerived.friction.total, previousDerived.friction.total),
    cacheHit: rollingValue(currentDerived.cache_ratio, previousDerived.cache_ratio),
    reasoningShare: rollingValue(currentDerived.reasoning_share, previousDerived.reasoning_share),
    thinkingShare: rollingValue(currentDerived.thinking_char_share, previousDerived.thinking_char_share),
    toolError: rollingValue(currentDerived.tool_error_rate, previousDerived.tool_error_rate),
    toolsPerMessage: rollingValue(div(sumMap(current.tool_calls_by_name), currentMessages), div(sumMap(previous.tool_calls_by_name), previousMessages)),
    avgTurnMs: rollingValue(currentDerived.timings_ms.avg_turn, previousDerived.timings_ms.avg_turn),
    avgTtftMs: rollingValue(currentDerived.timings_ms.avg_ttft, previousDerived.timings_ms.avg_ttft),
    avgToolLatencyMs: rollingValue(currentDerived.timings_ms.avg_tool_latency, previousDerived.timings_ms.avg_tool_latency),
    throughput: rollingValue(currentDerived.timings_ms.output_tokens_per_sec, previousDerived.timings_ms.output_tokens_per_sec),
    tokensPerDay: rollingValue(div(num(current.tokens.total), days), div(num(previous.tokens.total), days)),
    sessionsPerDay: rollingValue(div(num(current.totals.sessions), days), div(num(previous.totals.sessions), days)),
    messagesPerDay: rollingValue(div(currentMessages, days), div(previousMessages, days)),
  };
}

function statusFor(rolling, aggregate) {
  const messages = num(aggregate.totals.user_messages) + num(aggregate.totals.assistant_messages);
  const signals = {
    friction: { value: rolling.friction.current, threshold: STATUS_THRESHOLDS.friction, degraded: rolling.friction.current > STATUS_THRESHOLDS.friction },
    cache: { value: rolling.cacheHit.current, threshold: STATUS_THRESHOLDS.cache, degraded: rolling.cacheHit.current < STATUS_THRESHOLDS.cache },
    toolError: { value: rolling.toolError.current, threshold: STATUS_THRESHOLDS.toolError, degraded: rolling.toolError.current > STATUS_THRESHOLDS.toolError },
  };
  return {
    verdict: messages === 0 ? 'insufficient-data' : Object.values(signals).some((signal) => signal.degraded) ? 'degraded' : 'healthy',
    signals,
  };
}

function modelCoverageFor(model, modelAggregate, rootAggregate) {
  return {
    model,
    turns: round(div(num(modelAggregate.totals.turns), num(rootAggregate.totals.turns))),
    tokens: round(div(num(modelAggregate.tokens.total), num(rootAggregate.tokens.total))),
  };
}

function compatibilityLimits(windows, corrected) {
  const derived = windowMetrics(windows);
  const fiveHour = derived.filter((sample) => sample.kind === '5h');
  const weekly = derived.filter((sample) => sample.kind === 'weekly');
  const latest5h = fiveHour[fiveHour.length - 1] || null;
  const latestWeekly = weekly[weekly.length - 1] || null;
  const windowHistory = latest5h
    ? fiveHour.filter((sample) => sample.resets_at === latest5h.resets_at).map((sample) => round(num(sample.used_percent) / 100, 4))
    : [];
  return {
    ...corrected,
    windowUsedPct: latest5h ? round(num(latest5h.used_percent) / 100, 4) : 0,
    weeklyUsedPct: latestWeekly ? round(num(latestWeekly.used_percent) / 100, 4) : 0,
    burnRate: latest5h ? num(latest5h.burn_rate_tokens_per_hour) : 0,
    windowHistory,
  };
}

// harn:assume rolling-status-metrics-api ref=ui-data-builder
function buildUiData(options = {}) {
  const visibleDays = parseDays(options.days);
  const availableDates = listDailyDates(options);
  const asOf = options.asOf || availableDates[availableDates.length - 1] || localDate();
  const dates = calendarDates(asOf, visibleDays);
  const logs = dates.map((date) => readDailyLog(date, options));
  const actualDates = new Set(availableDates);
  const activityDays = dates.filter((date) => actualDates.has(date)).length;
  const series = buildSeries(logs);

  const rollingDates = calendarDates(asOf, 28);
  const rollingLogs = rollingDates.map((date) => readDailyLog(date, options));
  const previousLogs = rollingLogs.slice(0, 14);
  const currentLogs = rollingLogs.slice(14);
  const currentRoot = aggregateRootLogs(currentLogs);
  const previousRoot = aggregateRootLogs(previousLogs);
  const rootRolling = rollingMetrics(currentRoot, previousRoot);
  const modelsById = aggregateAllModels(logs);
  const rootAggregate = aggregateRootLogs(logs);

  const models = Object.entries(modelsById)
    .map(([id, aggregate]) => ({ id, name: id, tokens: num(aggregate.tokens.total), attributedTurns: num(aggregate.totals.turns) }))
    .sort((a, b) => b.tokens - a.tokens);

  const byModel = {};
  for (const { id } of models) {
    const modelSlices = logs.map((log) => logForModel(log.date, log.by_model[id]));
    const currentModel = aggregateModelLogs(currentLogs, id);
    const previousModel = aggregateModelLogs(previousLogs, id);
    const rolling = rollingMetrics(currentModel, previousModel);
    const modelSeries = buildSeries(logs, modelSlices);
    byModel[id] = {
      series: modelSeries,
      aggregates: { tools: modelSeries.tools.mix },
      rolling,
      status: statusFor(rolling, currentModel),
      coverage: modelCoverageFor(id, aggregateModelLogs(logs, id), rootAggregate),
    };
  }

  const allLogs = availableDates.map((date) => readDailyLog(date, options));
  const allWindows = allLogs.flatMap((log) => log.windows || []);
  const correctedLimits = currentRateLimits(allWindows, { now: options.now || new Date() });
  const limits = compatibilityLimits(allWindows, correctedLimits);
  const all = {
    series,
    aggregates: { tools: series.tools.mix, models },
    rolling: rootRolling,
    status: statusFor(rootRolling, currentRoot),
    coverage: modelCoverage(logs),
  };

  return {
    apiVersion: 2,
    range: { days: visibleDays, granularity: 'day', timezone: 'local', start: dates[0], end: dates[dates.length - 1] },
    N: activityDays,
    days: dates,
    models,
    account: {
      series: {
        sessions: series.activity.sessions,
        permissionRequests: logs.map((log) => num(log.totals.permission_requests)),
        permissionDenied: logs.map((log) => num(log.totals.permission_denied)),
        interrupts: series.activity.interrupts,
        compactions: series.activity.compactions,
      },
      aggregates: {},
    },
    all,
    byModel,
    limits,
    ...series,
  };
}
// harn:end rolling-status-metrics-api

module.exports = {
  STATUS_THRESHOLDS,
  buildUiData,
  calendarDates,
  rollingMetrics,
};
