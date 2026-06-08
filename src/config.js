'use strict';

const fs = require('fs');
const path = require('path');
const { baseDir } = require('./log-store');

// harn:assume interactive-install-onboarding ref=install-config
function configPath(options = {}) {
  return options.configFile || path.join(baseDir(options), 'config.json');
}

function normalizeConfig(input = {}) {
  return {
    schema_version: 1,
    telemetry_enabled: input.telemetry_enabled === true,
  };
}

function readConfig(options = {}) {
  const filePath = configPath(options);
  if (!fs.existsSync(filePath)) {
    return normalizeConfig();
  }
  return normalizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function writeConfig(config, options = {}) {
  const filePath = configPath(options);
  const normalized = normalizeConfig(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

function setTelemetryEnabled(enabled, options = {}) {
  return writeConfig({
    ...readConfig(options),
    telemetry_enabled: enabled === true,
  }, options);
}
// harn:end interactive-install-onboarding

module.exports = {
  configPath,
  normalizeConfig,
  readConfig,
  setTelemetryEnabled,
  writeConfig,
};
