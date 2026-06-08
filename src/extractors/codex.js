'use strict';

const { emptyIncrement } = require('../log-store');
const {
  addDuration,
  addMap,
  addTokenUsage,
  durationMs,
  incrementToolCall,
  incrementToolFailure,
  incrementToolOutput,
  isoTime,
  number,
  safeToolName,
} = require('./common');

function payloadOf(record = {}) {
  return record.payload && typeof record.payload === 'object' ? record.payload : {};
}

function timestampOf(record = {}) {
  const payload = payloadOf(record);
  return record.timestamp || payload.timestamp || record.ts || payload.ts || '';
}

function usageFromTokenRecord(payload = {}) {
  const info = payload.info && typeof payload.info === 'object' ? payload.info : payload;
  return info.last_token_usage || payload.last_token_usage || null;
}

function toolNameFromCall(payload = {}) {
  if (payload.type === 'web_search_call') {
    return 'web_search';
  }
  if (payload.type === 'custom_tool_call') {
    return payload.name || payload.tool_name || 'custom_tool';
  }
  return payload.name || payload.tool_name || payload.function || 'tool';
}

function isToolCall(payload = {}) {
  return payload.type === 'function_call'
    || payload.type === 'custom_tool_call'
    || payload.type === 'web_search_call';
}

function isFailure(payload = {}) {
  const status = String(payload.status || payload.outcome || '').toLowerCase();
  return payload.is_error === true
    || payload.error != null
    || status === 'failed'
    || status === 'error'
    || status === 'cancelled';
}

function outputValue(payload = {}) {
  return payload.output || payload.result || payload.content || payload.text || payload.message || '';
}

function windowKind(limit = {}) {
  if (Number(limit.window_minutes) === 300) {
    return '5h';
  }
  if (Number(limit.window_minutes) === 10080) {
    return 'weekly';
  }
  return limit.kind || 'window';
}

function addRateLimitSamples(increment, payload, timestamp, tokenTotals) {
  const sampledAt = isoTime(timestamp);
  const limits = payload.rate_limits && typeof payload.rate_limits === 'object' ? payload.rate_limits : {};
  if (!sampledAt) {
    return;
  }

  for (const key of ['primary', 'secondary']) {
    const limit = limits[key];
    if (!limit || typeof limit !== 'object') {
      continue;
    }
    const usedPercent = Number(limit.used_percent);
    if (!Number.isFinite(usedPercent) || usedPercent < 0 || !limit.resets_at) {
      continue;
    }
    const resetKey = String(limit.resets_at);
    const kind = windowKind(limit);
    const mapKey = `${kind}:${resetKey}`;
    increment.windows.push({
      kind,
      sampled_at: sampledAt,
      resets_at: limit.resets_at,
      used_percent: usedPercent,
      tokens_in_window: tokenTotals.get(mapKey) || 0,
    });
  }
}

// harn:assume numeric-transcript-extractors ref=codex-extractor
function extractCodexMetrics(records = []) {
  const increment = emptyIncrement();
  const state = {
    currentModel: '',
    callIdToTool: new Map(),
    callIdToStartedAt: new Map(),
    taskStartedAt: '',
    firstToolSeen: false,
    windowTokenTotals: new Map(),
  };

  for (const record of records) {
    if (!record || typeof record !== 'object') {
      continue;
    }
    const payload = payloadOf(record);
    const timestamp = timestampOf(record);

    if (record.type === 'turn_context' || payload.type === 'turn_context') {
      state.currentModel = payload.model || record.model || state.currentModel;
      continue;
    }

    if (record.type === 'event_msg' && payload.type === 'task_started') {
      state.taskStartedAt = timestamp;
      state.firstToolSeen = false;
      continue;
    }

    if (record.type === 'event_msg' && payload.type === 'task_complete') {
      const elapsed = durationMs(state.taskStartedAt, timestamp);
      addDuration(increment, 'turn_sum', 'turn_count', elapsed);
      addDuration(increment, 'generation_sum', 'generation_count', elapsed);
      if (elapsed) {
        increment.totals.turns += 1;
      }
      state.taskStartedAt = '';
      state.firstToolSeen = false;
      continue;
    }

    if (record.type === 'event_msg' && (payload.type === 'context_compacted' || payload.type === 'compacted')) {
      increment.totals.compactions += 1;
      continue;
    }

    if (record.type === 'event_msg' && payload.type === 'token_count') {
      const usage = usageFromTokenRecord(payload);
      if (usage) {
        const tokens = addTokenUsage(increment, usage, state.currentModel);
        const limits = payload.rate_limits && typeof payload.rate_limits === 'object' ? payload.rate_limits : {};
        for (const key of ['primary', 'secondary']) {
          const limit = limits[key];
          if (!limit || !limit.resets_at) {
            continue;
          }
          const kind = windowKind(limit);
          const mapKey = `${kind}:${limit.resets_at}`;
          state.windowTokenTotals.set(mapKey, (state.windowTokenTotals.get(mapKey) || 0) + number(tokens.total));
        }
      }
      addRateLimitSamples(increment, payload, timestamp, state.windowTokenTotals);
      continue;
    }

    if (record.type === 'response_item' && isToolCall(payload)) {
      const name = safeToolName(toolNameFromCall(payload));
      incrementToolCall(increment, name);
      const callId = payload.call_id || payload.id;
      if (callId) {
        state.callIdToTool.set(callId, name);
        state.callIdToStartedAt.set(callId, timestamp);
      }
      if (state.taskStartedAt && !state.firstToolSeen) {
        addDuration(increment, 'ttft_sum', 'ttft_count', durationMs(state.taskStartedAt, timestamp));
        state.firstToolSeen = true;
      }
      continue;
    }

    if (record.type === 'response_item' && payload.type === 'function_call_output') {
      const callId = payload.call_id || payload.id;
      const name = state.callIdToTool.get(callId) || 'tool';
      incrementToolOutput(increment, name, outputValue(payload));
      if (isFailure(payload)) {
        incrementToolFailure(increment, name);
      }
      const startedAt = state.callIdToStartedAt.get(callId);
      const latency = durationMs(startedAt, timestamp);
      addDuration(increment, 'tool_latency_sum', 'tool_latency_count', latency);
      addMap(increment.tool_latency_ms_by_name, name, latency);
      continue;
    }

    if (record.type === 'event_msg' && payload.type === 'mcp_tool_call_end') {
      const name = safeToolName(payload.tool_name || payload.name || 'mcp_tool');
      incrementToolOutput(increment, name, outputValue(payload));
      if (isFailure(payload)) {
        incrementToolFailure(increment, name);
      }
      const latency = number(payload.duration_ms || payload.elapsed_ms);
      addDuration(increment, 'tool_latency_sum', 'tool_latency_count', latency);
      addMap(increment.tool_latency_ms_by_name, name, latency);
      continue;
    }

    if (record.type === 'event_msg' && payload.type === 'patch_apply_end') {
      const name = 'apply_patch';
      if (isFailure(payload)) {
        incrementToolFailure(increment, name);
      }
      const latency = number(payload.duration_ms || payload.elapsed_ms);
      addDuration(increment, 'tool_latency_sum', 'tool_latency_count', latency);
      addMap(increment.tool_latency_ms_by_name, name, latency);
      continue;
    }
  }

  return increment;
}
// harn:end numeric-transcript-extractors

module.exports = {
  extractCodexMetrics,
};
