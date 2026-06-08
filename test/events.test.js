'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createNormalizedEvent,
  incrementFromEvent,
} = require('../src/events');

// harn:assume normalized-event-increments ref=event-increment-tests
test('creates normalized events without requiring raw text persistence', () => {
  const event = createNormalizedEvent({
    agent: 'codex',
    event_type: 'user_message',
    scope: 'user',
  });

  assert.equal(event.agent, 'codex');
  assert.equal(event.scope, 'user');
  assert.equal(event.text, '');
  assert.equal(event.flags.tool_call, false);
});

test('converts a matched user event to aggregate increments', () => {
  const increment = incrementFromEvent({
    scope: 'user',
    pattern_match: {
      matched: true,
      lineHits: 3,
      hits: [
        { category: 'user_1pt', file: 'user-1pt.md', line: 1 },
        { category: 'user_1pt', file: 'user-1pt.md', line: 2 },
        { category: 'user_2pt', file: 'user-2pt.md', line: 1 },
      ],
    },
  });

  assert.equal(increment.totals.user_messages, 1);
  assert.equal(increment.matches.user_1pt.events, 1);
  assert.equal(increment.matches.user_1pt.line_hits, 2);
  assert.equal(increment.matches.user_2pt.events, 1);
  assert.equal(increment.matches.user_2pt.line_hits, 1);
  assert.equal(increment.totals.assistant_messages, 0);
});

test('converts assistant, tool, permission, and runtime flags', () => {
  const increment = incrementFromEvent({
    scope: 'assistant',
    pattern_match: {
      matched: true,
      lineHits: 2,
      hits: [
        { category: 'assistant_1pt', file: 'assistant-1pt.md', line: 1 },
        { category: 'assistant_2pt', file: 'assistant-2pt.md', line: 1 },
      ],
    },
    flags: {
      session_start: true,
      tool_call: true,
      tool_failure: true,
      permission_request: true,
      permission_denied: true,
      runtime_interrupt: true,
    },
  });

  assert.equal(increment.totals.sessions, 1);
  assert.equal(increment.totals.assistant_messages, 1);
  assert.equal(increment.totals.tool_calls, 1);
  assert.equal(increment.totals.tool_failures, 1);
  assert.equal(increment.totals.permission_requests, 1);
  assert.equal(increment.totals.permission_denied, 1);
  assert.equal(increment.totals.runtime_interrupts, 1);
  assert.equal(increment.matches.assistant_1pt.events, 1);
  assert.equal(increment.matches.assistant_1pt.line_hits, 1);
  assert.equal(increment.matches.assistant_2pt.events, 1);
  assert.equal(increment.matches.assistant_2pt.line_hits, 1);
});
// harn:end normalized-event-increments
