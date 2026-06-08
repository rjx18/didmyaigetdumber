'use strict';

const { listDailyDates } = require('./report');
const { readDailyLog } = require('./log-store');
const { metricsForLog } = require('./metrics');

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

function matchEvents(log, key) {
  return num(log.matches && log.matches[key] && log.matches[key].events);
}

function parseDays(value, fallback = 30) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function newestSampleOfKind(windows, kind) {
  const matching = windows
    .filter((sample) => sample.kind === kind)
    .sort((a, b) => Date.parse(a.sampled_at || '') - Date.parse(b.sampled_at || ''));
  return matching.length ? matching[matching.length - 1] : null;
}

// harn:assume ui-aggregate-data-endpoint ref=ui-data-builder
// Assemble one frontend-shaped, aggregate-only payload from the daily logs.
// Per-day series plus range-aggregated tool mix, model totals, and window samples.
// Numeric counters and safe tool/model labels only — never raw content.
function buildUiData(options = {}) {
  const days = parseDays(options.days);
  const dates = listDailyDates(options).slice(-days);
  const logs = dates.map((date) => readDailyLog(date, options));
  const metrics = logs.map((log) => metricsForLog(log));

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
  const modelAgg = {};
  const allWindows = [];

  logs.forEach((log, i) => {
    const m = metrics[i];
    const userMsgs = num(log.totals.user_messages);
    const asstMsgs = num(log.totals.assistant_messages);
    const messages = userMsgs + asstMsgs;

    const u1 = matchEvents(log, 'user_1pt');
    const u2 = matchEvents(log, 'user_2pt');
    const a1 = matchEvents(log, 'assistant_1pt');
    const a2 = matchEvents(log, 'assistant_2pt');
    const userHits = u1 + u2 + matchEvents(log, 'user_patterns');
    const asstHits = a1 + a2 + matchEvents(log, 'assistant_patterns');
    const totalHits = userHits + asstHits;

    friction.total.push(round(div(totalHits, messages) * 100, 3));
    friction.user.push(round(div(userHits, userMsgs) * 100, 3));
    friction.assistant.push(round(div(asstHits, asstMsgs) * 100, 3));
    friction.t1.push(round(div(u1 + a1, messages) * 100, 3));
    friction.t2.push(round(div(u2 + a2, messages) * 100, 3));

    activity.sessions.push(num(log.totals.sessions));
    activity.turns.push(num(log.totals.turns));
    activity.messages.push(messages);
    activity.userMsgs.push(userMsgs);
    activity.asstMsgs.push(asstMsgs);
    activity.interrupts.push(num(log.totals.runtime_interrupts));
    activity.compactions.push(num(log.totals.compactions));

    tokens.total.push(num(m.tokens.total));
    tokens.comp.input.push(num(m.tokens.input));
    tokens.comp.output.push(num(m.tokens.output));
    tokens.comp.cacheRead.push(num(m.tokens.cache_read));
    tokens.comp.cacheCreate.push(num(m.tokens.cache_creation));
    tokens.comp.reasoning.push(num(m.tokens.reasoning_output));
    tokens.perSession.push(Math.round(div(num(m.tokens.total), num(log.totals.sessions))));

    cache.hit.push(num(m.cache_ratio));
    reasoning.codex.push(num(m.reasoning_share));
    reasoning.claude.push(num(m.thinking_char_share));

    tools.perMsg.push(round(div(num(log.totals.tool_calls), messages), 3));

    timing.turnDuration.push(round(div(num(m.timings_ms.avg_turn), 1000), 2));
    timing.ttft.push(num(m.timings_ms.avg_ttft));
    timing.throughput.push(num(m.timings_ms.output_tokens_per_sec));
    timing.toolLatency.push(num(m.timings_ms.avg_tool_latency));

    for (const [name, count] of Object.entries(log.tool_calls_by_name || {})) {
      callAgg[name] = (callAgg[name] || 0) + num(count);
    }
    for (const [name, count] of Object.entries(log.tool_failures_by_name || {})) {
      failAgg[name] = (failAgg[name] || 0) + num(count);
    }
    for (const [name, count] of Object.entries(log.tool_output_chars || {})) {
      outAgg[name] = (outAgg[name] || 0) + num(count);
    }
    for (const [model, counters] of Object.entries(log.model_tokens || {})) {
      modelAgg[model] = (modelAgg[model] || 0) + num(counters.total);
    }
    allWindows.push(...m.windows);
  });

  tools.mix = Object.keys(callAgg)
    .map((name) => ({
      name,
      count: callAgg[name],
      errRate: round(div(failAgg[name] || 0, callAgg[name]), 4),
      outChars: outAgg[name] || 0,
    }))
    .sort((a, b) => b.count - a.count);

  const models = Object.keys(modelAgg)
    .map((name) => ({ name, tokens: modelAgg[name] }))
    .sort((a, b) => b.tokens - a.tokens);

  const window5h = newestSampleOfKind(allWindows, '5h');
  const windowWeekly = newestSampleOfKind(allWindows, 'weekly');
  const windowHistory = window5h
    ? allWindows
      .filter((sample) => sample.kind === '5h' && sample.resets_at === window5h.resets_at)
      .sort((a, b) => Date.parse(a.sampled_at || '') - Date.parse(b.sampled_at || ''))
      .map((sample) => round(num(sample.used_percent) / 100, 4))
    : [];

  const limits = {
    windowUsedPct: window5h ? round(num(window5h.used_percent) / 100, 4) : 0,
    weeklyUsedPct: windowWeekly ? round(num(windowWeekly.used_percent) / 100, 4) : 0,
    burnRate: window5h ? num(window5h.burn_rate_tokens_per_hour) : 0,
    windowHistory,
  };

  return {
    N: dates.length,
    days: dates,
    friction,
    activity,
    tokens,
    cache,
    reasoning,
    tools,
    models,
    timing,
    limits,
  };
}
// harn:end ui-aggregate-data-endpoint

module.exports = {
  buildUiData,
};
