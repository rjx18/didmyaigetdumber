'use strict';

const fs = require('fs');
const {
  applyIncrement,
  createDailyLog,
  dailyLogPath,
  emptyIncrement,
  emptyModelSlice,
  mergeIncrementFields,
  mergeModelSlice,
  writeDailyLogAtomic,
  withDailyLogLock,
} = require('./log-store');
const {
  hourlyLogPath,
  isRetainedHour,
  pruneHourlyLogs,
  writeHourlyLogAtomic,
} = require('./hourly-store');

// harn:assume backfill-idempotent-writes ref=backfill-write-core
function mergeIncrement(target, increment) {
  return mergeIncrementFields(target, increment);
}

// harn:assume historical-per-model-backfill ref=backfill-attribution
function withModelAttribution(increment, model) {
  const key = model || 'unknown';
  increment.by_model[key] ||= emptyModelSlice();
  mergeModelSlice(increment.by_model[key], increment);
  return increment;
}
// harn:end historical-per-model-backfill

function groupIncrement(dayMap, date, increment) {
  const current = dayMap.get(date) || emptyIncrement();
  dayMap.set(date, mergeIncrement(current, increment));
  return dayMap;
}

function dailyLogFromIncrement(date, increment) {
  return applyIncrement(createDailyLog(date), increment);
}

function mergeDayMaps(target, source) {
  for (const [date, increment] of source.entries()) {
    groupIncrement(target, date, increment);
  }
  return target;
}

function writeBackfillDays(dayMap, options = {}) {
  const result = { created: 0, skipped: 0, overwritten: 0 };

  for (const [date, increment] of [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    withDailyLogLock(date, () => {
      const filePath = dailyLogPath(date, options);
      const exists = fs.existsSync(filePath);
      if (exists && !options.overwrite) {
        result.skipped += 1;
        return;
      }

      writeDailyLogAtomic(dailyLogFromIncrement(date, increment), options);
      if (exists) {
        result.overwritten += 1;
      } else {
        result.created += 1;
      }
    }, options);
  }

  return result;
}
// harn:end backfill-idempotent-writes

// harn:assume sub-daily-hourly-storage ref=hourly-backfill
function hourlyLogFromIncrement(hour, increment) {
  const log = dailyLogFromIncrement(hour.slice(0, 10), increment);
  log.hour = hour;
  return log;
}

function writeBackfillHours(hourMap, options = {}) {
  const result = { created: 0, skipped: 0, overwritten: 0, expired: 0 };

  for (const [hour, increment] of [...hourMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!isRetainedHour(hour, options)) {
      result.expired += 1;
      continue;
    }
    withDailyLogLock(`hour-${hour}`, () => {
      const filePath = hourlyLogPath(hour, options);
      const exists = fs.existsSync(filePath);
      if (exists && !options.overwrite) {
        result.skipped += 1;
        return;
      }
      writeHourlyLogAtomic(hourlyLogFromIncrement(hour, increment), options);
      result[exists ? 'overwritten' : 'created'] += 1;
    }, options);
  }
  pruneHourlyLogs(options);
  return result;
}
// harn:end sub-daily-hourly-storage

// harn:assume codex-historical-backfill ref=codex-backfill-dispatch
// harn:assume claude-historical-backfill ref=claude-backfill-dispatch
async function runBackfill(target, options, io) {
  if (target === 'codex') {
    const { runCodexBackfill } = require('./backfills/codex');
    return runCodexBackfill(options, io);
  }

  if (target === 'claude') {
    const { runClaudeBackfill } = require('./backfills/claude');
    return runClaudeBackfill(options, io);
  }

  if (target === 'all') {
    const { collectCodexBackfill } = require('./backfills/codex');
    const { collectClaudeBackfill } = require('./backfills/claude');
    const codex = collectCodexBackfill(options);
    const claude = collectClaudeBackfill(options);
    const dayMap = new Map();
    const hourMap = new Map();
    mergeDayMaps(dayMap, codex.dayMap);
    mergeDayMaps(dayMap, claude.dayMap);
    mergeDayMaps(hourMap, codex.hourMap);
    mergeDayMaps(hourMap, claude.hourMap);
    const writeResult = writeBackfillDays(dayMap, options);
    writeBackfillHours(hourMap, options);
    const malformed = codex.summary.malformed + claude.summary.malformed;
    io.stdout.write(
      `all backfill: codex_files=${codex.summary.files} claude_files=${claude.summary.files} days=${dayMap.size} created=${writeResult.created} skipped=${writeResult.skipped} overwritten=${writeResult.overwritten}\n`
    );
    if (malformed > 0) {
      io.stdout.write(`all backfill skipped malformed lines: ${malformed}\n`);
    }
    return 0;
  }

  io.stdout.write(`${target} backfill is not implemented yet\n`);
  return 0;
}
// harn:end claude-historical-backfill
// harn:end codex-historical-backfill

module.exports = {
  dailyLogFromIncrement,
  groupIncrement,
  mergeDayMaps,
  runBackfill,
  withModelAttribution,
  writeBackfillDays,
  writeBackfillHours,
};
