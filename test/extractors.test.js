'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { extractClaudeMetrics } = require('../src/extractors/claude');
const { extractCodexMetrics } = require('../src/extractors/codex');

// harn:assume numeric-transcript-extractors ref=extractor-tests
test('extracts Codex numeric metrics without raw content fields', () => {
  const increment = extractCodexMetrics([
    {
      timestamp: '2026-06-08T01:00:00.000Z',
      type: 'turn_context',
      payload: { model: 'gpt-5.4', cwd: '/private/project' },
    },
    {
      timestamp: '2026-06-08T01:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'task_started' },
    },
    {
      timestamp: '2026-06-08T01:00:05.000Z',
      type: 'response_item',
      payload: { type: 'function_call', name: 'Bash', call_id: 'call-1', arguments: 'ignored command text' },
    },
    {
      timestamp: '2026-06-08T01:00:15.000Z',
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'call-1', output: 'ignored output text' },
    },
    {
      timestamp: '2026-06-08T01:01:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 30,
            reasoning_output_tokens: 5,
            total_tokens: 150,
          },
        },
        rate_limits: {
          primary: { used_percent: 50, window_minutes: 300, resets_at: 1780901738 },
        },
      },
    },
    {
      timestamp: '2026-06-08T01:02:00.000Z',
      type: 'event_msg',
      payload: { type: 'task_complete' },
    },
    {
      timestamp: '2026-06-08T01:03:00.000Z',
      type: 'event_msg',
      payload: { type: 'context_compacted', summary: 'ignored source excerpt' },
    },
  ]);

  const serialized = JSON.stringify(increment);

  assert.equal(increment.tokens.input, 100);
  assert.equal(increment.tokens.cache_read, 20);
  assert.equal(increment.tokens.output, 30);
  assert.equal(increment.tokens.reasoning_output, 5);
  assert.equal(increment.model_tokens['gpt-5.4'].total, 150);
  assert.equal(increment.tool_calls_by_name.Bash, 1);
  assert.equal(increment.tool_output_chars.Bash, 'ignored output text'.length);
  assert.equal(increment.timings_ms.ttft_sum, 4000);
  assert.equal(increment.timings_ms.tool_latency_sum, 10000);
  assert.equal(increment.timings_ms.turn_sum, 119000);
  assert.equal(increment.totals.turns, 1);
  assert.equal(increment.totals.compactions, 1);
  assert.equal(increment.windows[0].kind, '5h');
  assert.equal(increment.windows[0].tokens_in_window, 150);
  assert.equal(serialized.includes('/private/project'), false);
  assert.equal(serialized.includes('ignored command text'), false);
  assert.equal(serialized.includes('ignored output text'), false);
  assert.equal(serialized.includes('ignored source excerpt'), false);
});

test('extracts Claude numeric metrics without raw content fields', () => {
  const increment = extractClaudeMetrics([
    {
      timestamp: '2026-06-08T01:00:00.000Z',
      type: 'user',
      message: { role: 'user', content: 'private prompt text' },
    },
    {
      timestamp: '2026-06-08T01:00:20.000Z',
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'hf:moonshotai/Kimi-K2.6',
        usage: {
          input_tokens: 200,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 50,
          output_tokens: 40,
        },
        content: [
          { type: 'thinking', thinking: 'private thinking text' },
          { type: 'text', text: 'assistant private text' },
          { type: 'tool_use', id: 'toolu-1', name: 'Bash', input: { command: 'ignored command text' } },
        ],
      },
    },
    {
      timestamp: '2026-06-08T01:00:50.000Z',
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu-1', content: 'ignored tool output', is_error: true }],
      },
    },
    {
      timestamp: '2026-06-08T01:01:00.000Z',
      type: 'system',
      subtype: 'context_compacted',
      summary: 'ignored summary text',
    },
  ]);

  const serialized = JSON.stringify(increment);

  assert.equal(increment.tokens.input, 200);
  assert.equal(increment.tokens.cache_creation, 10);
  assert.equal(increment.tokens.cache_read, 50);
  assert.equal(increment.tokens.output, 40);
  assert.equal(increment.tokens.thinking_chars, 'private thinking text'.length);
  assert.equal(increment.tokens.text_chars, 'assistant private text'.length);
  assert.equal(increment.model_tokens['hf:moonshotai/Kimi-K2.6'].output, 40);
  assert.equal(increment.tool_calls_by_name.Bash, 1);
  assert.equal(increment.tool_output_chars.Bash, 'ignored tool output'.length);
  assert.equal(increment.tool_failures_by_name.Bash, 1);
  assert.equal(increment.timings_ms.turn_sum, 20000);
  assert.equal(increment.timings_ms.tool_latency_sum, 30000);
  assert.equal(increment.totals.turns, 1);
  assert.equal(increment.totals.compactions, 1);
  assert.equal(serialized.includes('private prompt text'), false);
  assert.equal(serialized.includes('private thinking text'), false);
  assert.equal(serialized.includes('assistant private text'), false);
  assert.equal(serialized.includes('ignored command text'), false);
  assert.equal(serialized.includes('ignored tool output'), false);
  assert.equal(serialized.includes('ignored summary text'), false);
});
// harn:end numeric-transcript-extractors
