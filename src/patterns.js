'use strict';

const fs = require('fs');
const path = require('path');

const SCOPE_FILES = {
  user: ['user-1pt.md', 'user-2pt.md'],
  assistant: ['assistant-1pt.md', 'assistant-2pt.md'],
};

function packageRoot() {
  return path.resolve(__dirname, '..');
}

function categoryKey(fileName) {
  return path.basename(fileName, '.md').replace(/-/g, '_');
}

function patternFileNamesForScope(scope) {
  const fileNames = SCOPE_FILES[scope];
  if (!fileNames) {
    throw new Error(`Unknown pattern scope: ${scope}`);
  }
  return fileNames;
}

function patternPathsForScope(scope, options = {}) {
  const fileNames = patternFileNamesForScope(scope);
  const locale = options.locale || 'en';
  const root = options.root || packageRoot();
  return fileNames.map((fileName) => path.join(root, 'patterns', locale, fileName));
}

function patternPathForScope(scope, options = {}) {
  return patternPathsForScope(scope, options)[0];
}

// harn:assume tiered-pattern-loader ref=loader-api
function loadPatterns(scope, options = {}) {
  return patternPathsForScope(scope, options).flatMap((filePath) => {
    const fileName = path.basename(filePath);
    const category = categoryKey(fileName);
    const raw = fs.readFileSync(filePath, 'utf8');

    return raw.split(/\r?\n/).flatMap((line, index) => {
      const source = line.trim();
      if (!source || source.startsWith('#')) {
        return [];
      }
      return [{
        scope,
        category,
        file: fileName,
        line: index + 1,
        source,
        regex: new RegExp(source, 'i'),
      }];
    });
  });
}

function matchPatterns(scope, text, options = {}) {
  const patterns = options.patterns || loadPatterns(scope, options);
  const hits = [];

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(String(text || ''))) {
      hits.push({
        category: pattern.category,
        file: pattern.file,
        line: pattern.line,
      });
    }
  }

  return {
    matched: hits.length > 0,
    events: hits.length > 0 ? 1 : 0,
    lineHits: hits.length,
    hits,
  };
}
// harn:end tiered-pattern-loader

module.exports = {
  SCOPE_FILES,
  categoryKey,
  loadPatterns,
  matchPatterns,
  patternFileNamesForScope,
  patternPathForScope,
  patternPathsForScope,
};
