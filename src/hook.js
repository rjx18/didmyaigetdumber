'use strict';

const { normalizeCodexPayload } = require('./adapters/codex');
const { normalizeClaudePayload } = require('./adapters/claude');
const { incrementFromEvent } = require('./events');
const { updateDailyLog, localDate } = require('./log-store');
const { tailJsonlTranscript } = require('./offset-store');
const { matchPatterns } = require('./patterns');
const { extractClaudeMetrics } = require('./extractors/claude');
const { extractCodexMetrics } = require('./extractors/codex');

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
  return increment.totals.turns > 0
    || increment.totals.compactions > 0
    || Object.values(increment.tokens).some((value) => value > 0)
    || Object.keys(increment.tool_output_chars).length > 0
    || Object.keys(increment.tool_calls_by_name).length > 0
    || Object.keys(increment.tool_failures_by_name).length > 0
    || Object.keys(increment.model_tokens).length > 0
    || Object.values(increment.timings_ms).some((value) => value > 0)
    || Object.keys(increment.tool_latency_ms_by_name).length > 0
    || increment.windows.length > 0;
}

// harn:assume live-hook-numeric-tail-integration ref=hook-tail
function liveTailIncrement(agent, payload, normalized, options = {}) {
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
    const increment = agent === 'claude'
      ? extractClaudeMetrics(tail.records)
      : extractCodexMetrics(tail.records);
    return hasMetricData(increment) ? increment : null;
  } catch (_error) {
    return null;
  }
}
// harn:end live-hook-numeric-tail-integration

// harn:assume codex-live-hook-counting ref=hook-runner
// harn:assume claude-live-hook-counting ref=hook-agent-routing
async function handleHook(options = {}, io) {
  const payload = options.payload || parsePayload(await readStdin(io.stdin));
  const agent = detectAgent(payload, options);
  const normalized = agent === 'claude'
    ? normalizeClaudePayload(payload)
    : normalizeCodexPayload(payload);

  if (normalized.scope && normalized.text) {
    normalized.pattern_match = matchPatterns(normalized.scope, normalized.text);
  }

  const increment = incrementFromEvent(normalized);
  const date = dateForPayload(payload, options);
  updateDailyLog(date, increment, options);

  const metricsIncrement = liveTailIncrement(agent, payload, normalized, options);
  if (metricsIncrement) {
    updateDailyLog(date, metricsIncrement, options);
  }
  return 0;
}
// harn:end claude-live-hook-counting
// harn:end codex-live-hook-counting

module.exports = {
  handleHook,
  liveTailIncrement,
  shouldTailTranscript,
};
