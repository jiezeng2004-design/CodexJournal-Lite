'use strict';

// src/sources/base-adapter.js
//
// Abstract base adapter that defines the interface contract for all
// source adapters in CodexJournal-Lite.
//
// Every source adapter (codex, claude, gemini, opencode, idea, etc.)
// must export an object with at least these properties:
//
//   - name:     string  — human-readable source name
//   - type:     string  — unique type identifier (used in config.json -> sources[].type)
//   - getDefaultDir: function() — returns the default sessions directory (cross-platform)
//   - describe: function(cfg) — returns metadata about the source
//   - probe:    function(cfg) — read-only probe, returns file listing and stats
//   - collect:  function(cfg) — core method, scans and parses, returns { tasks, errors, fileCount, dirCount }
//
// Optional:
//   - renderReport: function(result) — renders source-specific Markdown report
//   - doctor:       function(cfg) — health check, returns { healthy, checks, warnings }
//   - capabilities: function() — returns adapter capability flags
//
// The collect() method must return tasks that conform to the 14-field schema:
//   id, date, time, source, projectPath, title, taskType, keywords,
//   userSummary, assistantSummary, rawFilePath, messageCount,
//   firstTimestamp, lastTimestamp
//
// All paths and text in task records must be passed through sanitize
// before being returned (the dispatcher does NOT re-sanitize).
//
// doctor() return value structure:
//   {
//     healthy: boolean,
//     checks: [{ label: string, pass: boolean, detail?: string }],
//     warnings: [string]
//   }
//
// capabilities() return value structure:
//   {
//     archive: boolean,        — can produce archived tasks/journal
//     inventory: boolean,      — can produce an inventory/scan report
//     cliRequired: boolean,    — requires an external CLI binary
//     supportsExport: boolean, — supports exporting sessions via CLI
//     supportsConfigDirs: boolean — uses multiple configurable directories
//   }

// Default doctor() implementation: always healthy with no checks.
// Adapters should override this with source-specific health checks.
function defaultDoctor(/* cfg */) {
  return {
    healthy: true,
    checks: [],
    warnings: []
  };
}

// Default capabilities() implementation: conservative defaults.
// Adapters should override this to report their actual capabilities.
function defaultCapabilities() {
  return {
    archive: false,
    inventory: false,
    cliRequired: false,
    supportsExport: false,
    supportsConfigDirs: false
  };
}

module.exports = {
  // This file is a contract definition, not a runnable adapter.
  // It exists so that:
  //   1. The auto-discovery in index.js can skip it
  //   2. New adapter authors can require it for reference
  //
  // Example adapter:
  //
  // const baseAdapter = require('./base-adapter');
  // const paths = require('../paths');
  //
  // module.exports = {
  //   name: 'example',
  //   type: 'example',
  //   getDefaultDir: function() { return paths.defaultSessionsDir('example'); },
  //   describe: function(cfg) { return { name: this.name, type: this.type, enabled: true }; },
  //   probe: function(cfg) { return { source: this.name, exists: false, files: 0 }; },
  //   collect: function(cfg) {
  //     return { tasks: [], errors: [], fileCount: 0, dirCount: 0 };
  //   },
  //   doctor: baseAdapter.defaultDoctor,
  //   capabilities: baseAdapter.defaultCapabilities
  // };

  INTERFACE: ['name', 'type', 'getDefaultDir', 'describe', 'probe', 'collect', 'doctor', 'capabilities'],
  OPTIONAL: ['renderReport'],

  TASK_FIELDS: [
    'id', 'date', 'time', 'source', 'projectPath', 'title',
    'taskType', 'keywords', 'userSummary', 'assistantSummary',
    'rawFilePath', 'messageCount', 'firstTimestamp', 'lastTimestamp'
  ],

  // Default implementations available for adapters that do not
  // provide their own doctor() / capabilities().
  defaultDoctor: defaultDoctor,
  defaultCapabilities: defaultCapabilities
};
