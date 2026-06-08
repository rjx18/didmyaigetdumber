'use strict';

const { apiMetricsDays } = require('./metrics');

const READ_TOOL_RE = /^(Read|Grep|Glob|Explore|List|LS|rg)$/i;

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

function pct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1000000) {
    return `${(number / 1000000).toFixed(1)}m`;
  }
  if (number >= 1000) {
    return `${(number / 1000).toFixed(1)}k`;
  }
  return String(Math.round(number));
}

function topShare(share = {}) {
  let best = null;
  for (const [key, value] of Object.entries(share)) {
    if (!best || value > best.value) {
      best = { key, value };
    }
  }
  return best ? `${best.key}:${pct(best.value)}` : '-';
}

function readShare(row) {
  let total = 0;
  for (const [tool, share] of Object.entries(row.tool_call_mix || {})) {
    if (READ_TOOL_RE.test(tool)) {
      total += Number(share || 0);
    }
  }
  return total;
}

function latestWindow(row) {
  const samples = (row.windows || []).filter((sample) => sample.kind === '5h');
  return samples[samples.length - 1] || null;
}

function toolsPerAssistant(row) {
  return row.totals.assistant_messages > 0
    ? row.tool_call_total_by_name / row.totals.assistant_messages
    : 0;
}

// harn:assume cli-metrics-report ref=metrics-report-format
function formatMetricsReport(rows) {
  if (rows.length === 0) {
    return 'no daily metric logs found\n';
  }

  const widths = {
    date: 10,
    tokens: 8,
    cache: 7,
    reason: 7,
    think: 7,
    tools: 8,
    read: 7,
    output: 18,
    turn: 8,
    window: 9,
    allow: 9,
    burn: 9,
  };

  const lines = [[
    pad('date', widths.date),
    pad('tokens', widths.tokens),
    pad('cache', widths.cache),
    pad('reason', widths.reason),
    pad('think', widths.think),
    pad('tools/a', widths.tools),
    pad('read%', widths.read),
    pad('top output', widths.output),
    pad('turn', widths.turn),
    pad('5h used', widths.window),
    pad('allow', widths.allow),
    pad('burn/h', widths.burn),
  ].join('  ')];

  for (const row of rows) {
    const window = latestWindow(row);
    lines.push([
      pad(row.date, widths.date),
      pad(compactNumber(row.tokens.total), widths.tokens),
      pad(pct(row.cache_ratio), widths.cache),
      pad(pct(row.reasoning_share), widths.reason),
      pad(pct(row.thinking_char_share), widths.think),
      pad(toolsPerAssistant(row).toFixed(1), widths.tools),
      pad(pct(readShare(row)), widths.read),
      pad(topShare(row.tool_output_share), widths.output),
      pad(`${compactNumber(row.timings_ms.avg_turn)}ms`, widths.turn),
      pad(window ? `${Number(window.used_percent).toFixed(1)}%` : '-', widths.window),
      pad(window && window.implied_allowance != null ? compactNumber(window.implied_allowance) : '-', widths.allow),
      pad(window && window.burn_rate_tokens_per_hour != null ? compactNumber(window.burn_rate_tokens_per_hour) : '-', widths.burn),
    ].join('  '));
  }

  return `${lines.join('\n')}\n`;
}

async function runMetricsReport(options, io) {
  io.stdout.write(formatMetricsReport(apiMetricsDays(options)));
  return 0;
}
// harn:end cli-metrics-report

module.exports = {
  formatMetricsReport,
  runMetricsReport,
};
