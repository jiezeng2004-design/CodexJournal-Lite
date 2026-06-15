'use strict';

// src/sources/index.js
//
// Multi-source entry point. v0.4.0 currently exposes two sources:
//
//   - "codex" : the original Codex session reader. The archive path
//               still uses the legacy single-dir config (`sessionsDir`)
//               for backward compatibility, but we expose the source
//               shape here so v0.5+ can switch over cleanly.
//
//   - "idea"  : IDEA / JetBrains AI log *read-only probe*. It does
//               NOT parse log content into tasks. It walks candidate
//               JetBrains directories, surfaces files whose path or
//               first-bytes text look AI-related, and writes a human-
//               readable inventory to `reports/idea-log-inventory.md`.
//
// This module never mutates anything outside `reports/`. The Codex
// source here is metadata only; the actual archive logic lives in
// `src/index.js` + `src/scanner.js` + `src/parser.js`.

const codex = require('./codex');
const claude = require('./claude');
const idea = require('./idea');

function getSourceByName(cfg, name) {
  const sources = (cfg && cfg.sources) || [];
  for (const s of sources) {
    if (s && s.name === name) return s;
  }
  return null;
}

function isSourceEnabled(cfg, name) {
  const s = getSourceByName(cfg, name);
  return !!(s && s.enabled !== false);
}

module.exports = {
  codex,
  claude,
  idea,
  getSourceByName,
  isSourceEnabled,
  // Convenience: run the IDEA probe only. The archive path does not
  // call this; it goes through the legacy scanner/parser directly to
  // preserve the v0.1-v0.3.1 behaviour byte-for-byte.
  scanIdeaLogs: function (cfg) { return idea.scan(cfg); },
  renderInventory: function (result) { return idea.renderMarkdown(result); }
};
