'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { CLAUDE_HOOK_EVENTS } = require('../adapters/claude');
const { runClaudeBackfill } = require('../backfills/claude');

function defaultClaudeSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function hookCommand(options = {}) {
  return options.command || process.env.DIDMYAIGETDUMBER_BIN || process.argv[1] || 'didmyaigetdumber';
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// harn:assume claude-live-hook-counting ref=claude-init
function mergeClaudeSettings(existing = {}, command) {
  const next = { ...existing, hooks: { ...(existing.hooks || {}) } };
  const hook = {
    type: 'command',
    command: `${command} hook`,
    env: {
      DIDMYAIGETDUMBER_AGENT: 'claude',
    },
  };

  for (const event of CLAUDE_HOOK_EVENTS) {
    const entries = Array.isArray(next.hooks[event]) ? [...next.hooks[event]] : [];
    const filtered = entries.filter((entry) => {
      const hooks = Array.isArray(entry && entry.hooks) ? entry.hooks : [];
      return !hooks.some((item) => item && item.command === hook.command);
    });
    filtered.push({
      matcher: '',
      hooks: [hook],
    });
    next.hooks[event] = filtered;
  }

  return next;
}

async function initClaude(options = {}, io) {
  const filePath = options.configPath || defaultClaudeSettingsPath();
  const command = hookCommand(options);
  const merged = mergeClaudeSettings(readJsonIfExists(filePath), command);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`);
  io.stdout.write(`installed claude hooks: ${filePath}\n`);
  // harn:assume claude-historical-backfill ref=claude-backfill-init
  if (options.backfill) {
    return runClaudeBackfill(options, io);
  }
  // harn:end claude-historical-backfill
  return 0;
}
// harn:end claude-live-hook-counting

module.exports = {
  CLAUDE_HOOK_EVENTS,
  defaultClaudeSettingsPath,
  initClaude,
  mergeClaudeSettings,
};
