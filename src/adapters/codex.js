'use strict';

const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'StopFailure',
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
  return firstString(
    payload.hook_event_name,
    payload.event_type,
    payload.event,
    payload.type,
    payload.name,
    payload.payload && payload.payload.hook_event_name,
    payload.payload && payload.payload.event_type,
    payload.payload && payload.payload.type,
  );
}

function userText(payload = {}) {
  const inner = payload.payload || {};
  return firstString(
    payload.prompt,
    payload.user_prompt,
    payload.userPrompt,
    payload.message,
    payload.text,
    payload.input,
    inner.prompt,
    inner.user_prompt,
    inner.userPrompt,
    inner.message,
    inner.text,
    inner.input,
  );
}

function failed(payload = {}) {
  const inner = payload.payload || {};
  return Boolean(
    payload.failed ||
    payload.error ||
    payload.status === 'failed' ||
    payload.status === 'error' ||
    inner.failed ||
    inner.error ||
    inner.status === 'failed' ||
    inner.status === 'error'
  );
}

function denied(payload = {}) {
  const inner = payload.payload || {};
  return Boolean(
    payload.denied ||
    payload.rejected ||
    payload.status === 'denied' ||
    payload.status === 'rejected' ||
    inner.denied ||
    inner.rejected ||
    inner.status === 'denied' ||
    inner.status === 'rejected'
  );
}

// harn:assume codex-live-hook-counting ref=codex-adapter
function normalizeCodexPayload(payload = {}) {
  const type = eventName(payload);
  const normalized = {
    agent: 'codex',
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

  if (type === 'PostToolUse') {
    normalized.flags.tool_call = true;
    normalized.flags.tool_failure = failed(payload);
    return normalized;
  }

  if (type === 'PermissionRequest') {
    normalized.flags.permission_request = true;
    normalized.flags.permission_denied = denied(payload);
    return normalized;
  }

  if (type === 'StopFailure' || type === 'turn_aborted' || type === 'error') {
    normalized.flags.runtime_interrupt = true;
    return normalized;
  }

  if (type === 'Stop' && (payload.interrupted || payload.cancelled || payload.canceled)) {
    normalized.flags.runtime_interrupt = true;
    return normalized;
  }

  return normalized;
}
// harn:end codex-live-hook-counting

module.exports = {
  CODEX_HOOK_EVENTS,
  normalizeCodexPayload,
};
