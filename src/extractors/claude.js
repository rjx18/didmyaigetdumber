'use strict';

const { emptyIncrement } = require('../log-store');
const {
  addDuration,
  addMap,
  addTokenUsage,
  contentLength,
  durationMs,
  incrementToolCall,
  incrementToolFailure,
  incrementToolOutput,
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

// harn:assume numeric-transcript-extractors ref=claude-extractor
function extractClaudeMetrics(records = []) {
  const increment = emptyIncrement();
  const state = {
    lastUserAt: '',
    toolUseById: new Map(),
  };

  for (const record of records) {
    if (!record || typeof record !== 'object') {
      continue;
    }
    const timestamp = timestampOf(record);
    const message = messageOf(record);

    if (record.type === 'system' && isCompactionRecord(record)) {
      increment.totals.compactions += 1;
      continue;
    }

    if (record.type === 'user' && message.role === 'user') {
      const results = toolResultBlocks(message);
      if (results.length === 0) {
        state.lastUserAt = timestamp;
      }
      for (const result of results) {
        const id = result.tool_use_id || result.id;
        const tool = state.toolUseById.get(id) || {};
        const name = tool.name || 'tool';
        incrementToolOutput(increment, name, result.content);
        if (result.is_error === true) {
          incrementToolFailure(increment, name);
        }
        const latency = durationMs(tool.timestamp, timestamp);
        addDuration(increment, 'tool_latency_sum', 'tool_latency_count', latency);
        addMap(increment.tool_latency_ms_by_name, name, latency);
      }
      continue;
    }

    if (record.type === 'assistant' && message.role === 'assistant') {
      addTokenUsage(increment, usageWithContentChars(message), message.model);

      const turnLatency = durationMs(state.lastUserAt, timestamp);
      if (turnLatency) {
        addDuration(increment, 'turn_sum', 'turn_count', turnLatency);
        addDuration(increment, 'generation_sum', 'generation_count', turnLatency);
        increment.totals.turns += 1;
      }

      const toolUses = toolUseBlocks(message);
      if (toolUses.length > 0 && state.lastUserAt) {
        addDuration(increment, 'ttft_sum', 'ttft_count', turnLatency);
      }
      for (const toolUse of toolUses) {
        const name = safeToolName(toolUse.name || 'tool');
        incrementToolCall(increment, name);
        const id = toolUse.id || toolUse.tool_use_id;
        if (id) {
          state.toolUseById.set(id, { name, timestamp });
        }
      }
      continue;
    }

    if (record.type === 'progress') {
      const duration = number(record.duration_ms || record.elapsed_ms);
      addDuration(increment, 'generation_sum', 'generation_count', duration);
    }
  }

  return increment;
}
// harn:end numeric-transcript-extractors

module.exports = {
  extractClaudeMetrics,
  usageWithContentChars,
};
