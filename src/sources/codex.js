'use strict';

// src/sources/codex.js
//
// Codex session adapter. Wraps the existing scanner/parser/classifier
// pipeline into the standard adapter interface so that the source
// dispatcher in sources/index.js can call collect() uniformly.
//
// The fingerprint caching logic stays in src/index.js processAll()
// because it is shared across all sources.

const fs = require('fs');
const path = require('path');
const scanner = require('../scanner');
const parser = require('../parser');
const classifier = require('../classifier');
const utils = require('../utils');
const sanitize = require('../sanitize');
const paths = require('../paths');

function getSessionsDir(cfg) {
  // Check sources[] for a codex source with sessionsDir
  if (cfg && cfg.sources) {
    for (const s of cfg.sources) {
      if (s && s.type === 'codex' && s.sessionsDir) return s.sessionsDir;
    }
  }
  return (cfg && cfg.sessionsDir) || paths.defaultSessionsDir('codex');
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

function probe(cfg) {
  const dir = getSessionsDir(cfg);
  const result = {
    source: 'codex',
    scannedAt: new Date().toISOString(),
    sessionsDir: dir,
    exists: false,
    files: 0
  };
  try {
    if (fs.existsSync(dir)) {
      result.exists = true;
      const scan = scanner.scanSessionsDir(dir);
      result.files = scan.files.length;
      result.missing = scan.missing;
    }
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

function buildTaskForFile(file, messages, cfg, sessionCwd) {
  const tsList = messages
    .map(function (m) { return m.timestamp; })
    .filter(function (d) { return d && !isNaN(d.getTime()); })
    .sort(function (a, b) { return a.getTime() - b.getTime(); });

  const userMsgs = messages.filter(function (m) { return m.kind === 'user'; });
  const assistantMsgs = messages.filter(function (m) { return m.kind === 'assistant'; });
  const userText = classifier.mergeUserText(userMsgs);
  const assistantText = classifier.mergeAssistantText(assistantMsgs);
  const derived = classifier.deriveTaskTypeAndKeywords(userText, assistantText);
  const taskType = derived.taskType;
  const keywords = derived.keywords;
  const firstRealUser = userMsgs.find(function (m) {
    return m.content && !classifier.isOnlyProjectContext(m.content);
  });
  const title = classifier.makeTitle(firstRealUser ? firstRealUser.content : (userMsgs[0] ? userMsgs[0].content : '(no user message)'));
  const projectPath =
    classifier.detectProjectPath(userText + '\n' + assistantText) ||
    (typeof sessionCwd === 'string' && sessionCwd ? sessionCwd : null);

  if (tsList.length === 0) {
    return [{
      id: 'u_' + utils.shortHash(file.path + '|' + file.size + '|' + messages.length),
      date: 'unknown',
      time: '??:??',
      source: 'codex-sessions',
      projectPath: projectPath || null,
      title: title,
      taskType: 'unknown',
      keywords: keywords,
      userSummary: classifier.summarizeUser(userText, cfg.maxSummaryChars),
      assistantSummary: classifier.summarizeAssistant(assistantText, cfg.maxSummaryChars),
      rawFilePath: file.path,
      messageCount: messages.length,
      firstTimestamp: null,
      lastTimestamp: null
    }];
  }

  const first = tsList[0];
  const last = tsList[tsList.length - 1];
  const date = utils.formatLocalDate(first);
  const time = utils.formatLocalTime(first);

  return [{
    id: 't_' + utils.shortHash(file.path + '|' + first.toISOString()),
    date: date,
    time: time,
    source: 'codex-sessions',
    projectPath: projectPath || null,
    title: title,
    taskType: taskType,
    keywords: keywords,
    userSummary: classifier.summarizeUser(userText, cfg.maxSummaryChars),
    assistantSummary: classifier.summarizeAssistant(assistantText, cfg.maxSummaryChars),
    rawFilePath: file.path,
    messageCount: messages.length,
    firstTimestamp: utils.safeIso(first),
    lastTimestamp: utils.safeIso(last)
  }];
}

function collect(cfg) {
  const tasks = [];
  const errors = [];
  const sessionsDir = getSessionsDir(cfg);

  const scan = scanner.scanSessionsDir(sessionsDir);
  if (scan.missing) {
    return { tasks: [], errors: [], fileCount: 0, dirCount: 0, missing: true };
  }

  for (const e of scan.errors) {
    errors.push({ path: e.path, err: e.err });
  }

  for (const file of scan.files) {
    try {
      const parseResult = parser.parseFile(file.path);
      for (const e of parseResult.errors) {
        errors.push({ path: file.path + ':' + e.lineNo, err: e.err });
      }
      // Pull the project cwd from any session_meta line
      let sessionCwd = null;
      for (const m of parseResult.messages) {
        if (m.raw && typeof m.raw === 'object' && m.raw.type === 'session_meta') {
          const cwd = parser.extractSessionMetaCwd(m.raw);
          if (cwd) { sessionCwd = cwd; break; }
        }
      }
      const fileTasks = buildTaskForFile(file, parseResult.messages, cfg, sessionCwd);
      for (const t of fileTasks) tasks.push(t);
    } catch (err) {
      errors.push({ path: file.path, err: err.message || String(err) });
    }
  }

  return { tasks: tasks, errors: errors, fileCount: scan.files.length, dirCount: 1 };
}

// Health check for the Codex source adapter.
// Checks:
//   1. sessionsDir exists
//   2. sessionsDir is readable
//   3. number of session files found
function doctor(cfg) {
  const checks = [];
  const warnings = [];
  const dir = getSessionsDir(cfg);

  // Check 1: sessionsDir existence
  let dirExists = false;
  try {
    dirExists = fs.existsSync(dir);
  } catch (err) {
    checks.push({ label: 'sessionsDir exists', pass: false, detail: sanitize.redactText(err.message) });
  }
  if (dirExists) {
    checks.push({ label: 'sessionsDir exists', pass: true, detail: sanitize.redactPath(dir) });
  } else {
    checks.push({ label: 'sessionsDir exists', pass: false, detail: sanitize.redactPath(dir) });
    warnings.push('Codex sessions directory does not exist: ' + sanitize.redactPath(dir));
  }

  // Check 2: file readability (try to stat the directory)
  let readable = false;
  if (dirExists) {
    try {
      const st = fs.statSync(dir);
      readable = st.isDirectory();
      checks.push({ label: 'sessionsDir readable', pass: readable, detail: readable ? 'directory' : 'not a directory' });
    } catch (err) {
      checks.push({ label: 'sessionsDir readable', pass: false, detail: sanitize.redactText(err.message) });
      warnings.push('Cannot stat sessions directory: ' + sanitize.redactText(err.message));
    }
  } else {
    checks.push({ label: 'sessionsDir readable', pass: false, detail: 'directory does not exist' });
  }

  // Check 3: session file count
  let fileCount = 0;
  if (readable) {
    try {
      const scan = scanner.scanSessionsDir(dir);
      fileCount = scan.files.length;
      checks.push({ label: 'session files found', pass: true, detail: String(fileCount) + ' file(s)' });
      if (fileCount === 0) {
        warnings.push('No session files found in: ' + sanitize.redactPath(dir));
      }
    } catch (err) {
      checks.push({ label: 'session files found', pass: false, detail: sanitize.redactText(err.message) });
      warnings.push('Failed to scan sessions directory: ' + sanitize.redactText(err.message));
    }
  } else {
    checks.push({ label: 'session files found', pass: false, detail: 'directory not readable' });
  }

  const healthy = checks.every(function (c) { return c.pass; });
  return { healthy: healthy, checks: checks, warnings: warnings };
}

function capabilities() {
  return {
    archive: true,
    inventory: true,
    cliRequired: false,
    supportsExport: false,
    supportsConfigDirs: false
  };
}

module.exports = {
  name: 'codex',
  type: 'codex',
  getDefaultDir: function () { return paths.defaultSessionsDir('codex'); },
  describe: describe,
  probe: probe,
  collect: collect,
  doctor: doctor,
  capabilities: capabilities,
  getSessionsDir: getSessionsDir,
  // Exported for backward compatibility and testing
  _buildTaskForFile: buildTaskForFile
};
