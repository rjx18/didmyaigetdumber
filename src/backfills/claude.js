'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { incrementFromEvent } = require('../events');
const { emptyIncrement, localDate } = require('../log-store');
const { matchPatterns, loadPatterns } = require('../patterns');
const { groupIncrement, writeBackfillDays } = require('../backfill');
const { extractClaudeMetrics } = require('../extractors/claude');

const SELF_PROJECT_PATTERN = /didmyaigetdumber/i;

function defaultClaudeProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects');
}

function findJsonlFiles(root) {
  if (!root || !fs.existsSync(root)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...findJsonlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function dateFromTimestamp(timestamp) {
  if (!timestamp) {
    return '';
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return localDate(parsed);
}

function dateFromFilePath(filePath) {
  const match = path.basename(String(filePath)).match(/([0-9]{4})-([0-9]{2})-([0-9]{2})/);
  if (!match) {
    return '';
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function recordDate(record, filePath, fallbackDate = '') {
  return dateFromTimestamp(record.timestamp)
    || fallbackDate
    || dateFromFilePath(filePath)
    || localDate();
}

function contentItems(message = {}) {
  if (Array.isArray(message.content)) {
    return message.content;
  }
  return [];
}

function visibleText(message = {}) {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return contentItems(message)
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
}

function countContentType(message, type) {
  return contentItems(message).filter((item) => item && item.type === type).length;
}

function countErroredToolResults(message) {
  return contentItems(message).filter((item) => item && item.type === 'tool_result' && item.is_error === true).length;
}

function textIncrement(scope, eventType, text, patterns) {
  const pattern_match = text
    ? matchPatterns(scope, text, { patterns: patterns[scope] })
    : null;
  return incrementFromEvent({
    agent: 'claude',
    event_type: eventType,
    scope,
    text,
    pattern_match,
  });
}

function countedIncrement(totalKey, count) {
  const increment = emptyIncrement();
  increment.totals[totalKey] = count;
  return increment;
}

function sessionIncrement() {
  return countedIncrement('sessions', 1);
}

function runtimeIncrement() {
  return countedIncrement('runtime_interrupts', 1);
}

function hasMetricData(increment) {
  return increment.totals.turns > 0
    || increment.totals.compactions > 0
    || Object.values(increment.tokens).some((value) => value > 0)
    || Object.keys(increment.tool_output_chars).length > 0
    || Object.keys(increment.tool_calls_by_name).length > 0
    || Object.keys(increment.tool_failures_by_name).length > 0
    || Object.keys(increment.model_tokens).length > 0
    || Object.values(increment.timings_ms).some((value) => value > 0)
    || Object.keys(increment.tool_latency_ms_by_name).length > 0
    || increment.windows.length > 0;
}

// harn:assume claude-historical-backfill ref=claude-backfill-parser
function collectClaudeBackfill(options = {}) {
  const projectsDir = options.claudeProjectsDir || options.projectsDir || defaultClaudeProjectsDir();
  const files = findJsonlFiles(projectsDir);
  const patterns = options.patterns || {
    user: loadPatterns('user', options),
    assistant: loadPatterns('assistant', options),
  };
  const excludeProject = options.excludeProject === undefined ? SELF_PROJECT_PATTERN : options.excludeProject;
  const dayMap = new Map();
  const summary = {
    files: 0,
    records: 0,
    malformed: 0,
  };

  for (const filePath of files) {
    // harn:assume backfill-excludes-self-sessions ref=claude-self-exclusion
    if (excludeProject && excludeProject.test(path.relative(projectsDir, filePath))) {
      continue;
    }
    // harn:end backfill-excludes-self-sessions

    const fallbackDate = dateFromFilePath(filePath);
    let sessionDate = fallbackDate;
    let countableRecords = 0;
    const parsedRecords = [];

    summary.files += 1;
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      let record;
      try {
        record = JSON.parse(line);
      } catch (_error) {
        summary.malformed += 1;
        continue;
      }

      summary.records += 1;
      parsedRecords.push(record);
      const message = record.message || {};
      const date = recordDate(record, filePath, fallbackDate);
      sessionDate ||= date;

      if (record.type === 'user' && message.role === 'user') {
        const text = visibleText(message);
        const failures = countErroredToolResults(message);
        if (text) {
          groupIncrement(dayMap, date, textIncrement('user', record.type, text, patterns));
          countableRecords += 1;
        }
        if (failures > 0) {
          groupIncrement(dayMap, date, countedIncrement('tool_failures', failures));
          countableRecords += failures;
        }
        continue;
      }

      if (record.type === 'assistant' && message.role === 'assistant') {
        const text = visibleText(message);
        const toolCalls = countContentType(message, 'tool_use');
        if (text) {
          groupIncrement(dayMap, date, textIncrement('assistant', record.type, text, patterns));
          countableRecords += 1;
        }
        if (toolCalls > 0) {
          groupIncrement(dayMap, date, countedIncrement('tool_calls', toolCalls));
          countableRecords += toolCalls;
        }
        continue;
      }

      if (record.type === 'system' && (record.subtype === 'api_error' || record.level === 'error')) {
        groupIncrement(dayMap, date, runtimeIncrement());
        countableRecords += 1;
      }
    }

    if (countableRecords > 0) {
      groupIncrement(dayMap, sessionDate || localDate(), sessionIncrement());
    }

    // harn:assume historical-backfill-numeric-metrics ref=claude-backfill-metrics
    const metricsIncrement = extractClaudeMetrics(parsedRecords);
    if (hasMetricData(metricsIncrement)) {
      groupIncrement(dayMap, sessionDate || fallbackDate || localDate(), metricsIncrement);
    }
    // harn:end historical-backfill-numeric-metrics
  }

  return { dayMap, summary };
}

function backfillClaude(options = {}) {
  const { dayMap, summary } = collectClaudeBackfill(options);
  const writeResult = writeBackfillDays(dayMap, options);
  return {
    ...summary,
    days: dayMap.size,
    ...writeResult,
  };
}

async function runClaudeBackfill(options = {}, io) {
  const result = backfillClaude(options);
  io.stdout.write(
    `claude backfill: files=${result.files} days=${result.days} created=${result.created} skipped=${result.skipped} overwritten=${result.overwritten}\n`
  );
  if (result.malformed > 0) {
    io.stdout.write(`claude backfill skipped malformed lines: ${result.malformed}\n`);
  }
  return 0;
}
// harn:end claude-historical-backfill

module.exports = {
  backfillClaude,
  collectClaudeBackfill,
  defaultClaudeProjectsDir,
  findJsonlFiles,
  runClaudeBackfill,
  visibleText,
};
