'use strict';

const {
  addDuration,
  addMap,
  addTokenUsage,
  aggregateDayMap,
  contentLength,
  durationMs,
  incrementForDate,
  incrementToolCall,
  incrementToolFailure,
  incrementToolOutput,
  modelKey,
  modelSlice,
  number,
  safeToolName,
} = require('./common');

function timestampOf(record = {}) {
  return record.timestamp || record.created_at || record.ts || '';
}

function messageOf(record = {}) {
  return record.message && typeof record.message === 'object' ? record.message : {};
}

function contentItems(message = {}) {
  return Array.isArray(message.content) ? message.content : [];
}

function usageWithContentChars(message = {}) {
  const usage = message.usage && typeof message.usage === 'object' ? message.usage : {};
  let thinkingChars = 0;
  let textChars = 0;
  for (const item of contentItems(message)) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (item.type === 'thinking') {
      thinkingChars += contentLength(item.thinking || item.text || item.content || '');
    }
    if (item.type === 'text') {
      textChars += contentLength(item.text || item.content || '');
    }
  }
  return {
    ...usage,
    thinking_chars: thinkingChars,
    text_chars: textChars,
  };
}

function isCompactionRecord(record = {}) {
  const subtype = String(record.subtype || record.name || record.event || '').toLowerCase();
  return subtype.includes('compact') || subtype.includes('summary');
}

function toolResultBlocks(message = {}) {
  return contentItems(message).filter((item) => item && item.type === 'tool_result');
}

function toolUseBlocks(message = {}) {
  return contentItems(message).filter((item) => item && item.type === 'tool_use');
}

function addToolLatency(increment, name, latency, model) {
  addDuration(increment, 'tool_latency_sum', 'tool_latency_count', latency, model);
  addMap(increment.tool_latency_ms_by_name, name, latency);
  addMap(modelSlice(increment, model).tool_latency_ms_by_name, name, latency);
}

// harn:assume date-scoped-transcript-metrics ref=claude-extractor
// harn:assume turn-model-attribution ref=claude-extractor
function extractClaudeMetricsByDate(records = [], options = {}) {
  const dayMap = new Map();
  const state = {
    lastUserAt: '',
    currentModel: 'unknown',
    toolUseById: new Map(),
  };

  for (const record of records) {
    if (!record || typeof record !== 'object') {
      continue;
    }
    const timestamp = timestampOf(record);
    const message = messageOf(record);

    if (record.type === 'system' && isCompactionRecord(record)) {
      incrementForDate(dayMap, timestamp, options.fallbackDate).totals.compactions += 1;
      continue;
    }

    if (record.type === 'user' && message.role === 'user') {
      const results = toolResultBlocks(message);
      if (results.length === 0) {
        state.lastUserAt = timestamp;
      }
      for (const result of results) {
        const increment = incrementForDate(dayMap, timestamp, options.fallbackDate);
        const id = result.tool_use_id || result.id;
        const tool = state.toolUseById.get(id) || { name: 'tool', model: 'unknown' };
        incrementToolOutput(increment, tool.name, result.content, tool.model);
        if (result.is_error === true) {
          incrementToolFailure(increment, tool.name, tool.model);
        }
        addToolLatency(increment, tool.name, durationMs(tool.timestamp, timestamp), tool.model);
      }
      continue;
    }

    if (record.type === 'assistant' && message.role === 'assistant') {
      const increment = incrementForDate(dayMap, timestamp, options.fallbackDate);
      const model = modelKey(message.model || state.currentModel);
      state.currentModel = model;
      addTokenUsage(increment, usageWithContentChars(message), model);

      const turnLatency = durationMs(state.lastUserAt, timestamp);
      if (turnLatency) {
        addDuration(increment, 'turn_sum', 'turn_count', turnLatency, model);
        addDuration(increment, 'generation_sum', 'generation_count', turnLatency, model);
        increment.totals.turns += 1;
        modelSlice(increment, model).totals.turns += 1;
      }

      const toolUses = toolUseBlocks(message);
      if (toolUses.length > 0 && state.lastUserAt) {
        addDuration(increment, 'ttft_sum', 'ttft_count', turnLatency, model);
      }
      for (const toolUse of toolUses) {
        const name = safeToolName(toolUse.name || 'tool');
        incrementToolCall(increment, name, model);
        const id = toolUse.id || toolUse.tool_use_id;
        if (id) {
          state.toolUseById.set(id, { name, timestamp, model });
        }
      }
      continue;
    }

    if (record.type === 'progress') {
      const increment = incrementForDate(dayMap, timestamp, options.fallbackDate);
      addDuration(
        increment,
        'generation_sum',
        'generation_count',
        number(record.duration_ms || record.elapsed_ms),
        state.currentModel
      );
    }
  }

  return dayMap;
}

function extractClaudeMetrics(records = [], options = {}) {
  return aggregateDayMap(extractClaudeMetricsByDate(records, options));
}
// harn:end turn-model-attribution
// harn:end date-scoped-transcript-metrics

module.exports = {
  extractClaudeMetrics,
  extractClaudeMetricsByDate,
  usageWithContentChars,
};
