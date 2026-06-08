'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { runBackfill } = require('./backfill');
const { defaultClaudeSettingsPath, mergeClaudeSettings } = require('./init/claude');
const { defaultCodexHooksPath, mergeCodexHooksConfig } = require('./init/codex');
const { setTelemetryEnabled } = require('./config');

const DEFAULT_HOOK_COMMAND = 'npx --yes @richhardry/didmyaigetdumber@latest';

const WORD_ART = [
  String.raw`      _ _     _                           _            `,
  String.raw`     | (_)   | |                         (_)           `,
  String.raw`   __| |_  __| |  _ __ ___  _   _    __ _ _            `,
  String.raw`  / _` + '`' + String.raw` | |/ _` + '`' + String.raw` | | '_ ` + '`' + String.raw` _ \| | | |  / _` + '`' + String.raw` | |           `,
  String.raw` | (_| | | (_| | | | | | | | |_| | | (_| | |           `,
  String.raw`  \__,_|_|\__,_| |_| |_| |_|\__, |  \__,_|_|           `,
  String.raw`                 | |         __/ |                     `,
  String.raw`        __ _  ___| |_       |___/                      `,
  String.raw`       / _` + '`' + String.raw` |/ _ \ __|                                 `,
  String.raw`      | (_| |  __/ |_                                  `,
  String.raw`       \__, |\___|\__|              _             ___  `,
  String.raw`        __/ |    | |               | |           |__ \ `,
  String.raw`       |___/   __| |_   _ _ __ ___ | |__   ___ _ __ ) |`,
  String.raw`              / _` + '`' + String.raw` | | | | '_ ` + '`' + String.raw` _ \| '_ \ / _ \ '__/ / `,
  String.raw`             | (_| | |_| | | | | | | |_) |  __/ | |_|  `,
  String.raw`              \__,_|\__,_|_| |_| |_|_.__/ \___|_| (_)`,
].join('\n');

function supportsColor(io) {
  return Boolean(io.stdout && io.stdout.isTTY);
}

function color(io, code, text) {
  return supportsColor(io) ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseAgent(value) {
  const agent = String(value || 'all').toLowerCase();
  if (!['all', 'codex', 'claude', 'none'].includes(agent)) {
    throw new Error(`Unknown install agent: ${value}`);
  }
  return agent;
}

function parseTelemetry(value) {
  if (value === true || value === false) {
    return value;
  }
  if (value == null) {
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['on', 'yes', 'y', 'true', '1'].includes(normalized)) {
    return true;
  }
  if (['off', 'no', 'n', 'false', '0'].includes(normalized)) {
    return false;
  }
  throw new Error(`Unknown telemetry value: ${value}`);
}

function interactive(io) {
  return Boolean(io.stdin && io.stdin.isTTY && io.stdout && io.stdout.isTTY);
}

function promptYesNo(io, question, defaultYes) {
  const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
  const rl = readline.createInterface({
    input: io.stdin,
    output: io.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question}${suffix}`, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (!normalized) {
        resolve(defaultYes);
      } else {
        resolve(['y', 'yes'].includes(normalized));
      }
    });
  });
}

function selectedFromAgent(agent) {
  return {
    codex: agent === 'all' || agent === 'codex',
    claude: agent === 'all' || agent === 'claude',
  };
}

async function resolveChoices(options = {}, io) {
  if (options.yes || !interactive(io)) {
    return {
      ...selectedFromAgent(parseAgent(options.agent)),
      backfill: options.backfill !== false,
      telemetry: parseTelemetry(options.telemetry) === true,
    };
  }

  const agent = options.agent ? parseAgent(options.agent) : null;
  const selected = agent ? selectedFromAgent(agent) : {
    codex: await promptYesNo(io, 'Install Codex hooks?', true),
    claude: await promptYesNo(io, 'Install Claude Code hooks?', true),
  };
  const backfill = options.backfill == null
    ? await promptYesNo(io, 'Backfill past local Codex and Claude Code logs now?', true)
    : options.backfill !== false;
  const telemetry = parseTelemetry(options.telemetry);
  const telemetryEnabled = telemetry == null
    ? await promptYesNo(
      io,
      'Help build the public trend line by sharing privacy-preserving +1 event counts? No prompts, assistant text, paths, commands, repo names, or secrets are sent.',
      false
    )
    : telemetry;

  return {
    ...selected,
    backfill,
    telemetry: telemetryEnabled,
  };
}

function hookCommand(options = {}) {
  return options.command || process.env.DIDMYAIGETDUMBER_HOOK_COMMAND || DEFAULT_HOOK_COMMAND;
}

function installCodexHooks(options = {}, command = hookCommand(options)) {
  const filePath = options.codexConfigPath || defaultCodexHooksPath();
  if (options.dryRun) {
    return { agent: 'codex', path: filePath, action: 'would_install' };
  }
  writeJson(filePath, mergeCodexHooksConfig(readJsonIfExists(filePath), command));
  return { agent: 'codex', path: filePath, action: 'installed' };
}

function installClaudeHooks(options = {}, command = hookCommand(options)) {
  const filePath = options.claudeConfigPath || defaultClaudeSettingsPath();
  if (options.dryRun) {
    return { agent: 'claude', path: filePath, action: 'would_install' };
  }
  writeJson(filePath, mergeClaudeSettings(readJsonIfExists(filePath), command));
  return { agent: 'claude', path: filePath, action: 'installed' };
}

function renderIntro(io) {
  io.stdout.write(`${color(io, '36', WORD_ART)}\n\n`);
  io.stdout.write('Set up local AI coding-agent trend monitoring.\n');
  io.stdout.write('Logs stay aggregate-only on your machine by default.\n\n');
}

function renderHookResult(io, result) {
  const action = result.action === 'would_install' ? 'would install' : 'installed';
  io.stdout.write(`${action} ${result.agent} hooks: ${result.path}\n`);
}

// harn:assume interactive-install-onboarding ref=install-command
async function runInstall(options = {}, io) {
  renderIntro(io);

  const choices = await resolveChoices(options, io);
  const command = hookCommand(options);
  const hookResults = [];

  if (choices.codex) {
    hookResults.push(installCodexHooks(options, command));
  }
  if (choices.claude) {
    hookResults.push(installClaudeHooks(options, command));
  }
  if (hookResults.length === 0) {
    io.stdout.write('skipped hook installation\n');
  } else {
    for (const result of hookResults) {
      renderHookResult(io, result);
    }
  }

  if (options.dryRun) {
    io.stdout.write(`would save telemetry opt-in: ${choices.telemetry ? 'on' : 'off'}\n`);
  } else {
    setTelemetryEnabled(choices.telemetry, options);
    io.stdout.write(`saved telemetry opt-in: ${choices.telemetry ? 'on' : 'off'}\n`);
  }

  if (choices.telemetry) {
    io.stdout.write('thanks. this helps compare aggregate model trends across many real workflows without sending raw content.\n');
  } else {
    io.stdout.write('telemetry sharing is off. local charts and reports still work.\n');
  }

  if (choices.backfill) {
    if (options.dryRun) {
      io.stdout.write('would backfill local Codex and Claude Code logs\n');
    } else {
      await runBackfill('all', options, io);
    }
  } else {
    io.stdout.write('skipped historical backfill\n');
  }

  io.stdout.write('\nnext: didmyaigetdumber report\n');
  io.stdout.write('dashboard: didmyaigetdumber start\n');
  return 0;
}
// harn:end interactive-install-onboarding

module.exports = {
  DEFAULT_HOOK_COMMAND,
  WORD_ART,
  hookCommand,
  installClaudeHooks,
  installCodexHooks,
  parseAgent,
  parseTelemetry,
  resolveChoices,
  runInstall,
};
