'use strict';

const fs = require('fs');
const {
  applyIncrement,
  createDailyLog,
  dailyLogPath,
  emptyIncrement,
  mergeIncrementFields,
  writeDailyLogAtomic,
  withDailyLogLock,
} = require('./log-store');

// harn:assume backfill-idempotent-writes ref=backfill-write-core
function mergeIncrement(target, increment) {
  return mergeIncrementFields(target, increment);
}

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
    mergeDayMaps(dayMap, codex.dayMap);
    mergeDayMaps(dayMap, claude.dayMap);
    const writeResult = writeBackfillDays(dayMap, options);
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
  runBackfill,
  writeBackfillDays,
};
