'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { CODEX_HOOK_EVENTS } = require('../adapters/codex');
const { runCodexBackfill } = require('../backfills/codex');

function defaultCodexHooksPath() {
  return path.join(os.homedir(), '.codex', 'hooks.json');
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

// harn:assume live-attribution-reconciliation ref=codex-init
function mergeCodexHooksConfig(existing = {}, command) {
  const next = { ...existing, hooks: { ...(existing.hooks || {}) } };
  const hookEntry = {
    name: 'didmyaigetdumber',
    command: `${command} hook`,
    env: {
      DIDMYAIGETDUMBER_AGENT: 'codex',
    },
  };

  for (const event of CODEX_HOOK_EVENTS) {
    const entries = Array.isArray(next.hooks[event]) ? [...next.hooks[event]] : [];
    const filtered = entries.filter((entry) => entry && entry.name !== hookEntry.name);
    filtered.push(hookEntry);
    next.hooks[event] = filtered;
  }

  return next;
}

async function initCodex(options = {}, io) {
  const filePath = options.configPath || defaultCodexHooksPath();
  const command = hookCommand(options);
  const merged = mergeCodexHooksConfig(readJsonIfExists(filePath), command);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`);
  io.stdout.write(`installed codex hooks: ${filePath}\n`);
  // harn:assume codex-historical-backfill ref=codex-backfill-init
  if (options.backfill) {
    return runCodexBackfill(options, io);
  }
  // harn:end codex-historical-backfill
  return 0;
}
// harn:end live-attribution-reconciliation

module.exports = {
  CODEX_HOOK_EVENTS,
  defaultCodexHooksPath,
  initCodex,
  mergeCodexHooksConfig,
};
