'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  categoryKey,
  loadPatterns,
  matchPatterns,
  patternPathsForScope,
} = require('../src/patterns');

// harn:assume tiered-pattern-loader ref=pattern-loader-tests
test('loads tiered scope pattern files from the package', () => {
  const userPaths = patternPathsForScope('user');
  const assistantPaths = patternPathsForScope('assistant');

  assert.equal(userPaths.some((filePath) => filePath.endsWith('patterns/en/user-1pt.md')), true);
  assert.equal(userPaths.some((filePath) => filePath.endsWith('patterns/en/user-2pt.md')), true);
  assert.equal(assistantPaths.some((filePath) => filePath.endsWith('patterns/en/assistant-1pt.md')), true);
  assert.equal(assistantPaths.some((filePath) => filePath.endsWith('patterns/en/assistant-2pt.md')), true);
  assert.equal(categoryKey('user-2pt.md'), 'user_2pt');
});

test('compiles current user and assistant patterns while ignoring comments', () => {
  const userPatterns = loadPatterns('user');
  const assistantPatterns = loadPatterns('assistant');

  assert.equal(userPatterns.length > 0, true);
  assert.equal(assistantPatterns.length > 0, true);
  assert.equal(userPatterns.some((pattern) => pattern.category === 'user_1pt'), true);
  assert.equal(userPatterns.some((pattern) => pattern.category === 'user_2pt'), true);
  assert.equal(assistantPatterns.some((pattern) => pattern.category === 'assistant_1pt'), true);
  assert.equal(assistantPatterns.some((pattern) => pattern.category === 'assistant_2pt'), true);
  assert.equal(userPatterns.every((pattern) => !pattern.source.startsWith('#')), true);
});

test('matches text and returns aggregate line hit data without raw text', () => {
  const result = matchPatterns('user', "this doesn't work and I don't want a new file");

  assert.equal(result.matched, true);
  assert.equal(result.events, 1);
  assert.equal(result.lineHits >= 2, true);
  assert.equal(result.hits.every((hit) => !Object.hasOwn(hit, 'text')), true);
});
// harn:end tiered-pattern-loader
