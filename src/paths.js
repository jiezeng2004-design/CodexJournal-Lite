'use strict';

// src/paths.js
//
// Unified cross-platform path utilities for CodexJournal-Lite.
// Replaces the scattered expandEnv() implementations in config.js,
// idea.js, and verify.js with a single source of truth.
//
// Supports:
//   - Windows env vars: %USERPROFILE%, %APPDATA%, %LOCALAPPDATA%, %TEMP%
//   - Unix env vars: $HOME, $XDG_CONFIG_HOME, $XDG_DATA_HOME
//   - Tilde expansion: ~/path -> homeDir()/path
//   - Cross-platform default session directories for all source types

const os = require('os');
const path = require('path');

function isWindows() {
  return process.platform === 'win32';
}

function homeDir() {
  return os.homedir();
}

function expandEnv(value) {
  if (typeof value !== 'string') return value;
  let s = value;

  // Tilde expansion (works on all platforms)
  if (s.startsWith('~/')) {
    s = path.join(homeDir(), s.slice(2));
  } else if (s === '~') {
    s = homeDir();
  }

  // Windows-style env vars: %VAR%
  s = s
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE || homeDir() || '')
    .replace(/%APPDATA%/gi, process.env.APPDATA || '')
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || '')
    .replace(/%TEMP%/gi, process.env.TEMP || os.tmpdir() || '')
    .replace(/%HOME%/gi, homeDir() || '');

  // Unix-style env vars: $HOME, $XDG_CONFIG_HOME, $XDG_DATA_HOME
  // Only expand if the env var exists; otherwise leave as-is.
  s = s.replace(/\$(HOME|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_CACHE_HOME)\b/g, (match, name) => {
    return process.env[name] || match;
  });

  return s;
}

// Default session directories for each source type (cross-platform).
function defaultSessionsDir(sourceType) {
  const home = homeDir();
  switch (sourceType) {
    case 'codex':
      return path.join(home, '.codex', 'sessions');
    case 'claude':
      // Claude Code stores sessions under ~/.claude/projects/<project-hash>/
      return path.join(home, '.claude', 'projects');
    case 'gemini':
      // Gemini CLI stores checkpoints under ~/.gemini/tmp/
      return path.join(home, '.gemini', 'tmp');
    case 'opencode':
      // OpenCode stores data in XDG_DATA_HOME or ~/.local/share/opencode (Unix),
      // %LOCALAPPDATA%/opencode (Windows)
      if (isWindows()) {
        return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'opencode');
      }
      return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode');
    case 'idea':
      // JetBrains config/log directories
      if (isWindows()) {
        return path.join(process.env.APPDATA || '', 'JetBrains');
      }
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'JetBrains');
    default:
      return home;
  }
}

// Safe path join: rejects directory traversal (..) in the relative part.
function joinSafe(base, rel) {
  if (!rel) return base;
  const resolved = path.resolve(base, rel);
  const normalizedBase = path.resolve(base);
  // Ensure the resolved path is within base
  if (resolved !== normalizedBase && !resolved.startsWith(normalizedBase + path.sep)) {
    throw new Error('Path traversal detected: ' + rel + ' escapes base ' + base);
  }
  return resolved;
}

module.exports = {
  isWindows,
  homeDir,
  expandEnv,
  defaultSessionsDir,
  joinSafe
};
