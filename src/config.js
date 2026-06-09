'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const utils = require('./utils');

const DEFAULT_CONFIG = {
  sessionsDir: '%USERPROFILE%/.codex/sessions',
  journalDir: 'journal',
  dataDir: 'data',
  reportsDir: 'reports',
  timezone: 'local',
  maxSummaryChars: 300,
  maxKeywordCount: 12
};

function expandEnv(value) {
  if (typeof value !== 'string') return value;
  if (process.platform !== 'win32') {
    return value
      .replace(/%USERPROFILE%/gi, os.homedir() || '')
      .replace(/%APPDATA%/gi, process.env.APPDATA || '')
      .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || '')
      .replace(/%TEMP%/gi, os.tmpdir() || '')
      .replace(/%HOME%/gi, os.homedir() || '');
  }
  return value
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE || os.homedir() || '')
    .replace(/%APPDATA%/gi, process.env.APPDATA || '')
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || '')
    .replace(/%TEMP%/gi, process.env.TEMP || os.tmpdir() || '')
    .replace(/%HOME%/gi, os.homedir() || '');
}

function loadConfig(projectRoot) {
  const cfgPath = path.join(projectRoot, 'config.json');
  let userCfg = {};
  if (fs.existsSync(cfgPath)) {
    try {
      userCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (err) {
      // Bad config: fall back to defaults but keep going.
      userCfg = {};
    }
  }
  const merged = Object.assign({}, DEFAULT_CONFIG, userCfg || {});
  return resolvePaths(merged, projectRoot);
}

function resolvePaths(cfg, projectRoot) {
  const out = Object.assign({}, cfg);
  out.sessionsDir = path.resolve(expandEnv(cfg.sessionsDir || DEFAULT_CONFIG.sessionsDir));
  out.journalDir = path.resolve(projectRoot, cfg.journalDir || DEFAULT_CONFIG.journalDir);
  out.dataDir = path.resolve(projectRoot, cfg.dataDir || DEFAULT_CONFIG.dataDir);
  out.reportsDir = path.resolve(projectRoot, cfg.reportsDir || DEFAULT_CONFIG.reportsDir);
  out.projectRoot = path.resolve(projectRoot);
  out.configPath = path.resolve(projectRoot, 'config.json');
  return out;
}

function ensureOutputDirs(cfg) {
  utils.ensureDir(cfg.journalDir);
  utils.ensureDir(cfg.dataDir);
  utils.ensureDir(cfg.reportsDir);
}

module.exports = { loadConfig, ensureOutputDirs, expandEnv, DEFAULT_CONFIG };
