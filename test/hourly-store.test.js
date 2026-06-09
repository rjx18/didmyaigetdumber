'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { extractCodexMetricsByHour } = require('../src/extractors/codex');
const { emptyIncrement } = require('../src/log-store');
const {
  listHourlyKeys,
  localHour,
  pruneHourlyLogs,
  readHourlyLog,
  updateHourlyLog,
  writeHourlyLogAtomic,
} = require('../src/hourly-store');

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'didmyaigetdumber-hourly-'));
}

// harn:assume sub-daily-hourly-storage ref=hourly-store-tests
test('buckets timestamps into local hours and stores aggregate-only slices', () => {
  const baseDir = tempBase();
  const timestamp = '2026-06-09T23:30:00-07:00';
  const parsed = new Date(timestamp);
  const expected = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}T${String(parsed.getHours()).padStart(2, '0')}`;
  const increment = emptyIncrement();
  increment.totals.user_messages = 1;
  increment.tokens.input = 20;
  increment.raw_prompt = 'private prompt';

  assert.equal(localHour(timestamp), expected);
  updateHourlyLog(expected, increment, { baseDir, now: parsed });

  const log = readHourlyLog(expected, { baseDir });
  const serialized = JSON.stringify(log);
  assert.equal(log.hour, expected);
  assert.equal(log.totals.user_messages, 1);
  assert.equal(log.tokens.input, 20);
  assert.equal(serialized.includes(timestamp), false);
  assert.equal(serialized.includes('private prompt'), false);
});

test('keeps seven local calendar days and prunes older hourly files', () => {
  const baseDir = tempBase();
  writeHourlyLogAtomic({ ...readHourlyLog('2026-06-02T23', { baseDir }), hour: '2026-06-02T23' }, { baseDir });
  writeHourlyLogAtomic({ ...readHourlyLog('2026-06-03T00', { baseDir }), hour: '2026-06-03T00' }, { baseDir });
  writeHourlyLogAtomic({ ...readHourlyLog('2026-06-10T00', { baseDir }), hour: '2026-06-10T00' }, { baseDir });

  assert.equal(pruneHourlyLogs({ baseDir, now: new Date('2026-06-09T12:00:00') }), 2);
  assert.deepEqual(listHourlyKeys({ baseDir }), ['2026-06-03T00']);

  const increment = emptyIncrement();
  increment.tokens.total = 1;
  assert.equal(updateHourlyLog('2026-06-02T12', increment, { baseDir, now: new Date('2026-06-09T12:00:00') }), null);
});
// harn:end sub-daily-hourly-storage

// harn:assume sub-daily-hourly-storage ref=hourly-extractor-tests
test('partitions transcript metrics by local record hour', () => {
  const first = new Date('2026-06-09T10:59:59');
  const second = new Date('2026-06-09T11:00:01');
  const map = extractCodexMetricsByHour([
    { timestamp: first.toISOString(), type: 'event_msg', payload: { type: 'context_compacted' } },
    { timestamp: second.toISOString(), type: 'event_msg', payload: { type: 'context_compacted' } },
  ]);

  assert.equal(map.get('2026-06-09T10').totals.compactions, 1);
  assert.equal(map.get('2026-06-09T11').totals.compactions, 1);
});
// harn:end sub-daily-hourly-storage
