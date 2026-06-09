'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { incrementFromEvent } = require('../events');
const { emptyIncrement, localDate } = require('../log-store');
const { matchPatterns, loadPatterns } = require('../patterns');
const { groupIncrement, mergeDayMaps, withModelAttribution, writeBackfillDays } = require('../backfill');
const { extractClaudeMetricsByDate } = require('../extractors/claude');
const { modelKey } = require('../extractors/common');

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
    const pendingUsers = [];
    const toolModelById = new Map();

    function flushPendingUsers(model = 'unknown') {
      for (const pending of pendingUsers.splice(0)) {
        groupIncrement(dayMap, pending.date, withModelAttribution(pending.increment, model));
      }
    }

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
        if (text) {
          pendingUsers.push({ date, increment: textIncrement('user', record.type, text, patterns) });
          countableRecords += 1;
        }
        for (const item of contentItems(message)) {
          if (!item || item.type !== 'tool_result' || item.is_error !== true) {
            continue;
          }
          groupIncrement(dayMap, date, withModelAttribution(
            countedIncrement('tool_failures', 1),
            toolModelById.get(item.tool_use_id || item.id) || 'unknown'
          ));
          countableRecords += 1;
        }
        continue;
      }

      if (record.type === 'assistant' && message.role === 'assistant') {
        const model = modelKey(message.model);
        flushPendingUsers(model);
        const text = visibleText(message);
        const toolCalls = countContentType(message, 'tool_use');
        if (text) {
          groupIncrement(dayMap, date, withModelAttribution(
            textIncrement('assistant', record.type, text, patterns),
            model
          ));
          countableRecords += 1;
        }
        if (toolCalls > 0) {
          groupIncrement(dayMap, date, withModelAttribution(countedIncrement('tool_calls', toolCalls), model));
          countableRecords += toolCalls;
        }
        for (const item of contentItems(message)) {
          if (item && item.type === 'tool_use' && (item.id || item.tool_use_id)) {
            toolModelById.set(item.id || item.tool_use_id, model);
          }
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
    flushPendingUsers('unknown');

    // harn:assume historical-per-model-backfill ref=claude-backfill-metrics
    mergeDayMaps(dayMap, extractClaudeMetricsByDate(parsedRecords, {
      fallbackDate: sessionDate || fallbackDate || localDate(),
    }));
    // harn:end historical-per-model-backfill
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
