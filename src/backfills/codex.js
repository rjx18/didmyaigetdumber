'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { incrementFromEvent } = require('../events');
const { emptyIncrement, localDate } = require('../log-store');
const { matchPatterns, loadPatterns } = require('../patterns');
const { groupIncrement, mergeDayMaps, withModelAttribution, writeBackfillDays, writeBackfillHours } = require('../backfill');
const { extractCodexMetricsByDate, extractCodexMetricsByHour } = require('../extractors/codex');
const { hourKey, modelKey } = require('../extractors/common');

const SELF_PROJECT_PATTERN = /didmyaigetdumber/i;

function defaultCodexSessionsDir() {
  return path.join(os.homedir(), '.codex', 'sessions');
}

function sessionCwd(lines) {
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch (_error) {
      continue;
    }
    if (record.type === 'session_meta') {
      return (record.payload && record.payload.cwd) || '';
    }
  }
  return '';
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

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
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
  const directoryMatch = String(filePath).match(/[\\/]([0-9]{4})[\\/]([0-9]{2})[\\/]([0-9]{2})(?:[\\/]|$)/);
  if (directoryMatch) {
    return `${directoryMatch[1]}-${directoryMatch[2]}-${directoryMatch[3]}`;
  }

  const filenameMatch = path.basename(String(filePath)).match(/([0-9]{4})-([0-9]{2})-([0-9]{2})T/);
  if (filenameMatch) {
    return `${filenameMatch[1]}-${filenameMatch[2]}-${filenameMatch[3]}`;
  }

  return '';
}

function recordDate(record, filePath, fallbackDate = '') {
  const payload = record.payload || {};
  return dateFromTimestamp(record.timestamp)
    || dateFromTimestamp(payload.timestamp)
    || fallbackDate
    || dateFromFilePath(filePath)
    || localDate();
}

function textIncrement(scope, eventType, text, patterns) {
  const pattern_match = text
    ? matchPatterns(scope, text, { patterns: patterns[scope] })
    : null;
  return incrementFromEvent({
    agent: 'codex',
    event_type: eventType,
    scope,
    text,
    pattern_match,
  });
}

function flagIncrement(eventType, flags) {
  return incrementFromEvent({
    agent: 'codex',
    event_type: eventType,
    flags,
  });
}

function sessionIncrement() {
  const increment = emptyIncrement();
  increment.totals.sessions = 1;
  return increment;
}

function shouldCountToolCall(payload = {}) {
  return payload.type === 'function_call'
    || payload.type === 'custom_tool_call'
    || payload.type === 'web_search_call';
}

// harn:assume codex-historical-backfill ref=codex-backfill-parser
function collectCodexBackfill(options = {}) {
  const sessionsDir = options.codexSessionsDir || options.sessionsDir || defaultCodexSessionsDir();
  const files = findJsonlFiles(sessionsDir);
  const patterns = options.patterns || {
    user: loadPatterns('user', options),
    assistant: loadPatterns('assistant', options),
  };
  const excludeProject = options.excludeProject === undefined ? SELF_PROJECT_PATTERN : options.excludeProject;
  const dayMap = new Map();
  const hourMap = new Map();
  const summary = {
    files: 0,
    records: 0,
    malformed: 0,
  };

  for (const filePath of files) {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

    // harn:assume backfill-excludes-self-sessions ref=codex-self-exclusion
    if (excludeProject && excludeProject.test(sessionCwd(lines))) {
      continue;
    }
    // harn:end backfill-excludes-self-sessions

    const fallbackDate = dateFromFilePath(filePath);
    let sessionDate = fallbackDate;
    let sessionHour = '';
    let sessionCounted = false;
    let countableRecords = 0;
    const parsedRecords = [];
    let currentModel = 'unknown';
    const pendingUsers = [];

    function flushPendingUsers(model = 'unknown') {
      for (const pending of pendingUsers.splice(0)) {
        const increment = withModelAttribution(pending.increment, model);
        groupIncrement(dayMap, pending.date, increment);
        groupIncrement(hourMap, pending.hour, increment);
      }
    }

    function groupRecord(date, hour, increment) {
      groupIncrement(dayMap, date, increment);
      groupIncrement(hourMap, hour, increment);
    }

    summary.files += 1;
    for (const line of lines) {
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
      const payload = record.payload || {};
      const date = recordDate(record, filePath, fallbackDate);
      const hour = hourKey(record.timestamp || payload.timestamp, fallbackDate ? `${fallbackDate}T00` : '');
      sessionDate ||= date;
      sessionHour ||= hour;

      if (record.type === 'turn_context' || payload.type === 'turn_context') {
        currentModel = modelKey(payload.model || record.model);
        flushPendingUsers(currentModel);
        continue;
      }

      if (record.type === 'session_meta' && !sessionCounted) {
        groupRecord(date, hour, sessionIncrement());
        sessionCounted = true;
        continue;
      }

      if (record.type === 'event_msg' && payload.type === 'user_message') {
        const text = firstString(payload.message, payload.text);
        const increment = textIncrement('user', payload.type, text, patterns);
        if (currentModel === 'unknown') {
          pendingUsers.push({ date, hour, increment });
        } else {
          groupRecord(date, hour, withModelAttribution(increment, currentModel));
        }
        countableRecords += 1;
        continue;
      }

      if (record.type === 'event_msg' && payload.type === 'agent_message') {
        const text = firstString(payload.message, payload.text);
        groupRecord(date, hour, withModelAttribution(
          textIncrement('assistant', payload.type, text, patterns),
          currentModel
        ));
        countableRecords += 1;
        continue;
      }

      if (record.type === 'response_item' && shouldCountToolCall(payload)) {
        groupRecord(date, hour, withModelAttribution(
          flagIncrement(payload.type, { tool_call: true }),
          currentModel
        ));
        countableRecords += 1;
        continue;
      }

      if (record.type === 'event_msg' && (payload.type === 'turn_aborted' || payload.type === 'error')) {
        groupRecord(date, hour, flagIncrement(payload.type, { runtime_interrupt: true }));
        countableRecords += 1;
      }
    }

    if (!sessionCounted && countableRecords > 0) {
      groupRecord(sessionDate || localDate(), sessionHour || `${sessionDate || localDate()}T00`, sessionIncrement());
    }
    flushPendingUsers('unknown');

    // harn:assume historical-per-model-backfill ref=codex-backfill-metrics
    mergeDayMaps(dayMap, extractCodexMetricsByDate(parsedRecords, {
      fallbackDate: sessionDate || fallbackDate || localDate(),
    }));
    mergeDayMaps(hourMap, extractCodexMetricsByHour(parsedRecords, {
      fallbackHour: sessionHour || `${sessionDate || fallbackDate || localDate()}T00`,
    }));
    // harn:end historical-per-model-backfill
  }

  return { dayMap, hourMap, summary };
}

function backfillCodex(options = {}) {
  const { dayMap, hourMap, summary } = collectCodexBackfill(options);
  const writeResult = writeBackfillDays(dayMap, options);
  const hourly = writeBackfillHours(hourMap, options);
  return {
    ...summary,
    days: dayMap.size,
    ...writeResult,
    hourly,
  };
}

async function runCodexBackfill(options = {}, io) {
  const result = backfillCodex(options);
  io.stdout.write(
    `codex backfill: files=${result.files} days=${result.days} created=${result.created} skipped=${result.skipped} overwritten=${result.overwritten}\n`
  );
  if (result.malformed > 0) {
    io.stdout.write(`codex backfill skipped malformed lines: ${result.malformed}\n`);
  }
  return 0;
}
// harn:end codex-historical-backfill

module.exports = {
  backfillCodex,
  collectCodexBackfill,
  dateFromFilePath,
  defaultCodexSessionsDir,
  findJsonlFiles,
  runCodexBackfill,
};
