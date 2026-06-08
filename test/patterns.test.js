'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  categoryKey,
  loadPatterns,
  matchPatterns,
  patternPathForScope,
} = require('../src/patterns');

// harn:assume scope-pattern-loader ref=pattern-loader-tests
test('loads scope pattern files from the package', () => {
  const userPath = patternPathForScope('user');
  const assistantPath = patternPathForScope('assistant');

  assert.equal(userPath.endsWith('patterns/en/user-patterns.md'), true);
  assert.equal(assistantPath.endsWith('patterns/en/assistant-patterns.md'), true);
  assert.equal(categoryKey('user-patterns.md'), 'user_patterns');
});

test('compiles current user and assistant patterns', () => {
  const userPatterns = loadPatterns('user');
  const assistantPatterns = loadPatterns('assistant');

  assert.equal(userPatterns.length > 0, true);
  assert.equal(assistantPatterns.length > 0, true);
  assert.equal(userPatterns.every((pattern) => pattern.category === 'user_patterns'), true);
  assert.equal(assistantPatterns.every((pattern) => pattern.category === 'assistant_patterns'), true);
});

test('matches text and returns aggregate line hit data without raw text', () => {
  const result = matchPatterns('user', "this doesn't work and I don't want a new file");

  assert.equal(result.matched, true);
  assert.equal(result.events, 1);
  assert.equal(result.lineHits >= 2, true);
  assert.equal(result.hits.every((hit) => !Object.hasOwn(hit, 'text')), true);
});
// harn:end scope-pattern-loader
