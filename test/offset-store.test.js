'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  offsetPath,
  readOffsetState,
  tailJsonlTranscript,
} = require('../src/offset-store');

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'didmyaigetdumber-'));
}

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

// harn:assume transcript-offset-tail-store ref=offset-tests
test('tails a transcript from the first complete JSONL records', () => {
  const baseDir = tempBase();
  const transcriptPath = path.join(baseDir, 'private', 'session.jsonl');
  writeJsonl(transcriptPath, [
    { type: 'one' },
    { type: 'two' },
  ]);

  const result = tailJsonlTranscript('codex', { sessionId: 'session-1', transcriptPath }, { baseDir });
  const state = readOffsetState('codex', { sessionId: 'session-1', transcriptPath }, { baseDir });
  const stateText = fs.readFileSync(offsetPath('codex', { sessionId: 'session-1', transcriptPath }, { baseDir }), 'utf8');

  assert.deepEqual(result.records.map((record) => record.type), ['one', 'two']);
  assert.equal(result.malformed, 0);
  assert.equal(result.previous_offset, 0);
  assert.equal(result.next_offset, fs.statSync(transcriptPath).size);
  assert.equal(state.offset, fs.statSync(transcriptPath).size);
  assert.equal(stateText.includes(transcriptPath), false);
  assert.equal(stateText.includes('/private/'), false);
});

test('tails only newly appended complete lines', () => {
  const baseDir = tempBase();
  const transcriptPath = path.join(baseDir, 'session.jsonl');
  writeJsonl(transcriptPath, [{ type: 'one' }]);

  tailJsonlTranscript('claude', { sessionId: 'session-2', transcriptPath }, { baseDir });
  fs.appendFileSync(transcriptPath, `${JSON.stringify({ type: 'two' })}\n`);

  const result = tailJsonlTranscript('claude', { sessionId: 'session-2', transcriptPath }, { baseDir });

  assert.deepEqual(result.records.map((record) => record.type), ['two']);
  assert.equal(result.previous_offset > 0, true);
  assert.equal(result.next_offset, fs.statSync(transcriptPath).size);
});

test('leaves malformed trailing JSON for the next read', () => {
  const baseDir = tempBase();
  const transcriptPath = path.join(baseDir, 'session.jsonl');
  writeJsonl(transcriptPath, [{ type: 'one' }]);
  tailJsonlTranscript('codex', { sessionId: 'session-3', transcriptPath }, { baseDir });

  const before = readOffsetState('codex', { sessionId: 'session-3', transcriptPath }, { baseDir }).offset;
  fs.appendFileSync(transcriptPath, '{"type":"two"');

  const partial = tailJsonlTranscript('codex', { sessionId: 'session-3', transcriptPath }, { baseDir });
  assert.deepEqual(partial.records, []);
  assert.equal(partial.next_offset, before);

  fs.appendFileSync(transcriptPath, '}\n');
  const complete = tailJsonlTranscript('codex', { sessionId: 'session-3', transcriptPath }, { baseDir });

  assert.deepEqual(complete.records.map((record) => record.type), ['two']);
  assert.equal(complete.next_offset, fs.statSync(transcriptPath).size);
});

test('resets safely when a transcript is truncated', () => {
  const baseDir = tempBase();
  const transcriptPath = path.join(baseDir, 'session.jsonl');
  writeJsonl(transcriptPath, [{ type: 'one' }, { type: 'two' }]);
  tailJsonlTranscript('claude', { sessionId: 'session-4', transcriptPath }, { baseDir });

  writeJsonl(transcriptPath, [{ type: 'replacement' }]);
  const result = tailJsonlTranscript('claude', { sessionId: 'session-4', transcriptPath }, { baseDir });

  assert.equal(result.reset, true);
  assert.deepEqual(result.records.map((record) => record.type), ['replacement']);
});

test('uses a path-derived cursor key without storing the path when no session id is available', () => {
  const baseDir = tempBase();
  const transcriptPath = path.join(baseDir, 'private', 'fallback.jsonl');
  writeJsonl(transcriptPath, [{ type: 'one' }]);

  const result = tailJsonlTranscript('codex', { transcriptPath }, { baseDir });
  const filePath = offsetPath('codex', { transcriptPath }, { baseDir });
  const stateText = fs.readFileSync(filePath, 'utf8');

  assert.match(result.session_key, /^codex-path-[a-f0-9]{32}$/);
  assert.equal(path.basename(filePath).includes('fallback'), false);
  assert.equal(stateText.includes(transcriptPath), false);
  assert.equal(stateText.includes('fallback.jsonl'), false);
});
// harn:end transcript-offset-tail-store
