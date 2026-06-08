'use strict';

const { handleHook } = require('./hook');
const { runBackfill } = require('./backfill');
const { runDoctor } = require('./doctor');
const { initCodex } = require('./init/codex');
const { initClaude } = require('./init/claude');
const { runInstall } = require('./install');
const { runReport } = require('./report');
const { startServer } = require('./server');

const HELP = `didmyaigetdumber

Usage:
  didmyaigetdumber hook
  didmyaigetdumber install [--agent all|codex|claude|none] [--yes] [--telemetry on|off] [--no-backfill]
  didmyaigetdumber init codex [--backfill]
  didmyaigetdumber init claude [--backfill]
  didmyaigetdumber init all [--backfill]
  didmyaigetdumber backfill codex [--overwrite]
  didmyaigetdumber backfill claude [--overwrite]
  didmyaigetdumber backfill all [--overwrite]
  didmyaigetdumber doctor
  didmyaigetdumber report [--days N]
  didmyaigetdumber start [--port N]
`;

function parseOptions(args) {
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--backfill') {
      options.backfill = true;
    } else if (arg === '--no-backfill') {
      options.backfill = false;
    } else if (arg === '--overwrite') {
      options.overwrite = true;
    } else if (arg === '--yes' || arg === '-y') {
      options.yes = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--port' || arg === '--days' || arg === '--agent' || arg === '--telemetry' || arg === '--command') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      options[arg.slice(2)] = value;
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  return { positional, options };
}

async function initTarget(target, options, io) {
  if (target === 'codex') {
    return initCodex(options, io);
  }
  if (target === 'claude') {
    return initClaude(options, io);
  }
  if (target === 'all') {
    if (options.backfill) {
      const codexCode = await initCodex({ ...options, backfill: false }, io);
      const claudeCode = await initClaude({ ...options, backfill: false }, io);
      const backfillCode = await runBackfill('all', options, io);
      return codexCode || claudeCode || backfillCode;
    }
    const codexCode = await initCodex(options, io);
    const claudeCode = await initClaude(options, io);
    return codexCode || claudeCode;
  }
  throw new Error(`Unknown init target: ${target || ''}`.trim());
}

async function backfillTarget(target, options, io) {
  if (target === 'codex' || target === 'claude' || target === 'all') {
    return runBackfill(target, options, io);
  }
  throw new Error(`Unknown backfill target: ${target || ''}`.trim());
}

// harn:assume npm-cli-entrypoint ref=cli-dispatch
async function run(args, io) {
  const command = args[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    io.stdout.write(HELP);
    return 0;
  }

  if (command === '--version' || command === '-v') {
    io.stdout.write('0.1.0\n');
    return 0;
  }

  const { positional, options } = parseOptions(args.slice(1));

  if (command === 'hook') {
    return handleHook(options, io);
  }
  if (command === 'install') {
    return runInstall(options, io);
  }
  if (command === 'init') {
    return initTarget(positional[0], options, io);
  }
  if (command === 'backfill') {
    return backfillTarget(positional[0], options, io);
  }
  if (command === 'doctor') {
    return runDoctor(options, io);
  }
  if (command === 'report') {
    return runReport(options, io);
  }
  if (command === 'start') {
    return startServer(options, io);
  }

  io.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
  return 1;
}
// harn:end npm-cli-entrypoint

module.exports = {
  HELP,
  parseOptions,
  run,
};
