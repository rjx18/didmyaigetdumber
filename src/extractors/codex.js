'use strict';

const {
  addDuration,
  addMap,
  addTokenUsage,
  aggregateDayMap,
  durationMs,
  incrementForDate,
  incrementForHour,
  incrementToolCall,
  incrementToolFailure,
  incrementToolOutput,
  isoTime,
  modelKey,
  modelSlice,
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

function addRateLimitSamples(increment, payload, timestamp, observedTokensDelta) {
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
    increment.windows.push({
      kind: windowKind(limit),
      sampled_at: sampledAt,
      resets_at: limit.resets_at,
      used_percent: usedPercent,
      tokens_in_window: number(observedTokensDelta),
      observed_tokens_delta: number(observedTokensDelta),
    });
  }
}

function addToolLatency(increment, name, latency, model) {
  addDuration(increment, 'tool_latency_sum', 'tool_latency_count', latency, model);
  addMap(increment.tool_latency_ms_by_name, name, latency);
  addMap(modelSlice(increment, model).tool_latency_ms_by_name, name, latency);
}

// harn:assume date-scoped-transcript-metrics ref=codex-extractor
// harn:assume turn-model-attribution ref=codex-extractor
function extractCodexMetricsByBucket(records = [], options = {}) {
  const bucketMap = new Map();
  const incrementForBucket = options.bucket === 'hour'
    ? (timestamp) => incrementForHour(bucketMap, timestamp, options.fallbackHour)
    : (timestamp) => incrementForDate(bucketMap, timestamp, options.fallbackDate);
  const state = {
    currentModel: 'unknown',
    callById: new Map(),
    taskStartedAt: '',
    taskModel: 'unknown',
    firstToolSeen: false,
  };

  for (const record of records) {
    if (!record || typeof record !== 'object') {
      continue;
    }
    const payload = payloadOf(record);
    const timestamp = timestampOf(record);

    if (record.type === 'turn_context' || payload.type === 'turn_context') {
      state.currentModel = modelKey(payload.model || record.model || state.currentModel);
      continue;
    }

    if (record.type === 'event_msg' && payload.type === 'task_started') {
      state.taskStartedAt = timestamp;
      state.taskModel = state.currentModel;
      state.firstToolSeen = false;
      continue;
    }

    if (record.type === 'event_msg' && payload.type === 'task_complete') {
      const increment = incrementForBucket(timestamp);
      const elapsed = durationMs(state.taskStartedAt, timestamp);
      addDuration(increment, 'turn_sum', 'turn_count', elapsed, state.taskModel);
      addDuration(increment, 'generation_sum', 'generation_count', elapsed, state.taskModel);
      if (elapsed) {
        increment.totals.turns += 1;
        modelSlice(increment, state.taskModel).totals.turns += 1;
      }
      state.taskStartedAt = '';
      state.taskModel = state.currentModel;
      state.firstToolSeen = false;
      continue;
    }

    if (record.type === 'event_msg' && (payload.type === 'context_compacted' || payload.type === 'compacted')) {
      incrementForBucket(timestamp).totals.compactions += 1;
      continue;
    }

    if (record.type === 'event_msg' && payload.type === 'token_count') {
      const increment = incrementForBucket(timestamp);
      const usage = usageFromTokenRecord(payload);
      const tokens = usage ? addTokenUsage(increment, usage, state.currentModel) : { total: 0 };
      addRateLimitSamples(increment, payload, timestamp, tokens.total);
      continue;
    }

    if (record.type === 'response_item' && isToolCall(payload)) {
      const increment = incrementForBucket(timestamp);
      const name = safeToolName(toolNameFromCall(payload));
      const model = state.taskStartedAt ? state.taskModel : state.currentModel;
      incrementToolCall(increment, name, model);
      const callId = payload.call_id || payload.id;
      if (callId) {
        state.callById.set(callId, { name, timestamp, model });
      }
      if (state.taskStartedAt && !state.firstToolSeen) {
        addDuration(increment, 'ttft_sum', 'ttft_count', durationMs(state.taskStartedAt, timestamp), model);
        state.firstToolSeen = true;
      }
      continue;
    }

    if (record.type === 'response_item' && payload.type === 'function_call_output') {
      const increment = incrementForBucket(timestamp);
      const callId = payload.call_id || payload.id;
      const call = state.callById.get(callId) || { name: 'tool', model: state.currentModel };
      incrementToolOutput(increment, call.name, outputValue(payload), call.model);
      if (isFailure(payload)) {
        incrementToolFailure(increment, call.name, call.model);
      }
      addToolLatency(increment, call.name, durationMs(call.timestamp, timestamp), call.model);
      continue;
    }

    if (record.type === 'event_msg' && payload.type === 'mcp_tool_call_end') {
      const increment = incrementForBucket(timestamp);
      const name = safeToolName(payload.tool_name || payload.name || 'mcp_tool');
      const model = state.taskStartedAt ? state.taskModel : state.currentModel;
      incrementToolOutput(increment, name, outputValue(payload), model);
      if (isFailure(payload)) {
        incrementToolFailure(increment, name, model);
      }
      addToolLatency(increment, name, number(payload.duration_ms || payload.elapsed_ms), model);
      continue;
    }

    if (record.type === 'event_msg' && payload.type === 'patch_apply_end') {
      const increment = incrementForBucket(timestamp);
      const name = 'apply_patch';
      const model = state.taskStartedAt ? state.taskModel : state.currentModel;
      if (isFailure(payload)) {
        incrementToolFailure(increment, name, model);
      }
      addToolLatency(increment, name, number(payload.duration_ms || payload.elapsed_ms), model);
    }
  }

  return bucketMap;
}

function extractCodexMetricsByDate(records = [], options = {}) {
  return extractCodexMetricsByBucket(records, options);
}

function extractCodexMetricsByHour(records = [], options = {}) {
  return extractCodexMetricsByBucket(records, { ...options, bucket: 'hour' });
}

function extractCodexMetrics(records = [], options = {}) {
  return aggregateDayMap(extractCodexMetricsByDate(records, options));
}
// harn:end turn-model-attribution
// harn:end date-scoped-transcript-metrics

module.exports = {
  extractCodexMetrics,
  extractCodexMetricsByDate,
  extractCodexMetricsByHour,
};
