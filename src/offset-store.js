'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { baseDir, locksDir } = require('./log-store');

function offsetsDir(options = {}) {
  return path.join(baseDir(options), 'offsets');
}

function safeLabel(value, fallback = 'unknown') {
  const label = String(value == null ? '' : value).trim();
  if (!label || label.length > 120 || /[\x00-\x1f\x7f\s/\\]/.test(label)) {
    return fallback;
  }
  return label;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function transcriptPathFromContext(context = {}) {
  return context.transcriptPath || context.transcript_path || '';
}

function sessionIdFromContext(context = {}) {
  return context.sessionId || context.session_id || '';
}

function offsetKey(provider, context = {}) {
  const safeProvider = safeLabel(provider);
  const sessionId = safeLabel(sessionIdFromContext(context), '');
  if (sessionId) {
    return `${safeProvider}-session-${sessionId}`;
  }

  const transcriptPath = transcriptPathFromContext(context);
  if (transcriptPath) {
    return `${safeProvider}-path-${sha256(path.resolve(String(transcriptPath))).slice(0, 32)}`;
  }

  return `${safeProvider}-unknown`;
}

function offsetPath(provider, context = {}, options = {}) {
  return path.join(offsetsDir(options), `${offsetKey(provider, context)}.json`);
}

function offsetLockPath(key, options = {}) {
  return path.join(locksDir(options), `${key}.offset.lock`);
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireOffsetLock(key, options = {}) {
  const lockPath = offsetLockPath(key, options);
  const waitMs = options.waitMs || 10;
  const staleMs = options.staleMs || 30000;
  fs.mkdirSync(locksDir(options), { recursive: true });

  while (true) {
    try {
      fs.mkdirSync(lockPath);
      return lockPath;
    } catch (error) {
      if (error && error.code !== 'EEXIST') {
        throw error;
      }

      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (!statError || statError.code !== 'ENOENT') {
          throw statError;
        }
      }

      sleepMs(waitMs);
    }
  }
}

function releaseOffsetLock(lockPath) {
  fs.rmSync(lockPath, { recursive: true, force: true });
}

function withOffsetLock(key, fn, options = {}) {
  const lockPath = acquireOffsetLock(key, options);
  try {
    return fn();
  } finally {
    releaseOffsetLock(lockPath);
  }
}

function normalizeOffsetState(input, provider, sessionKey, now = new Date()) {
  const source = input && typeof input === 'object' ? input : {};
  const offset = Number(source.offset);
  const size = Number(source.size);
  const inode = Number(source.inode);
  return {
    provider: safeLabel(source.provider || provider),
    session_key: safeLabel(source.session_key || sessionKey),
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    inode: Number.isFinite(inode) && inode >= 0 ? inode : 0,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : now.toISOString(),
  };
}

function readOffsetState(provider, context = {}, options = {}) {
  const key = offsetKey(provider, context);
  const filePath = offsetPath(provider, context, options);
  if (!fs.existsSync(filePath)) {
    return normalizeOffsetState({}, provider, key);
  }
  try {
    return normalizeOffsetState(JSON.parse(fs.readFileSync(filePath, 'utf8')), provider, key);
  } catch (_error) {
    return normalizeOffsetState({}, provider, key);
  }
}

function writeOffsetState(provider, context = {}, state = {}, options = {}) {
  const key = offsetKey(provider, context);
  const normalized = normalizeOffsetState(state, provider, key);
  fs.mkdirSync(offsetsDir(options), { recursive: true });
  const targetPath = offsetPath(provider, context, options);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`);
  fs.renameSync(tempPath, targetPath);
  return normalized;
}

function readFileSlice(filePath, start, end) {
  const length = Math.max(0, end - start);
  if (length === 0) {
    return Buffer.alloc(0);
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function completeSlice(buffer) {
  if (buffer.length === 0) {
    return { complete: Buffer.alloc(0), completeLength: 0 };
  }
  if (buffer[buffer.length - 1] === 10) {
    return { complete: buffer, completeLength: buffer.length };
  }
  const lastNewline = buffer.lastIndexOf(10);
  if (lastNewline < 0) {
    return { complete: Buffer.alloc(0), completeLength: 0 };
  }
  return {
    complete: buffer.subarray(0, lastNewline + 1),
    completeLength: lastNewline + 1,
  };
}

function parseJsonl(buffer) {
  const records = [];
  let malformed = 0;
  const text = buffer.toString('utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      records.push(JSON.parse(line));
    } catch (_error) {
      malformed += 1;
    }
  }
  return { records, malformed };
}

// harn:assume transcript-offset-tail-store ref=offset-store
function tailJsonlTranscript(provider, context = {}, options = {}) {
  const transcriptPath = transcriptPathFromContext(context);
  const key = offsetKey(provider, context);

  return withOffsetLock(key, () => {
    const previous = readOffsetState(provider, context, options);
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      return {
        provider: safeLabel(provider),
        session_key: key,
        records: [],
        malformed: 0,
        previous_offset: previous.offset,
        next_offset: previous.offset,
        reset: false,
        missing: true,
      };
    }

    const stat = fs.statSync(transcriptPath);
    const inode = Number(stat.ino) || 0;
    const replaced = previous.inode > 0 && inode > 0 && previous.inode !== inode;
    const truncated = previous.offset > stat.size || previous.size > stat.size;
    const reset = replaced || truncated;
    const start = reset ? 0 : previous.offset;
    const buffer = readFileSlice(transcriptPath, start, stat.size);
    const { complete, completeLength } = completeSlice(buffer);
    const parsed = parseJsonl(complete);
    const nextOffset = start + completeLength;
    const nextState = writeOffsetState(provider, context, {
      provider,
      session_key: key,
      offset: nextOffset,
      size: stat.size,
      inode,
      updated_at: new Date().toISOString(),
    }, options);

    return {
      provider: nextState.provider,
      session_key: key,
      records: parsed.records,
      malformed: parsed.malformed,
      previous_offset: previous.offset,
      next_offset: nextState.offset,
      reset,
      missing: false,
    };
  }, options);
}
// harn:end transcript-offset-tail-store

module.exports = {
  acquireOffsetLock,
  offsetKey,
  offsetLockPath,
  offsetPath,
  offsetsDir,
  readOffsetState,
  releaseOffsetLock,
  tailJsonlTranscript,
  withOffsetLock,
  writeOffsetState,
};
