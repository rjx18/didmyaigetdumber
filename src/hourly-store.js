'use strict';

const fs = require('fs');
const path = require('path');
const {
  applyIncrement,
  baseDir,
  createDailyLog,
  localDate,
  normalizeDailyLog,
  withDailyLogLock,
} = require('./log-store');

const HOURLY_RETENTION_DAYS = 7;
const HOUR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}$/;

function localHour(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${localDate(date)}T${String(date.getHours()).padStart(2, '0')}`;
}

function hourlyDir(options = {}) {
  return path.join(baseDir(options), 'hourly');
}

function hourlyLogPath(hour, options = {}) {
  if (!HOUR_PATTERN.test(hour)) {
    throw new RangeError(`invalid local hour: ${hour}`);
  }
  return path.join(hourlyDir(options), `${hour}.json`);
}

// harn:assume sub-daily-hourly-storage ref=hourly-store
function createHourlyLog(hour) {
  return { ...createDailyLog(hour.slice(0, 10)), hour };
}

function normalizeHourlyLog(log, hour) {
  return { ...normalizeDailyLog(log, hour.slice(0, 10)), hour };
}

function readHourlyLog(hour, options = {}) {
  const filePath = hourlyLogPath(hour, options);
  if (!fs.existsSync(filePath)) {
    return createHourlyLog(hour);
  }
  return normalizeHourlyLog(JSON.parse(fs.readFileSync(filePath, 'utf8')), hour);
}

function writeHourlyLogAtomic(log, options = {}) {
  const normalized = normalizeHourlyLog(log, log.hour);
  fs.mkdirSync(hourlyDir(options), { recursive: true });
  const targetPath = hourlyLogPath(normalized.hour, options);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`);
  fs.renameSync(tempPath, targetPath);
  return normalized;
}

function retentionStart(reference = new Date()) {
  const date = reference instanceof Date ? new Date(reference) : new Date(reference);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - (HOURLY_RETENTION_DAYS - 1));
  return localDate(date);
}

function isRetainedHour(hour, options = {}) {
  if (typeof hour !== 'string' || !HOUR_PATTERN.test(hour)) {
    return false;
  }
  const reference = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const date = hour.slice(0, 10);
  return date >= retentionStart(reference) && date <= localDate(reference);
}

function listHourlyKeys(options = {}) {
  const directory = hourlyDir(options);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory)
    .filter((name) => HOUR_PATTERN.test(name.replace(/\.json$/, '')) && name.endsWith('.json'))
    .map((name) => name.slice(0, -5))
    .sort();
}

function pruneHourlyLogs(options = {}) {
  const reference = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const cutoff = retentionStart(reference);
  const end = localDate(reference);
  let removed = 0;
  for (const hour of listHourlyKeys(options)) {
    if (hour.slice(0, 10) < cutoff || hour.slice(0, 10) > end) {
      withDailyLogLock(`hour-${hour}`, () => {
        if (fs.existsSync(hourlyLogPath(hour, options))) {
          fs.rmSync(hourlyLogPath(hour, options), { force: true });
          removed += 1;
        }
      }, options);
    }
  }
  return removed;
}

function updateHourlyLog(hour, increment, options = {}) {
  if (!isRetainedHour(hour, options)) {
    return null;
  }
  const result = withDailyLogLock(`hour-${hour}`, () => {
    const next = applyIncrement(readHourlyLog(hour, options), increment);
    next.hour = hour;
    return writeHourlyLogAtomic(next, options);
  }, options);
  pruneHourlyLogs(options);
  return result;
}
// harn:end sub-daily-hourly-storage

module.exports = {
  HOURLY_RETENTION_DAYS,
  createHourlyLog,
  hourlyDir,
  hourlyLogPath,
  isRetainedHour,
  listHourlyKeys,
  localHour,
  pruneHourlyLogs,
  readHourlyLog,
  retentionStart,
  updateHourlyLog,
  writeHourlyLogAtomic,
};
