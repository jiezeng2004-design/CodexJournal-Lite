'use strict';

// src/sources/claude.js
//
// Claude Code (Anthropic) AI coding session adapter.
//
// Claude Code stores conversations in:
//   ~/.claude/projects/<project-hash>/<sessionId>.jsonl
//
// Each JSONL file contains one JSON object per line:
//   {"type":"user","message":{"role":"user","content":"..."},"cwd":"/path","sessionId":"...","timestamp":"..."}
//   {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."}],"model":"..."},"timestamp":"..."}
//   {"type":"ai-title","sessionId":"...","aiTitle":"..."}
//
// The adapter produces task records with the same 14-field schema as Codex.

const fs = require('fs');
const path = require('path');
const classifier = require('../classifier');
const utils = require('../utils');
const sanitize = require('../sanitize');
const paths = require('../paths');

function getSessionsDir(cfg) {
  if (cfg && cfg.sources) {
    for (const s of cfg.sources) {
      if (s && s.type === 'claude' && s.sessionsDir) return s.sessionsDir;
    }
  }
  return paths.defaultSessionsDir('claude');
}

function describe(cfg) {
  return {
    name: 'claude-code',
    type: 'claude',
    enabled: true,
    sessionsDir: getSessionsDir(cfg),
    notes: 'Claude Code session adapter. Parses JSONL files from ~/.claude/projects/.'
  };
}

function probe(cfg) {
  const dir = getSessionsDir(cfg);
  const result = {
    source: 'claude-code',
    scannedAt: new Date().toISOString(),
    sessionsDir: dir,
    exists: false,
    files: 0
  };
  try {
    if (fs.existsSync(dir)) {
      result.exists = true;
      // Count .jsonl files across all project subdirectories
      const projectDirs = fs.readdirSync(dir, { withFileTypes: true })
        .filter(function (e) { return e.isDirectory(); });
      for (const pd of projectDirs) {
        const sub = path.join(dir, pd.name);
        try {
          const files = fs.readdirSync(sub).filter(function (f) { return f.endsWith('.jsonl'); });
          result.files += files.length;
        } catch (_) {}
      }
    }
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

// Extract text content from Claude message.content (string or array)
function extractContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      if (item && item.type === 'text' && typeof item.text === 'string') {
        parts.push(item.text);
      } else if (item && item.type === 'tool_use') {
        parts.push('[tool_use: ' + (item.name || 'unknown') + ']');
      } else if (item && item.type === 'tool_result') {
        if (typeof item.content === 'string') parts.push(item.content);
      }
    }
    return parts.join('\n');
  }
  return '';
}

// Parse a timestamp from a Claude JSONL entry
function parseTimestamp(obj) {
  // Try explicit timestamp field
  const ts = obj.timestamp || obj.ts || (obj.message && obj.message.timestamp);
  if (ts) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  // Try createdAt
  const created = obj.createdAt || obj.created_at;
  if (created) {
    const d = new Date(created);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function parseClaudeFile(filePath, cfg) {
  const messages = [];
  let cwd = null;
  let sessionId = null;
  let aiTitle = null;
  const errors = [];

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { messages: [], cwd: null, sessionId: null, aiTitle: null, errors: [{ path: filePath, err: err.message }] };
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      errors.push({ path: filePath + ':' + (i + 1), err: 'JSON parse: ' + err.message });
      continue;
    }

    if (obj.type === 'user' && obj.message) {
      const text = extractContent(obj.message.content);
      if (text) {
        messages.push({
          kind: 'user',
          content: text,
          timestamp: parseTimestamp(obj),
          raw: obj
        });
      }
      if (obj.cwd) cwd = obj.cwd;
      if (obj.sessionId) sessionId = obj.sessionId;
    } else if (obj.type === 'assistant' && obj.message) {
      const text = extractContent(obj.message.content);
      if (text) {
        messages.push({
          kind: 'assistant',
          content: text,
          timestamp: parseTimestamp(obj),
          raw: obj
        });
      }
    } else if (obj.type === 'ai-title' && obj.aiTitle) {
      aiTitle = obj.aiTitle;
    }
  }

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

  return { messages: messages, cwd: cwd, sessionId: sessionId, aiTitle: aiTitle, errors: errors };
}

function buildTaskFromClaudeSession(filePath, parsed, cfg) {
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
  const taskType = derived.taskType;
  const keywords = derived.keywords;

  // Title: prefer aiTitle, fallback to first user message
  const title = parsed.aiTitle
    ? parsed.aiTitle
    : classifier.makeTitle(userMsgs[0] ? userMsgs[0].content : '(no user message)');

  const projectPath = parsed.cwd || classifier.detectProjectPath(userText + '\n' + assistantText) || null;

  if (tsList.length === 0) {
    return [{
      id: 'claude_u_' + utils.shortHash(filePath + '|' + messages.length),
      date: 'unknown',
      time: '??:??',
      source: 'claude-code',
      projectPath: projectPath,
      title: title,
      taskType: 'unknown',
      keywords: keywords,
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
  const date = utils.formatLocalDate(first);
  const time = utils.formatLocalTime(first);

  return [{
    id: 'claude_' + utils.shortHash(filePath + '|' + first.toISOString()),
    date: date,
    time: time,
    source: 'claude-code',
    projectPath: projectPath,
    title: title,
    taskType: taskType,
    keywords: keywords,
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
  let dirCount = 0;

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

  // Scan project subdirectories
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter(function (e) { return e.isDirectory(); });
  } catch (err) {
    return { tasks: [], errors: [{ path: sessionsDir, err: err.message }], fileCount: 0, dirCount: 0 };
  }

  for (const pd of projectDirs) {
    const projectDir = path.join(sessionsDir, pd.name);
    dirCount++;
    let files;
    try {
      files = fs.readdirSync(projectDir).filter(function (f) { return f.endsWith('.jsonl'); });
    } catch (_) { continue; }
    for (const fileName of files) {
      const filePath = path.join(projectDir, fileName);
      fileCount++;
      try {
        const parsed = parseClaudeFile(filePath, cfg);
        for (const e of parsed.errors) errors.push(e);
        const fileTasks = buildTaskFromClaudeSession(filePath, parsed, cfg);
        for (const t of fileTasks) tasks.push(t);
      } catch (err) {
        errors.push({ path: filePath, err: err.message || String(err) });
      }
    }
  }

  return { tasks: tasks, errors: errors, fileCount: fileCount, dirCount: dirCount };
}

// Health check for the Claude Code source adapter.
// Checks:
//   1. projects directory exists
//   2. projects directory is a directory
//   3. subdirectory structure (project sub-dirs with .jsonl files)
function doctor(cfg) {
  const checks = [];
  const warnings = [];
  const dir = getSessionsDir(cfg);

  // Check 1: projects directory existence
  let dirExists = false;
  try {
    dirExists = fs.existsSync(dir);
  } catch (err) {
    checks.push({ label: 'projects dir exists', pass: false, detail: sanitize.redactText(err.message) });
  }
  if (dirExists) {
    checks.push({ label: 'projects dir exists', pass: true, detail: sanitize.redactPath(dir) });
  } else {
    checks.push({ label: 'projects dir exists', pass: false, detail: sanitize.redactPath(dir) });
    warnings.push('Claude projects directory does not exist: ' + sanitize.redactPath(dir));
  }

  // Check 2: is it a directory?
  let isDir = false;
  if (dirExists) {
    try {
      const st = fs.statSync(dir);
      isDir = st.isDirectory();
      checks.push({ label: 'projects dir is directory', pass: isDir, detail: isDir ? 'directory' : 'not a directory' });
    } catch (err) {
      checks.push({ label: 'projects dir is directory', pass: false, detail: sanitize.redactText(err.message) });
      warnings.push('Cannot stat projects directory: ' + sanitize.redactText(err.message));
    }
  } else {
    checks.push({ label: 'projects dir is directory', pass: false, detail: 'directory does not exist' });
  }

  // Check 3: subdirectory structure
  let subDirCount = 0;
  let jsonlCount = 0;
  if (isDir) {
    try {
      const projectDirs = fs.readdirSync(dir, { withFileTypes: true })
        .filter(function (e) { return e.isDirectory(); });
      subDirCount = projectDirs.length;
      for (const pd of projectDirs) {
        const sub = path.join(dir, pd.name);
        try {
          const files = fs.readdirSync(sub).filter(function (f) { return f.endsWith('.jsonl'); });
          jsonlCount += files.length;
        } catch (_) {}
      }
      checks.push({ label: 'subdirectory structure', pass: true, detail: subDirCount + ' project dir(s), ' + jsonlCount + ' .jsonl file(s)' });
      if (subDirCount === 0) {
        warnings.push('No project subdirectories found in: ' + sanitize.redactPath(dir));
      }
      if (jsonlCount === 0) {
        warnings.push('No .jsonl session files found under: ' + sanitize.redactPath(dir));
      }
    } catch (err) {
      checks.push({ label: 'subdirectory structure', pass: false, detail: sanitize.redactText(err.message) });
      warnings.push('Failed to enumerate project subdirectories: ' + sanitize.redactText(err.message));
    }
  } else {
    checks.push({ label: 'subdirectory structure', pass: false, detail: 'projects dir not accessible' });
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
  name: 'claude-code',
  type: 'claude',
  getDefaultDir: function () { return paths.defaultSessionsDir('claude'); },
  describe: describe,
  probe: probe,
  collect: collect,
  doctor: doctor,
  capabilities: capabilities,
  getSessionsDir: getSessionsDir,
  _internal: { extractContent: extractContent, parseTimestamp: parseTimestamp, parseClaudeFile: parseClaudeFile }
};
