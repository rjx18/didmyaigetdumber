'use strict';

const { normalizeCodexPayload } = require('./adapters/codex');
const { normalizeClaudePayload } = require('./adapters/claude');
const { incrementFromEvent } = require('./events');
const { updateDailyLog, localDate } = require('./log-store');
const { matchPatterns } = require('./patterns');

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
  updateDailyLog(dateForPayload(payload, options), increment, options);
  return 0;
}
// harn:end claude-live-hook-counting
// harn:end codex-live-hook-counting

module.exports = { handleHook };
