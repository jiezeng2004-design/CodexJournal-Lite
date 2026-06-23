'use strict';

const path = require('path');
const fs = require('fs');
const utils = require('./utils');
const paths = require('./paths');

const DEFAULT_CONFIG = {
  sessionsDir: '%USERPROFILE%/.codex/sessions',
  journalDir: 'journal',
  dataDir: 'data',
  reportsDir: 'reports',
  timezone: 'local',
  maxSummaryChars: 300,
  maxKeywordCount: 12,
  sources: [
    { name: 'codex', type: 'codex', enabled: true, archive: true, sessionsDir: '%USERPROFILE%/.codex/sessions' },
    { name: 'claude-code', type: 'claude', enabled: true, archive: true, sessionsDir: '' },
    { name: 'idea-ai', type: 'idea', enabled: true, archive: false, logDirs: [] },
    { name: 'gemini-cli', type: 'gemini', enabled: false, archive: true, sessionsDir: '' },
    { name: 'opencode', type: 'opencode', enabled: false, archive: true, mode: 'cli', sessionsDir: '' }
  ],
  redactPatterns: [],
  plugins: []
};

function loadConfig(workspaceRoot, appRoot, overrides) {
  // Determine config file path:
  // 1. --config override (highest priority)
  // 2. WORKSPACE_ROOT/config.json
  // 3. APP_ROOT/config.json (fallback for clone mode)
  let cfgPath;
  let configDir;
  if (overrides && overrides.configPath) {
    cfgPath = path.resolve(overrides.configPath);
    configDir = path.dirname(cfgPath);
  } else {
    const wsConfig = path.join(workspaceRoot, 'config.json');
    const appConfig = path.join(appRoot || workspaceRoot, 'config.json');
    if (fs.existsSync(wsConfig)) {
      cfgPath = wsConfig;
      configDir = workspaceRoot;
    } else if (fs.existsSync(appConfig)) {
      cfgPath = appConfig;
      configDir = path.dirname(appConfig);
    } else {
      cfgPath = wsConfig; // default target for first-run creation
      configDir = workspaceRoot;
    }
  }

  let userCfg = {};
  if (fs.existsSync(cfgPath)) {
    try {
      userCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (err) {
      userCfg = {};
    }
  }
  const merged = Object.assign({}, DEFAULT_CONFIG, userCfg || {});
  // Apply CLI overrides
  if (overrides && overrides.sessionsDir) {
    merged.sessionsDir = overrides.sessionsDir;
    if (merged.sources) {
      for (const s of merged.sources) {
        if (s.type === 'codex') s.sessionsDir = overrides.sessionsDir;
      }
    }
  }
  return resolvePaths(merged, workspaceRoot, configDir, cfgPath);
}

function resolvePaths(cfg, workspaceRoot, configDir, actualConfigPath) {
  const out = Object.assign({}, cfg);
  // sessionsDir: relative to configDir if relative, else expand env vars
  const rawSessions = cfg.sessionsDir || DEFAULT_CONFIG.sessionsDir;
  if (rawSessions && !path.isAbsolute(paths.expandEnv(rawSessions))) {
    out.sessionsDir = path.resolve(configDir || workspaceRoot, paths.expandEnv(rawSessions));
  } else {
    out.sessionsDir = path.resolve(paths.expandEnv(rawSessions));
  }
  // Output dirs: always relative to WORKSPACE_ROOT
  out.journalDir = path.resolve(workspaceRoot, cfg.journalDir || DEFAULT_CONFIG.journalDir);
  out.dataDir = path.resolve(workspaceRoot, cfg.dataDir || DEFAULT_CONFIG.dataDir);
  out.reportsDir = path.resolve(workspaceRoot, cfg.reportsDir || DEFAULT_CONFIG.reportsDir);
  out.projectRoot = path.resolve(workspaceRoot);
  out.workspaceRoot = path.resolve(workspaceRoot);
  out.appRoot = path.resolve(__dirname, '..');
  out.configPath = actualConfigPath || path.resolve(configDir || workspaceRoot, 'config.json');
  // Resolve per-source sessionsDir/logDirs
  // Relative paths resolve against configDir; absolute paths stay as-is
  if (out.sources) {
    out.sources = out.sources.map(function (s) {
      const copy = Object.assign({}, s);
      if (copy.sessionsDir) {
        const expanded = paths.expandEnv(copy.sessionsDir);
        if (path.isAbsolute(expanded)) {
          copy.sessionsDir = expanded;
        } else {
          copy.sessionsDir = path.resolve(configDir || workspaceRoot, expanded);
        }
      }
      if (Array.isArray(copy.logDirs)) {
        copy.logDirs = copy.logDirs.map(function (d) {
          const expanded = paths.expandEnv(d);
          if (path.isAbsolute(expanded)) return expanded;
          return path.resolve(configDir || workspaceRoot, expanded);
        });
      }
      return copy;
    });
  }
  return out;
}

function ensureOutputDirs(cfg) {
  utils.ensureDir(cfg.journalDir);
  utils.ensureDir(cfg.dataDir);
  utils.ensureDir(cfg.reportsDir);
}

module.exports = { loadConfig, ensureOutputDirs, expandEnv: paths.expandEnv, DEFAULT_CONFIG };
