'use strict';

const fs = require('fs');
const {
  applyIncrement,
  createDailyLog,
  dailyLogPath,
  writeDailyLogAtomic,
  withDailyLogLock,
} = require('./log-store');

function mergeIncrement(target, increment) {
  for (const [key, value] of Object.entries(increment.totals || {})) {
    target.totals[key] = (target.totals[key] || 0) + value;
  }
  for (const [key, value] of Object.entries(increment.matches || {})) {
    target.matches[key] ||= { events: 0, line_hits: 0 };
    target.matches[key].events += value.events || 0;
    target.matches[key].line_hits += value.line_hits || 0;
  }
  return target;
}

function groupIncrement(dayMap, date, increment) {
  const current = dayMap.get(date) || { totals: {}, matches: {} };
  dayMap.set(date, mergeIncrement(current, increment));
  return dayMap;
}

function dailyLogFromIncrement(date, increment) {
  return applyIncrement(createDailyLog(date), increment);
}

// harn:assume backfill-idempotent-writes ref=backfill-write-core
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

async function runBackfill(target, _options, io) {
  io.stdout.write(`${target} backfill is not implemented yet\n`);
  return 0;
}

module.exports = {
  dailyLogFromIncrement,
  groupIncrement,
  runBackfill,
  writeBackfillDays,
};
