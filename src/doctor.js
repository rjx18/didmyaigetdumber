'use strict';

const fs = require('fs');
const { loadPatterns } = require('./patterns');
const {
  baseDir,
  dailyLockPath,
  localDate,
  logsDir,
  withDailyLogLock,
} = require('./log-store');
const { defaultCodexHooksPath } = require('./init/codex');
const { defaultClaudeSettingsPath } = require('./init/claude');

function status(level, label, message) {
  return { level, label, message };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hasCodexHook(config = {}) {
  const hooks = config.hooks || {};
  return Object.values(hooks).some((entries) => (
    Array.isArray(entries) && entries.some((entry) => (
      entry
      && (
        entry.name === 'didmyaigetdumber'
        || (entry.env && entry.env.DIDMYAIGETDUMBER_AGENT === 'codex')
      )
    ))
  ));
}

function hasClaudeHook(config = {}) {
  const hooks = config.hooks || {};
  return Object.values(hooks).some((entries) => (
    Array.isArray(entries) && entries.some((entry) => {
      const commands = Array.isArray(entry && entry.hooks) ? entry.hooks : [];
      return commands.some((hook) => (
        hook
        && hook.env
        && hook.env.DIDMYAIGETDUMBER_AGENT === 'claude'
      ));
    })
  ));
}

// harn:assume doctor-health-checks ref=doctor-health
function checkPatterns(options = {}) {
  const userPatterns = loadPatterns('user', options);
  const assistantPatterns = loadPatterns('assistant', options);
  return status('ok', 'patterns', `${userPatterns.length + assistantPatterns.length} regex lines`);
}

function checkStorage(options = {}) {
  const directory = logsDir(options);
  fs.mkdirSync(directory, { recursive: true });
  fs.accessSync(directory, fs.constants.W_OK);
  return status('ok', 'logs', `writable under ${baseDir(options)}`);
}

function checkLock(options = {}) {
  const date = options.date || localDate();
  withDailyLogLock(date, () => {}, options);
  return status('ok', 'locks', `acquired ${dailyLockPath(date, options)}`);
}

function checkCodexHooks(options = {}) {
  const filePath = options.codexConfigPath || defaultCodexHooksPath();
  if (!fs.existsSync(filePath)) {
    return status('warn', 'codex hooks', 'config not found');
  }
  return hasCodexHook(readJson(filePath))
    ? status('ok', 'codex hooks', 'didmyaigetdumber hook present')
    : status('warn', 'codex hooks', 'didmyaigetdumber hook not found');
}

function checkClaudeHooks(options = {}) {
  const filePath = options.claudeConfigPath || defaultClaudeSettingsPath();
  if (!fs.existsSync(filePath)) {
    return status('warn', 'claude hooks', 'settings not found');
  }
  return hasClaudeHook(readJson(filePath))
    ? status('ok', 'claude hooks', 'didmyaigetdumber hook present')
    : status('warn', 'claude hooks', 'didmyaigetdumber hook not found');
}

function runCheck(label, fn, options) {
  try {
    return fn(options);
  } catch (error) {
    return status('error', label, error && error.message ? error.message : String(error));
  }
}

// harn:assume scope-pattern-loader ref=doctor-pattern-check
async function runDoctor(options = {}, io) {
  const results = [
    runCheck('patterns', checkPatterns, options),
    runCheck('logs', checkStorage, options),
    runCheck('locks', checkLock, options),
    runCheck('codex hooks', checkCodexHooks, options),
    runCheck('claude hooks', checkClaudeHooks, options),
  ];

  for (const result of results) {
    io.stdout.write(`${result.level} ${result.label}: ${result.message}\n`);
  }

  const errors = results.filter((result) => result.level === 'error').length;
  const warnings = results.filter((result) => result.level === 'warn').length;
  if (errors > 0) {
    io.stdout.write(`doctor failed: ${errors} error(s), ${warnings} warning(s)\n`);
    return 1;
  }
  if (warnings > 0) {
    io.stdout.write(`doctor completed with ${warnings} warning(s)\n`);
    return 0;
  }
  io.stdout.write('doctor ok\n');
  return 0;
}
// harn:end scope-pattern-loader
// harn:end doctor-health-checks

module.exports = {
  checkClaudeHooks,
  checkCodexHooks,
  hasClaudeHook,
  hasCodexHook,
  runDoctor,
};
