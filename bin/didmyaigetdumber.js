#!/usr/bin/env node
'use strict';

// harn:assume npm-cli-entrypoint ref=bin-entrypoint
const { run } = require('../src/cli');

run(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
// harn:end npm-cli-entrypoint
