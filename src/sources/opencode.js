'use strict';

// src/sources/opencode.js
//
// OpenCode AI coding session adapter.
//
// OpenCode natively uses SQLite for storage. To avoid introducing a
// database dependency, this adapter uses two strategies:
//
//   mode: 'cli'  (default) — calls `opencode session list --format json`
//                               and `opencode export <sessionID>` (top-level command).
//                               Falls back to legacy `opencode session export --session <id> --format json`.
//   mode: 'file'            — scans a directory of pre-exported JSON files
//
// If the `opencode` binary is not in PATH, the adapter gracefully
// degrades to mode: 'file' (if sessionsDir is set) or returns empty.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const classifier = require('../classifier');
const utils = require('../utils');
const paths = require('../paths');
const sanitize = require('../sanitize');

function getSourceConfig(cfg) {
  if (cfg && cfg.sources) {
    for (const s of cfg.sources) {
      if (s && s.type === 'opencode') return s;
    }
  }
  return { name: 'opencode', type: 'opencode', enabled: false, mode: 'cli', sessionsDir: '' };
}

function getSessionsDir(cfg) {
  const sc = getSourceConfig(cfg);
  if (sc.sessionsDir) return sc.sessionsDir;
  return paths.defaultSessionsDir('opencode');
}

function describe(cfg) {
  const sc = getSourceConfig(cfg);
  return {
    name: 'opencode',
    type: 'opencode',
    enabled: sc.enabled !== false,
    mode: sc.mode || 'cli',
    sessionsDir: getSessionsDir(cfg),
    notes: 'OpenCode adapter. Uses CLI export (mode: cli) or file scan (mode: file). No SQLite dependency.'
  };
}

function probe(cfg) {
  const sc = getSourceConfig(cfg);
  const result = {
    source: 'opencode',
    scannedAt: new Date().toISOString(),
    mode: sc.mode || 'cli',
    exists: false,
    files: 0
  };

  if (sc.mode === 'file') {
    const dir = getSessionsDir(cfg);
    result.sessionsDir = dir;
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        result.exists = true;
        result.files = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).length;
      }
    } catch (err) {
      result.error = err.message;
    }
  } else {
    // CLI mode: check if opencode is in PATH
    const binaryPath = sc.binaryPath || 'opencode';
    const check = cp.spawnSync(binaryPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      shell: process.platform === 'win32'
    });
    result.binaryPath = binaryPath;
    result.exists = check.status === 0 || (check.stdout && check.stdout.length > 0);
    if (result.exists) {
      result.version = (check.stdout || '').trim();
    }
  }

  return result;
}

// Check if a binary is available in PATH
function isBinaryAvailable(binaryPath) {
  const check = cp.spawnSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    shell: process.platform === 'win32'
  });
  return check.status === 0 || (check.stdout && check.stdout.length > 0);
}

// Get session list via CLI
// Tries `opencode session list --format json` first (current standard),
// then falls back to `opencode list --format json` for newer CLI versions.
function getSessionsViaCLI(binaryPath) {
  var commands = [
    ['session', 'list', '--format', 'json'],
    ['list', '--format', 'json']
  ];
  var lastError = null;
  for (var i = 0; i < commands.length; i++) {
    var result = cp.spawnSync(binaryPath, commands[i], {
      encoding: 'utf8',
      timeout: 30000,
      shell: process.platform === 'win32',
      maxBuffer: 10 * 1024 * 1024
    });
    if (result.status === 0) {
      try {
        var parsed = JSON.parse(result.stdout);
        var sessions = Array.isArray(parsed) ? parsed :
                       Array.isArray(parsed.sessions) ? parsed.sessions :
                       Array.isArray(parsed.data) ? parsed.data : [];
        return { sessions: sessions, error: null };
      } catch (err) {
        return { sessions: [], error: 'Failed to parse session list: ' + err.message };
      }
    }
    lastError = result.stderr || result.error || 'unknown';
  }
  return { sessions: [], error: 'opencode session list failed (tried: ' + commands.map(function(c) { return c.join(' '); }).join(' | ') + '): ' + lastError };
}

// Export a single session via CLI
// Tries the new top-level command `opencode export <sessionID>` first,
// then falls back to legacy `opencode session export --session <id> --format json`.
function exportSessionViaCLI(binaryPath, sessionId) {
  // New command: opencode export <sessionID> (outputs JSON by default)
  var result = cp.spawnSync(binaryPath, ['export', sessionId], {
    encoding: 'utf8',
    timeout: 30000,
    shell: process.platform === 'win32',
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status === 0) {
    try {
      return { data: JSON.parse(result.stdout), error: null };
    } catch (err) {
      // JSON parse failed on new command output — fall through to legacy
    }
  }
  // Legacy fallback: opencode session export --session <id> --format json
  result = cp.spawnSync(binaryPath, ['session', 'export', '--session', sessionId, '--format', 'json'], {
    encoding: 'utf8',
    timeout: 30000,
    shell: process.platform === 'win32',
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) {
    var triedCommands = 'opencode export ' + sessionId + ' | opencode session export --session ' + sessionId + ' --format json';
    return { data: null, error: 'opencode export failed (tried: ' + triedCommands + '): ' + (result.stderr || result.error || 'unknown') };
  }
  try {
    return { data: JSON.parse(result.stdout), error: null };
  } catch (err) {
    return { data: null, error: 'Failed to parse session export: ' + err.message };
  }
}

// Extract messages from an OpenCode session export
function extractMessages(data) {
  if (Array.isArray(data.messages)) return data.messages;
  if (data.session && Array.isArray(data.session.messages)) return data.session.messages;
  if (data.conversation && Array.isArray(data.conversation)) return data.conversation;
  if (Array.isArray(data.history)) return data.history;
  return [];
}

function normalizeMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const role = msg.role || msg.author || msg.from;
  if (!role) return null;
  const kind = (role === 'user' || role === 'human') ? 'user' :
               (role === 'assistant' || role === 'ai') ? 'assistant' : null;
  if (!kind) return null;

  let content = '';
  if (typeof msg.content === 'string') content = msg.content;
  else if (typeof msg.text === 'string') content = msg.text;
  else if (msg.content && typeof msg.content === 'object' && typeof msg.content.text === 'string') content = msg.content.text;
  if (!content) return null;

  let timestamp = null;
  const ts = msg.timestamp || msg.createdAt || msg.created_at;
  if (ts) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) timestamp = d;
  }

  return { kind: kind, content: content, timestamp: timestamp, raw: msg };
}

function buildTaskFromOpenCodeSession(sessionData, cfg) {
  const rawMessages = extractMessages(sessionData);
  const messages = [];
  for (const msg of rawMessages) {
    const normalized = normalizeMessage(msg);
    if (normalized) messages.push(normalized);
  }
  if (messages.length === 0) return [];

  const tsList = messages
    .map(function (m) { return m.timestamp; })
    .filter(function (d) { return d && !isNaN(d.getTime()); })
    .sort(function (a, b) { return a.getTime() - b.getTime(); });

  const userMsgs = messages.filter(function (m) { return m.kind === 'user'; });
  const assistantMsgs = messages.filter(function (m) { return m.kind === 'assistant'; });
  const userText = classifier.mergeUserText(userMsgs);
  const assistantText = classifier.mergeAssistantText(assistantMsgs);
  const derived = classifier.deriveTaskTypeAndKeywords(userText, assistantText);
  const title = classifier.makeTitle(userMsgs[0] ? userMsgs[0].content : '(no user message)');
  const cwd = sessionData.cwd || sessionData.workingDirectory || null;
  const projectPath = cwd || classifier.detectProjectPath(userText + '\n' + assistantText) || null;
  const sessionId = sessionData.id || sessionData.sessionId || '';

  if (tsList.length === 0) {
    return [{
      id: 'opencode_u_' + utils.shortHash(sessionId + '|' + messages.length),
      date: 'unknown',
      time: '??:??',
      source: 'opencode',
      projectPath: projectPath,
      title: title,
      taskType: 'unknown',
      keywords: derived.keywords,
      userSummary: classifier.summarizeUser(userText, cfg.maxSummaryChars),
      assistantSummary: classifier.summarizeAssistant(assistantText, cfg.maxSummaryChars),
      rawFilePath: sessionId || 'opencode-session',
      messageCount: messages.length,
      firstTimestamp: null,
      lastTimestamp: null
    }];
  }

  const first = tsList[0];
  const last = tsList[tsList.length - 1];

  return [{
    id: 'opencode_' + utils.shortHash(sessionId + '|' + first.toISOString()),
    date: utils.formatLocalDate(first),
    time: utils.formatLocalTime(first),
    source: 'opencode',
    projectPath: projectPath,
    title: title,
    taskType: derived.taskType,
    keywords: derived.keywords,
    userSummary: classifier.summarizeUser(userText, cfg.maxSummaryChars),
    assistantSummary: classifier.summarizeAssistant(assistantText, cfg.maxSummaryChars),
    rawFilePath: sessionId || 'opencode-session',
    messageCount: messages.length,
    firstTimestamp: utils.safeIso(first),
    lastTimestamp: utils.safeIso(last)
  }];
}

function collect(cfg) {
  const tasks = [];
  const errors = [];
  let fileCount = 0;
  const sc = getSourceConfig(cfg);
  const mode = sc.mode || 'cli';

  if (mode === 'file') {
    // File mode: scan directory for pre-exported JSON files
    const dir = getSessionsDir(cfg);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch (_) {
      return { tasks: [], errors: [], fileCount: 0, dirCount: 0, missing: true };
    }
    if (!stat.isDirectory()) {
      return { tasks: [], errors: [], fileCount: 0, dirCount: 0, missing: true };
    }

    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      return { tasks: [], errors: [{ path: dir, err: err.message }], fileCount: 0, dirCount: 0 };
    }

    for (const fileName of entries) {
      if (!fileName.endsWith('.json')) continue;
      const filePath = path.join(dir, fileName);
      fileCount++;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        const fileTasks = buildTaskFromOpenCodeSession(data, cfg);
        for (const t of fileTasks) tasks.push(t);
      } catch (err) {
        errors.push({ path: filePath, err: err.message || String(err) });
      }
    }
  } else {
    // CLI mode: use opencode CLI to list and export sessions
    const binaryPath = sc.binaryPath || 'opencode';
    if (!isBinaryAvailable(binaryPath)) {
      return { tasks: [], errors: [{ path: '', err: 'opencode binary not found in PATH' }], fileCount: 0, dirCount: 0, missing: true };
    }

    const listResult = getSessionsViaCLI(binaryPath);
    if (listResult.error) {
      errors.push({ path: '', err: sanitize.redactText(listResult.error) });
      return { tasks: [], errors: errors, fileCount: 0, dirCount: 0 };
    }

    for (const session of listResult.sessions) {
      const sessionId = session.id || session.sessionId || session.uuid;
      if (!sessionId) continue;
      fileCount++;
      const exportResult = exportSessionViaCLI(binaryPath, sessionId);
      if (exportResult.error) {
        errors.push({ path: sessionId, err: sanitize.redactText(exportResult.error) });
        continue;
      }
      if (exportResult.data) {
        const fileTasks = buildTaskFromOpenCodeSession(exportResult.data, cfg);
        for (const t of fileTasks) tasks.push(t);
      }
    }
  }

  return { tasks: tasks, errors: errors, fileCount: fileCount, dirCount: 1 };
}

// Check if a binary is available in PATH using which/where.
function findBinaryInPath(binaryName) {
  const cp = require('child_process');
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = cp.spawnSync(cmd, [binaryName], {
      encoding: 'utf8',
      timeout: 5000,
      shell: process.platform === 'win32'
    });
    if (result.status === 0 && result.stdout) {
      const lines = result.stdout.trim().split(/\r?\n/);
      return { found: true, path: lines[0] || '' };
    }
    return { found: false, path: '' };
  } catch (err) {
    return { found: false, path: '', error: err.message };
  }
}

// Health check for the OpenCode source adapter.
// Checks:
//   1. CLI availability (which/where opencode)
//   2. directory existence (file mode) or CLI version (cli mode)
function doctor(cfg) {
  const checks = [];
  const warnings = [];
  const sc = getSourceConfig(cfg);
  const mode = sc.mode || 'cli';
  const binaryPath = sc.binaryPath || 'opencode';

  // Check 1: CLI availability
  const binCheck = findBinaryInPath('opencode');
  if (binCheck.found) {
    checks.push({ label: 'opencode CLI available', pass: true, detail: sanitize.redactPath(binCheck.path) });
  } else {
    checks.push({ label: 'opencode CLI available', pass: false, detail: binCheck.error ? sanitize.redactText(binCheck.error) : 'not found in PATH' });
    warnings.push('opencode binary not found in PATH. Install opencode CLI or switch to file mode.');
  }

  // Check 2: mode-specific checks
  if (mode === 'file') {
    // File mode: check directory existence
    const dir = getSessionsDir(cfg);
    let dirExists = false;
    try {
      dirExists = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch (_) {}
    if (dirExists) {
      let jsonCount = 0;
      try {
        jsonCount = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).length;
      } catch (_) {}
      checks.push({ label: 'sessionsDir exists (file mode)', pass: true, detail: sanitize.redactPath(dir) + ' (' + jsonCount + ' .json file(s))' });
      if (jsonCount === 0) {
        warnings.push('No .json export files found in: ' + sanitize.redactPath(dir));
      }
    } else {
      checks.push({ label: 'sessionsDir exists (file mode)', pass: false, detail: sanitize.redactPath(dir) });
      warnings.push('OpenCode sessions directory does not exist: ' + sanitize.redactPath(dir));
    }
  } else {
    // CLI mode: check CLI version
    let cliOk = false;
    let versionDetail = '';
    try {
      const result = cp.spawnSync(binaryPath, ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
        shell: process.platform === 'win32'
      });
      cliOk = result.status === 0 || (result.stdout && result.stdout.length > 0);
      versionDetail = (result.stdout || '').trim();
    } catch (err) {
      versionDetail = sanitize.redactText(err.message);
    }
    if (cliOk) {
      checks.push({ label: 'opencode CLI responds (cli mode)', pass: true, detail: sanitize.redactText(versionDetail) });
    } else {
      checks.push({ label: 'opencode CLI responds (cli mode)', pass: false, detail: sanitize.redactText(versionDetail) });
      warnings.push('opencode CLI did not respond to --version. Check installation or binary path.');
    }
  }

  const healthy = checks.every(function (c) { return c.pass; });
  return { healthy: healthy, checks: checks, warnings: warnings };
}

function capabilities() {
  return {
    archive: true,
    inventory: true,
    cliRequired: true,
    supportsExport: true,
    supportsConfigDirs: false
  };
}

module.exports = {
  name: 'opencode',
  type: 'opencode',
  getDefaultDir: function () { return paths.defaultSessionsDir('opencode'); },
  describe: describe,
  probe: probe,
  collect: collect,
  doctor: doctor,
  capabilities: capabilities,
  getSessionsDir: getSessionsDir,
  _internal: {
    extractMessages: extractMessages,
    normalizeMessage: normalizeMessage,
    buildTaskFromOpenCodeSession: buildTaskFromOpenCodeSession,
    exportSessionViaCLI: exportSessionViaCLI,
    getSessionsViaCLI: getSessionsViaCLI,
    isBinaryAvailable: isBinaryAvailable,
    findBinaryInPath: findBinaryInPath
  }
};
