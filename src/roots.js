'use strict';

const path = require('path');

// APP_ROOT: source code and built-in assets directory (read-only).
const APP_ROOT = path.resolve(__dirname, '..');

/**
 * Parse --root argument from argv.
 * @param {string[]} argv - process.argv.slice(2) or similar
 * @returns {{root?: string}}
 */
function parseRootArgs(argv) {
  const opts = {};
  if (!argv) return opts;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) {
      opts.root = argv[i + 1];
      i++;
    }
  }
  return opts;
}

/**
 * Resolve the workspace root (where data/journal/reports live).
 * Priority: opts.root > CODEXJOURNAL_ROOT env > process.cwd()
 * @param {{root?: string}} [opts] - parsed args
 * @param {Object} [env] - environment object (defaults to process.env)
 * @param {string} [cwd] - current working directory (defaults to process.cwd())
 * @returns {string} absolute path to workspace root
 */
function resolveWorkspaceRoot(opts, env, cwd) {
  if (opts && opts.root) return path.resolve(opts.root);
  var e = env || process.env;
  if (e && e.CODEXJOURNAL_ROOT) return path.resolve(e.CODEXJOURNAL_ROOT);
  return path.resolve(cwd || process.cwd());
}

/**
 * Resolve all runtime paths from appRoot and workspaceRoot.
 * @param {string} appRoot - APP_ROOT (source code directory)
 * @param {string} workspaceRoot - WORKSPACE_ROOT (user data directory)
 * @param {string} [configPath] - optional explicit config path
 * @returns {{appRoot: string, workspaceRoot: string, configPath: string, dataDir: string, journalDir: string, reportsDir: string, distDir: string, isCloneMode: boolean}}
 */
function resolveRuntimePaths(appRoot, workspaceRoot, configPath) {
  return {
    appRoot: appRoot,
    workspaceRoot: workspaceRoot,
    configPath: configPath || path.join(workspaceRoot, 'config.json'),
    dataDir: path.join(workspaceRoot, 'data'),
    journalDir: path.join(workspaceRoot, 'journal'),
    reportsDir: path.join(workspaceRoot, 'reports'),
    distDir: path.join(workspaceRoot, 'dist'),
    isCloneMode: workspaceRoot === appRoot
  };
}

module.exports = {
  APP_ROOT: APP_ROOT,
  getAppRoot: function() { return APP_ROOT; },
  parseRootArgs: parseRootArgs,
  resolveWorkspaceRoot: resolveWorkspaceRoot,
  resolveRuntimePaths: resolveRuntimePaths
};
