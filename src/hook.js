'use strict';

const { normalizeCodexPayload } = require('./adapters/codex');
const { normalizeClaudePayload } = require('./adapters/claude');
const { incrementFromEvent } = require('./events');
const { ensureDailyLog, updateDailyLog, localDate } = require('./log-store');
const { tailJsonlTranscript } = require('./offset-store');
const { matchPatterns } = require('./patterns');
const { extractClaudeMetricsByDate, extractClaudeMetricsByHour } = require('./extractors/claude');
const { extractCodexMetricsByDate, extractCodexMetricsByHour } = require('./extractors/codex');
const { localHour, updateHourlyLog } = require('./hourly-store');

async function readStdin(stdin) {
  let input = '';
  for await (const chunk of stdin) {
    input += chunk;
  }
  return input;
}

function parsePayload(input) {
  if (!input || !input.trim()) {
    return {};
  }
  return JSON.parse(input);
}

function dateForPayload(payload, options = {}) {
  if (options.date) {
    return options.date;
  }
  const timestamp = payload.observed_at || payload.timestamp || (payload.payload && payload.payload.timestamp);
  if (timestamp) {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return localDate(parsed);
    }
  }
  return localDate();
}

function hourForPayload(payload, options = {}) {
  const timestamp = payload.observed_at || payload.timestamp || (payload.payload && payload.payload.timestamp);
  const observedHour = timestamp ? localHour(timestamp) : '';
  const fallback = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  return observedHour || `${options.date || localDate(fallback)}T${String(fallback.getHours()).padStart(2, '0')}`;
}

function detectAgent(payload, options = {}) {
  if (options.agent) {
    return options.agent;
  }
  if (process.env.DIDMYAIGETDUMBER_AGENT) {
    return process.env.DIDMYAIGETDUMBER_AGENT;
  }
  if (payload.agent === 'claude' || payload.hook_event_name) {
    return 'claude';
  }
  return 'codex';
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return '';
}

function transcriptPath(payload = {}) {
  const inner = payload.payload || {};
  return firstString(payload.transcript_path, payload.transcriptPath, inner.transcript_path, inner.transcriptPath);
}

function sessionId(payload = {}) {
  const inner = payload.payload || {};
  return firstString(payload.session_id, payload.sessionId, payload.conversation_id, inner.session_id, inner.sessionId, inner.conversation_id);
}

function shouldTailTranscript(agent, eventType) {
  if (agent === 'codex') {
    return eventType === 'Stop' || eventType === 'StopFailure';
  }
  if (agent === 'claude') {
    return eventType === 'SessionEnd' || eventType === 'StopFailure';
  }
  return false;
}

function hasMetricData(increment) {
  return Object.values(increment.totals).some((value) => value > 0)
    || Object.values(increment.matches).some((match) => match.events > 0 || match.line_hits > 0)
    || Object.values(increment.tokens).some((value) => value > 0)
    || Object.keys(increment.tool_output_chars).length > 0
    || Object.keys(increment.tool_calls_by_name).length > 0
    || Object.keys(increment.tool_failures_by_name).length > 0
    || Object.keys(increment.by_model).length > 0
    || Object.values(increment.timings_ms).some((value) => value > 0)
    || Object.keys(increment.tool_latency_ms_by_name).length > 0
    || increment.windows.length > 0;
}

// harn:assume live-attribution-reconciliation ref=hook-tail
function liveTailIncrementsByDate(agent, payload, normalized, options = {}) {
  const result = liveTailIncrements(agent, payload, normalized, options);
  return result && result.dayMap;
}

// harn:assume sub-daily-hourly-storage ref=hourly-live-tail
function liveTailIncrements(agent, payload, normalized, options = {}) {
  if (!shouldTailTranscript(agent, normalized.event_type)) {
    return null;
  }

  const filePath = transcriptPath(payload);
  if (!filePath) {
    return null;
  }

  try {
    const tail = tailJsonlTranscript(agent, {
      sessionId: sessionId(payload),
      transcriptPath: filePath,
    }, options);
    const dayMap = agent === 'claude'
      ? extractClaudeMetricsByDate(tail.records, { fallbackDate: dateForPayload(payload, options) })
      : extractCodexMetricsByDate(tail.records, { fallbackDate: dateForPayload(payload, options) });
    const hourMap = agent === 'claude'
      ? extractClaudeMetricsByHour(tail.records, { fallbackHour: hourForPayload(payload, options) })
      : extractCodexMetricsByHour(tail.records, { fallbackHour: hourForPayload(payload, options) });
    for (const [date, increment] of [...dayMap]) {
      if (!hasMetricData(increment)) {
        dayMap.delete(date);
      }
    }
    for (const [hour, increment] of [...hourMap]) {
      if (!hasMetricData(increment)) {
        hourMap.delete(hour);
      }
    }
    return dayMap.size > 0 || hourMap.size > 0 ? { dayMap, hourMap } : null;
  } catch (_error) {
    return null;
  }
}
// harn:end sub-daily-hourly-storage
// harn:end live-attribution-reconciliation

// harn:assume live-attribution-reconciliation ref=hook-runner
async function handleHook(options = {}, io) {
  const payload = options.payload || parsePayload(await readStdin(io.stdin));
  const agent = detectAgent(payload, options);
  const normalized = agent === 'claude'
    ? normalizeClaudePayload(payload)
    : normalizeCodexPayload(payload);

  const date = dateForPayload(payload, options);
  if (normalized.event_type === 'SessionStart') {
    ensureDailyLog(date, options);
    return 0;
  }

  if (normalized.scope && normalized.text) {
    normalized.pattern_match = matchPatterns(normalized.scope, normalized.text);
  }

  const increment = incrementFromEvent(normalized);
  updateDailyLog(date, increment, options);
  if (hasMetricData(increment)) {
    updateHourlyLog(hourForPayload(payload, options), increment, options);
  }

  const tailIncrements = liveTailIncrements(agent, payload, normalized, options);
  if (tailIncrements) {
    for (const [metricDate, metricsIncrement] of tailIncrements.dayMap) {
      updateDailyLog(metricDate, metricsIncrement, options);
    }
    for (const [metricHour, metricsIncrement] of tailIncrements.hourMap) {
      updateHourlyLog(metricHour, metricsIncrement, options);
    }
  }
  return 0;
}
// harn:end live-attribution-reconciliation

module.exports = {
  handleHook,
  liveTailIncrements,
  liveTailIncrementsByDate,
  shouldTailTranscript,
};
