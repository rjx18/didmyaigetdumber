'use strict';

const fs = require('fs');
const path = require('path');
const { logsDir, readDailyLog } = require('./log-store');

function parseDays(value, fallback = 14) {
  if (value == null) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function listDailyDates(options = {}) {
  const directory = logsDir(options);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory)
    .filter((name) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$/.test(name))
    .map((name) => path.basename(name, '.json'))
    .sort();
}

function percent(numerator, denominator) {
  if (!denominator) {
    return '0.0%';
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function ratio(numerator, denominator) {
  return `${numerator}/${denominator}`;
}

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

function statsForLog(log) {
  const userMessages = log.totals.user_messages;
  const assistantMessages = log.totals.assistant_messages;
  const totalMessages = userMessages + assistantMessages;
  const userHits = log.matches.user_patterns.events;
  const assistantHits = log.matches.assistant_patterns.events;
  const totalHits = userHits + assistantHits;

  return {
    date: log.date,
    total_pct: percent(totalHits, totalMessages),
    user_pct: percent(userHits, userMessages),
    assistant_pct: percent(assistantHits, assistantMessages),
    total_ratio: ratio(totalHits, totalMessages),
    user_ratio: ratio(userHits, userMessages),
    assistant_ratio: ratio(assistantHits, assistantMessages),
    sessions: log.totals.sessions,
    tools: log.totals.tool_calls,
    interrupts: log.totals.runtime_interrupts,
  };
}

function reportRows(options = {}) {
  const limit = parseDays(options.days);
  return listDailyDates(options)
    .slice(-limit)
    .map((date) => statsForLog(readDailyLog(date, options)));
}

// harn:assume daily-report-percentages ref=report-format
function formatReport(rows) {
  if (rows.length === 0) {
    return 'no daily logs found\n';
  }

  const widths = {
    date: 10,
    totalPct: 7,
    userPct: 7,
    assistantPct: 7,
    messages: 9,
    user: 9,
    assistant: 9,
    sessions: 8,
    tools: 5,
    interrupts: 10,
  };

  const lines = [
    [
      pad('date', widths.date),
      pad('total%', widths.totalPct),
      pad('user%', widths.userPct),
      pad('asst%', widths.assistantPct),
      pad('hits/msg', widths.messages),
      pad('user', widths.user),
      pad('assistant', widths.assistant),
      pad('sessions', widths.sessions),
      pad('tools', widths.tools),
      pad('interrupts', widths.interrupts),
    ].join('  '),
  ];

  for (const row of rows) {
    lines.push([
      pad(row.date, widths.date),
      pad(row.total_pct, widths.totalPct),
      pad(row.user_pct, widths.userPct),
      pad(row.assistant_pct, widths.assistantPct),
      pad(row.total_ratio, widths.messages),
      pad(row.user_ratio, widths.user),
      pad(row.assistant_ratio, widths.assistant),
      pad(row.sessions, widths.sessions),
      pad(row.tools, widths.tools),
      pad(row.interrupts, widths.interrupts),
    ].join('  '));
  }

  return `${lines.join('\n')}\n`;
}

async function runReport(options, io) {
  io.stdout.write(formatReport(reportRows(options)));
  return 0;
}
// harn:end daily-report-percentages

module.exports = {
  formatReport,
  listDailyDates,
  reportRows,
  runReport,
  statsForLog,
};
