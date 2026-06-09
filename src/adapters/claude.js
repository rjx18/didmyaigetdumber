'use strict';

const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'MessageDisplay',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'StopFailure',
  'SessionEnd',
];

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return '';
}

function eventName(payload = {}) {
  return firstString(payload.hook_event_name, payload.event_type, payload.event, payload.type);
}

function userText(payload = {}) {
  return firstString(payload.prompt, payload.message, payload.text, payload.input);
}

function assistantText(payload = {}) {
  const message = payload.message && typeof payload.message === 'object' ? payload.message : {};
  return firstString(payload.text, payload.content, payload.message, message.text, message.content);
}

// harn:assume live-attribution-reconciliation ref=claude-adapter
function normalizeClaudePayload(payload = {}) {
  const type = eventName(payload);
  const normalized = {
    agent: 'claude',
    event_type: type || 'unknown',
    scope: null,
    text: '',
    flags: {},
  };

  if (type === 'SessionStart') {
    normalized.flags.session_start = true;
    return normalized;
  }

  if (type === 'UserPromptSubmit') {
    normalized.scope = 'user';
    normalized.text = userText(payload);
    return normalized;
  }

  if (type === 'MessageDisplay') {
    normalized.scope = 'assistant';
    normalized.text = assistantText(payload);
    return normalized;
  }

  if (type === 'PostToolUse') {
    normalized.flags.tool_call = true;
    return normalized;
  }

  if (type === 'PostToolUseFailure') {
    normalized.flags.tool_call = true;
    normalized.flags.tool_failure = true;
    return normalized;
  }

  if (type === 'PermissionRequest') {
    normalized.flags.permission_request = true;
    return normalized;
  }

  if (type === 'PermissionDenied') {
    normalized.flags.permission_denied = true;
    return normalized;
  }

  if (type === 'StopFailure') {
    normalized.flags.runtime_interrupt = true;
    return normalized;
  }

  return normalized;
}
// harn:end live-attribution-reconciliation

module.exports = {
  CLAUDE_HOOK_EVENTS,
  normalizeClaudePayload,
};
