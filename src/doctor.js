'use strict';

const { loadPatterns } = require('./patterns');

// harn:assume scope-pattern-loader ref=doctor-pattern-check
async function runDoctor(_options, io) {
  const userPatterns = loadPatterns('user');
  const assistantPatterns = loadPatterns('assistant');
  io.stdout.write(`ok patterns (${userPatterns.length + assistantPatterns.length} regex lines)\n`);
  return 0;
}
// harn:end scope-pattern-loader

module.exports = { runDoctor };
