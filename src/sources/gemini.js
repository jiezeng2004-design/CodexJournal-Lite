'use strict';

// src/sources/gemini.js
//
// Gemini CLI (Google) AI coding session adapter.
//
// Gemini CLI stores session checkpoints in:
//   ~/.gemini/tmp/         (checkpoint files)
//   ~/.gemini/checkpoints/ (alternative location)
//
// Checkpoint format is JSON with a messages array:
//   {
//     "sessionId": "...",
//     "timestamp": "...",
//     "cwd": "/path",
//     "messages": [
//       {"role": "user", "content": "...", "timestamp": "..."},
//       {"role": "model", "content": "...", "timestamp": "..."}
//     ]
//   }
//
// The adapter is tolerant: it tries multiple JSON structures and
// falls back gracefully when the format doesn't match expectations.

const fs = require('fs');
const path = require('path');
const classifier = require('../classifier');
const utils = require('../utils');
const paths = require('../paths');
const sanitize = require('../sanitize');

function getSessionsDir(cfg) {
  if (cfg && cfg.sources) {
    for (const s of cfg.sources) {
      if (s && s.type === 'gemini' && s.sessionsDir) return s.sessionsDir;
    }
  }
  return paths.defaultSessionsDir('gemini');
}

function describe(cfg) {
  return {
    name: 'gemini-cli',
    type: 'gemini',
    enabled: false,
    sessionsDir: getSessionsDir(cfg),
    notes: 'Gemini CLI session adapter. Parses checkpoint JSON files from ~/.gemini/tmp/.'
  };
}

function probe(cfg) {
  const dir = getSessionsDir(cfg);
  const result = {
    source: 'gemini-cli',
    scannedAt: new Date().toISOString(),
    sessionsDir: dir,
    exists: false,
    files: 0
  };
  try {
    if (fs.existsSync(dir)) {
      result.exists = true;
      const entries = fs.readdirSync(dir);
      result.files = entries.filter(function (f) { return f.endsWith('.json'); }).length;
    }
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

// Try to find messages in various JSON structures
function extractMessages(obj) {
  // Structure 1: { messages: [...] }
  if (Array.isArray(obj.messages)) return obj.messages;
  // Structure 2: { history: [...] }
  if (Array.isArray(obj.history)) return obj.history;
  // Structure 3: { conversation: { messages: [...] } }
  if (obj.conversation && Array.isArray(obj.conversation.messages)) return obj.conversation.messages;
  // Structure 4: { turns: [...] }
  if (Array.isArray(obj.turns)) return obj.turns;
  return [];
}

// Normalize a Gemini message to { kind, content, timestamp }
function normalizeMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;

  // Determine role
  const role = msg.role || msg.author || msg.from;
  if (!role) return null;
  const kind = (role === 'user' || role === 'human') ? 'user' :
               (role === 'model' || role === 'assistant' || role === 'ai') ? 'assistant' : null;
  if (!kind) return null;

  // Extract content
  let content = '';
  if (typeof msg.content === 'string') {
    content = msg.content;
  } else if (typeof msg.text === 'string') {
    content = msg.text;
  } else if (Array.isArray(msg.parts)) {
    // Gemini API format: { parts: [{ text: "..." }] }
    content = msg.parts
      .filter(function (p) { return p && typeof p.text === 'string'; })
      .map(function (p) { return p.text; })
      .join('\n');
  } else if (msg.content && typeof msg.content === 'object') {
    if (typeof msg.content.text === 'string') content = msg.content.text;
  }

  if (!content) return null;

  // Extract timestamp
  let timestamp = null;
  const ts = msg.timestamp || msg.ts || msg.createdAt || msg.created_at;
  if (ts) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) timestamp = d;
  }

  return { kind: kind, content: content, timestamp: timestamp, raw: msg };
}

function parseGeminiFile(filePath, cfg) {
  const errors = [];
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { messages: [], cwd: null, sessionId: null, errors: [{ path: filePath, err: err.message }] };
  }

  let obj;
  try {
    obj = JSON.parse(content);
  } catch (err) {
    return { messages: [], cwd: null, sessionId: null, errors: [{ path: filePath, err: 'JSON parse: ' + err.message }] };
  }

  const rawMessages = extractMessages(obj);
  const messages = [];
  for (const msg of rawMessages) {
    const normalized = normalizeMessage(msg);
    if (normalized) messages.push(normalized);
  }

  const cwd = obj.cwd || obj.workingDirectory || obj.projectPath || null;
  const sessionId = obj.sessionId || obj.id || null;

  // Fallback: use file mtime if no timestamps found
  if (messages.length > 0 && !messages[0].timestamp) {
    try {
      const st = fs.statSync(filePath);
      const mtime = new Date(st.mtimeMs);
      for (const m of messages) {
        if (!m.timestamp) m.timestamp = mtime;
      }
    } catch (_) {}
  }

  // Also try top-level timestamp
  if (messages.length > 0 && !messages[0].timestamp && obj.timestamp) {
    const d = new Date(obj.timestamp);
    if (!isNaN(d.getTime())) {
      for (const m of messages) {
        if (!m.timestamp) m.timestamp = d;
      }
    }
  }

  return { messages: messages, cwd: cwd, sessionId: sessionId, errors: errors };
}

function buildTaskFromGeminiSession(filePath, parsed, cfg) {
  const messages = parsed.messages;
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
  const projectPath = parsed.cwd || classifier.detectProjectPath(userText + '\n' + assistantText) || null;

  if (tsList.length === 0) {
    return [{
      id: 'gemini_u_' + utils.shortHash(filePath + '|' + messages.length),
      date: 'unknown',
      time: '??:??',
      source: 'gemini-cli',
      projectPath: projectPath,
      title: title,
      taskType: 'unknown',
      keywords: derived.keywords,
      userSummary: classifier.summarizeUser(userText, cfg.maxSummaryChars),
      assistantSummary: classifier.summarizeAssistant(assistantText, cfg.maxSummaryChars),
      rawFilePath: filePath,
      messageCount: messages.length,
      firstTimestamp: null,
      lastTimestamp: null
    }];
  }

  const first = tsList[0];
  const last = tsList[tsList.length - 1];

  return [{
    id: 'gemini_' + utils.shortHash(filePath + '|' + first.toISOString()),
    date: utils.formatLocalDate(first),
    time: utils.formatLocalTime(first),
    source: 'gemini-cli',
    projectPath: projectPath,
    title: title,
    taskType: derived.taskType,
    keywords: derived.keywords,
    userSummary: classifier.summarizeUser(userText, cfg.maxSummaryChars),
    assistantSummary: classifier.summarizeAssistant(assistantText, cfg.maxSummaryChars),
    rawFilePath: filePath,
    messageCount: messages.length,
    firstTimestamp: utils.safeIso(first),
    lastTimestamp: utils.safeIso(last)
  }];
}

function collect(cfg) {
  const tasks = [];
  const errors = [];
  let fileCount = 0;

  const sessionsDir = getSessionsDir(cfg);

  let stat;
  try {
    stat = fs.statSync(sessionsDir);
  } catch (_) {
    return { tasks: [], errors: [], fileCount: 0, dirCount: 0, missing: true };
  }
  if (!stat.isDirectory()) {
    return { tasks: [], errors: [], fileCount: 0, dirCount: 0, missing: true };
  }

  let entries;
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch (err) {
    return { tasks: [], errors: [{ path: sessionsDir, err: err.message }], fileCount: 0, dirCount: 0 };
  }

  for (const fileName of entries) {
    if (!fileName.endsWith('.json')) continue;
    const filePath = path.join(sessionsDir, fileName);
    fileCount++;
    try {
      const parsed = parseGeminiFile(filePath, cfg);
      for (const e of parsed.errors) errors.push(e);
      const fileTasks = buildTaskFromGeminiSession(filePath, parsed, cfg);
      for (const t of fileTasks) tasks.push(t);
    } catch (err) {
      errors.push({ path: filePath, err: err.message || String(err) });
    }
  }

  return { tasks: tasks, errors: errors, fileCount: fileCount, dirCount: 1 };
}

// Health check for the Gemini CLI source adapter.
// Checks:
//   1. tmp directory exists
//   2. tmp directory is a directory
//   3. .json checkpoint files found
function doctor(cfg) {
  const checks = [];
  const warnings = [];
  const dir = getSessionsDir(cfg);

  // Check 1: tmp directory existence
  let dirExists = false;
  try {
    dirExists = fs.existsSync(dir);
  } catch (err) {
    checks.push({ label: 'tmp dir exists', pass: false, detail: sanitize.redactText(err.message) });
  }
  if (dirExists) {
    checks.push({ label: 'tmp dir exists', pass: true, detail: sanitize.redactPath(dir) });
  } else {
    checks.push({ label: 'tmp dir exists', pass: false, detail: sanitize.redactPath(dir) });
    warnings.push('Gemini tmp directory does not exist: ' + sanitize.redactPath(dir));
  }

  // Check 2: is it a directory?
  let isDir = false;
  if (dirExists) {
    try {
      const st = fs.statSync(dir);
      isDir = st.isDirectory();
      checks.push({ label: 'tmp dir is directory', pass: isDir, detail: isDir ? 'directory' : 'not a directory' });
    } catch (err) {
      checks.push({ label: 'tmp dir is directory', pass: false, detail: sanitize.redactText(err.message) });
      warnings.push('Cannot stat tmp directory: ' + sanitize.redactText(err.message));
    }
  } else {
    checks.push({ label: 'tmp dir is directory', pass: false, detail: 'directory does not exist' });
  }

  // Check 3: .json checkpoint files
  let jsonCount = 0;
  if (isDir) {
    try {
      const entries = fs.readdirSync(dir);
      jsonCount = entries.filter(function (f) { return f.endsWith('.json'); }).length;
      checks.push({ label: 'checkpoint files found', pass: true, detail: jsonCount + ' .json file(s)' });
      if (jsonCount === 0) {
        warnings.push('No .json checkpoint files found in: ' + sanitize.redactPath(dir));
      }
    } catch (err) {
      checks.push({ label: 'checkpoint files found', pass: false, detail: sanitize.redactText(err.message) });
      warnings.push('Failed to read tmp directory: ' + sanitize.redactText(err.message));
    }
  } else {
    checks.push({ label: 'checkpoint files found', pass: false, detail: 'tmp dir not accessible' });
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
  name: 'gemini-cli',
  type: 'gemini',
  getDefaultDir: function () { return paths.defaultSessionsDir('gemini'); },
  describe: describe,
  probe: probe,
  collect: collect,
  doctor: doctor,
  capabilities: capabilities,
  getSessionsDir: getSessionsDir,
  _internal: { extractMessages: extractMessages, normalizeMessage: normalizeMessage, parseGeminiFile: parseGeminiFile }
};
