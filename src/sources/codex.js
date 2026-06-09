'use strict';

// src/sources/codex.js
//
// Source-level metadata for the Codex roll-out file format. The
// actual archive pipeline (scanner -> parser -> classifier -> writer)
// is the same one used since v0.1 and is wired up directly in
// `src/index.js`. This file exists so that the multi-source registry
// in `config.json -> sources[]` has a clean place to anchor a
// `"type": "codex"` source and so that v0.5+ can move the archive
// loop onto the new dispatcher without changing config keys.

const fs = require('fs');
const path = require('path');

function getSessionsDir(cfg) {
  if (cfg && cfg.sources) {
    for (const s of cfg.sources) {
      if (s && s.type === 'codex' && s.sessionsDir) return s.sessionsDir;
    }
  }
  return (cfg && cfg.sessionsDir) || '%USERPROFILE%/.codex/sessions';
}

function describe(cfg) {
  return {
    name: 'codex',
    type: 'codex',
    enabled: true,
    sessionsDir: getSessionsDir(cfg),
    notes: 'Full archive path: writes journal/YYYY-MM-DD.md, data/tasks.json, data/stats.json, data/search.md, reports/dashboard.md.'
  };
}

// No-op probe. Kept so the source registry has a single, uniform shape.
function probe(_cfg) {
  return { source: 'codex', scannedAt: new Date().toISOString(), note: 'Use `npm run archive` for the full Codex source path.' };
}

module.exports = { describe, probe, getSessionsDir, _paths: { fs, path } };
