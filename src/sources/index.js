'use strict';

// src/sources/index.js
//
// Multi-source entry point with auto-discovery.
//
// Scans the src/sources/ directory for adapter modules (.js files,
// excluding index.js, base-adapter.js, and *.test.js). Each module
// must export `type` (string) and `collect` (function) to be registered.
//
// Also supports external plugins from config.json -> plugins[]
// (array of absolute or relative file paths).
//
// The collectAll() function iterates over all enabled sources in
// config.json -> sources[] and calls each adapter's collect() method.

const fs = require('fs');
const path = require('path');

// -------- auto-discovery -------------------------------------------------

let _adapterCache = null;

function loadAdapters() {
  if (_adapterCache) return _adapterCache;

  const adapters = {};
  const dir = __dirname;

  // Built-in adapters: scan the sources directory
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {}

  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.js')) continue;
    if (ent.name === 'index.js' || ent.name === 'base-adapter.js') continue;
    if (ent.name.endsWith('.test.js')) continue;
    try {
      const mod = require('./' + ent.name);
      if (mod && mod.type && typeof mod.collect === 'function') {
        adapters[mod.type] = mod;
      }
    } catch (_) {
      // Skip modules that fail to load
    }
  }

  _adapterCache = adapters;
  return adapters;
}

// -------- external plugin loading ----------------------------------------

function loadPlugins(cfg) {
  const plugins = (cfg && cfg.plugins) || [];
  const adapters = loadAdapters();
  for (const p of plugins) {
    if (typeof p !== 'string') continue;
    try {
      const abs = path.isAbsolute(p) ? p : path.resolve(cfg.projectRoot || process.cwd(), p);
      const mod = require(abs);
      if (mod && mod.type && typeof mod.collect === 'function') {
        adapters[mod.type] = mod;
      }
    } catch (_) {
      // Skip plugins that fail to load
    }
  }
  return adapters;
}

// -------- config helpers -------------------------------------------------

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

function getSourceByType(cfg, type) {
  const sources = (cfg && cfg.sources) || [];
  for (const s of sources) {
    if (s && s.type === type) return s;
  }
  return null;
}

// Whether a source should participate in archive (vs inventory-only).
// Default: enabled sources are archive-enabled unless explicitly archive:false.
// IDEA/JetBrains defaults to archive:false (inventory-only).
function isSourceArchiveEnabled(srcCfg) {
  if (!srcCfg || srcCfg.enabled === false) return false;
  if (srcCfg.archive === false) return false;
  // IDEA defaults to inventory-only
  if (srcCfg.type === 'idea' && srcCfg.archive === undefined) return false;
  return true;
}

function shouldArchiveSource(srcCfg) {
  return isSourceArchiveEnabled(srcCfg);
}

// -------- collect from all enabled sources -------------------------------

function collectAll(cfg, opts) {
  const skipTypes = (opts && opts.skipTypes) || [];
  const archiveOnly = !!(opts && opts.archiveOnly);
  const adapters = loadPlugins(cfg);
  const allTasks = [];
  const allErrors = [];
  const sourceStats = {};

  const sources = (cfg && cfg.sources) || [];
  for (const srcCfg of sources) {
    if (!srcCfg || srcCfg.enabled === false) continue;
    if (skipTypes.indexOf(srcCfg.type) >= 0) continue;
    if (archiveOnly && !shouldArchiveSource(srcCfg)) continue;
    const adapter = adapters[srcCfg.type];
    if (!adapter) {
      allErrors.push({ path: '', err: 'unknown source type: ' + srcCfg.type });
      continue;
    }
    try {
      const result = adapter.collect(cfg);
      allTasks.push.apply(allTasks, result.tasks || []);
      allErrors.push.apply(allErrors, result.errors || []);
      sourceStats[srcCfg.name || srcCfg.type] = {
        tasks: (result.tasks || []).length,
        files: result.fileCount || 0,
        dirs: result.dirCount || 0,
        errors: (result.errors || []).length
      };
    } catch (err) {
      allErrors.push({ path: '', err: (srcCfg.name || srcCfg.type) + ' collect: ' + (err.message || String(err)) });
      sourceStats[srcCfg.name || srcCfg.type] = { tasks: 0, files: 0, dirs: 0, errors: 1 };
    }
  }

  return { tasks: allTasks, errors: allErrors, sourceStats };
}

// -------- probe all sources ----------------------------------------------

function probeAll(cfg) {
  const adapters = loadPlugins(cfg);
  const results = [];
  const sources = (cfg && cfg.sources) || [];
  for (const srcCfg of sources) {
    if (!srcCfg || srcCfg.enabled === false) continue;
    const adapter = adapters[srcCfg.type];
    if (!adapter) continue;
    try {
      const probeResult = adapter.probe(cfg);
      probeResult.name = srcCfg.name || srcCfg.type;
      probeResult.type = srcCfg.type;
      probeResult.enabled = true;
      results.push(probeResult);
    } catch (err) {
      results.push({
        name: srcCfg.name || srcCfg.type,
        type: srcCfg.type,
        enabled: true,
        error: err.message || String(err)
      });
    }
  }
  return results;
}

// -------- doctor all sources ---------------------------------------------

// Run doctor() on every enabled source adapter. For adapters that do
// not implement doctor(), falls back to the default implementation
// from base-adapter.js (always healthy with no checks).
//
// Returns an array of:
//   {
//     name: string,         — source name from config
//     type: string,         — source type
//     enabled: boolean,     — always true (disabled sources are skipped)
//     archive: boolean,     — whether archive is enabled for this source
//     capabilities: object, — adapter capabilities() result
//     doctor: object        — adapter doctor() result { healthy, checks, warnings }
//   }
function doctorAll(cfg) {
  const baseAdapter = require('./base-adapter');
  const adapters = loadPlugins(cfg);
  const results = [];
  const sources = (cfg && cfg.sources) || [];
  for (const srcCfg of sources) {
    if (!srcCfg || srcCfg.enabled === false) continue;
    const adapter = adapters[srcCfg.type];
    if (!adapter) continue;

    const entry = {
      name: srcCfg.name || srcCfg.type,
      type: srcCfg.type,
      enabled: true,
      archive: isSourceArchiveEnabled(srcCfg),
      capabilities: null,
      doctor: null
    };

    // capabilities(): use adapter implementation or default
    try {
      if (typeof adapter.capabilities === 'function') {
        entry.capabilities = adapter.capabilities();
      } else {
        entry.capabilities = baseAdapter.defaultCapabilities();
      }
    } catch (err) {
      entry.capabilities = baseAdapter.defaultCapabilities();
    }

    // doctor(): use adapter implementation or default
    try {
      if (typeof adapter.doctor === 'function') {
        entry.doctor = adapter.doctor(cfg);
      } else {
        entry.doctor = baseAdapter.defaultDoctor(cfg);
      }
    } catch (err) {
      entry.doctor = {
        healthy: false,
        checks: [{ label: 'doctor() execution', pass: false, detail: err.message || String(err) }],
        warnings: ['doctor() threw an error: ' + (err.message || String(err))]
      };
    }

    results.push(entry);
  }
  return results;
}

// -------- backward-compatible exports ------------------------------------

module.exports = {
  // Auto-discovery
  loadAdapters,
  loadPlugins,
  collectAll,
  probeAll,
  doctorAll,
  // Backward-compatible direct references — delegate to loadAdapters()
  // so they always reflect the current state (including plugins loaded
  // after module initialisation).
  get codex() { return loadAdapters().codex; },
  get claude() { return loadAdapters().claude; },
  get idea() { return loadAdapters().idea; },
  // Config helpers
  getSourceByName,
  isSourceEnabled,
  getSourceByType,
  isSourceArchiveEnabled,
  shouldArchiveSource,
  // Convenience: run the IDEA probe only
  scanIdeaLogs: function (cfg) {
    const adapters = loadAdapters();
    const idea = adapters.idea;
    return idea ? idea.scan(cfg) : { source: 'idea-ai', existingRoots: [], discoveredLogDirs: [], summary: {} };
  },
  renderInventory: function (result) {
    const adapters = loadAdapters();
    const idea = adapters.idea;
    return idea ? idea.renderMarkdown(result) : '';
  }
};
