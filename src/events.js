'use strict';

const { emptyIncrement } = require('./log-store');

const DEFAULT_FLAGS = {
  tool_call: false,
  tool_failure: false,
  permission_request: false,
  permission_denied: false,
  runtime_interrupt: false,
  session_start: false,
};

// harn:assume normalized-event-increments ref=event-increment-model
function createNormalizedEvent(input = {}) {
  return {
    agent: input.agent || 'unknown',
    event_type: input.event_type || 'unknown',
    scope: input.scope || null,
    text: input.text || '',
    pattern_match: input.pattern_match || null,
    flags: {
      ...DEFAULT_FLAGS,
      ...(input.flags || {}),
    },
  };
}

function incrementFromEvent(input = {}) {
  const event = createNormalizedEvent(input);
  const increment = emptyIncrement();

  if (event.flags.session_start) {
    increment.totals.sessions += 1;
  }
  if (event.flags.tool_call) {
    increment.totals.tool_calls += 1;
  }
  if (event.flags.tool_failure) {
    increment.totals.tool_failures += 1;
  }
  if (event.flags.permission_request) {
    increment.totals.permission_requests += 1;
  }
  if (event.flags.permission_denied) {
    increment.totals.permission_denied += 1;
  }
  if (event.flags.runtime_interrupt) {
    increment.totals.runtime_interrupts += 1;
  }

  if (event.scope === 'user') {
    increment.totals.user_messages += 1;
    if (event.pattern_match && event.pattern_match.matched) {
      increment.matches.user_patterns.events += 1;
      increment.matches.user_patterns.line_hits += event.pattern_match.lineHits || 0;
    }
  }

  if (event.scope === 'assistant') {
    increment.totals.assistant_messages += 1;
    if (event.pattern_match && event.pattern_match.matched) {
      increment.matches.assistant_patterns.events += 1;
      increment.matches.assistant_patterns.line_hits += event.pattern_match.lineHits || 0;
    }
  }

  return increment;
}
// harn:end normalized-event-increments

module.exports = {
  DEFAULT_FLAGS,
  createNormalizedEvent,
  incrementFromEvent,
};
