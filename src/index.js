#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const utils = require('./utils');
const cfgMod = require('./config');
const scanner = require('./scanner');
const parser = require('./parser');
const classifier = require('./classifier');
const writer = require('./writer');
const sanitize = require('./sanitize');
const sources = require('./sources');
const analysis = require('./analysis');
const ideaParser = require('./sources/idea-parser');
const roots = require('./roots');
const searchQuery = require('./searchQuery');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// APP_ROOT: source code and built-in assets directory (read-only).
const APP_ROOT = roots.APP_ROOT;
// WORKSPACE_ROOT: user data workspace (data/, journal/, reports/).
// Defaults to process.cwd() for npx/global; equals APP_ROOT in clone mode.
function resolveWorkspaceRoot(opts) {
  return roots.resolveWorkspaceRoot(opts);
}

const INDEX_FILE = 'index.json';
const TASKS_FILE = 'tasks.json';
const STATS_FILE = 'stats.json';
const SEARCH_FILE = 'search.md';
const DASHBOARD_FILE = 'dashboard.md';
const ERRORS_FILE = 'errors.log';

function logHeader(title) {
  process.stdout.write('\n=== ' + title + ' ===\n');
}

function loadIndex(cfg) {
  const file = path.join(cfg.dataDir, INDEX_FILE);
  return utils.readJsonSafe(file, { generatedAt: null, sessionsDir: null, files: {} });
}

function saveIndex(cfg, index) {
  const file = path.join(cfg.dataDir, INDEX_FILE);
  utils.writeJsonSafe(file, index);
}

function appendError(cfg, payload) {
  const file = path.join(cfg.reportsDir, ERRORS_FILE);
  utils.ensureDir(cfg.reportsDir);
  const ts = new Date().toISOString();
  const line = '[' + ts + '] ' + payload + '\n';
  try {
    utils.appendTextSafe(file, line);
  } catch (_) {
    // never let logging crash the run
  }
}

function buildTaskForFile(file, messages, cfg, sessionCwd) {
  const tsList = messages
    .map((m) => m.timestamp)
    .filter((d) => d && !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const userMsgs = messages.filter((m) => m.kind === 'user');
  const assistantMsgs = messages.filter((m) => m.kind === 'assistant');
  // mergeUserText / mergeAssistantText / deriveTaskTypeAndKeywords now strip
  // AGENTS.md / <INSTRUCTIONS> / <environment_context> / project-doc internally,
  // so the system preamble that Codex injects into the first user message no
  // longer dominates taskType, keywords, or the title.
  const userText = classifier.mergeUserText(userMsgs);
  const assistantText = classifier.mergeAssistantText(assistantMsgs);
  const { taskType, keywords } = classifier.deriveTaskTypeAndKeywords(userText, assistantText);
  // Find the first user message that still has real content after stripping
  // the AGENTS / INSTRUCTIONS / environment context preamble.
  const firstRealUser = userMsgs.find((m) => m.content && !classifier.isOnlyProjectContext(m.content));
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
      title,
      taskType: 'unknown',
      keywords,
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
    date,
    time,
    source: 'codex-sessions',
    projectPath: projectPath || null,
    title,
    taskType,
    keywords,
    userSummary: classifier.summarizeUser(userText, cfg.maxSummaryChars),
    assistantSummary: classifier.summarizeAssistant(assistantText, cfg.maxSummaryChars),
    rawFilePath: file.path,
    messageCount: messages.length,
    firstTimestamp: utils.safeIso(first),
    lastTimestamp: utils.safeIso(last)
  }];
}

function processFileRecord(file, cfg) {
  const { messages, errors } = parser.parseFile(file.path);
  for (const e of errors) {
    appendError(cfg, 'parse ' + file.path + ':' + e.lineNo + ' ' + e.err);
  }
  // Pull the project cwd from any session_meta line (Codex writes it on line 1).
  let sessionCwd = null;
  for (const m of messages) {
    if (m.raw && typeof m.raw === 'object' && m.raw.type === 'session_meta') {
      const cwd = parser.extractSessionMetaCwd(m.raw);
      if (cwd) { sessionCwd = cwd; break; }
    }
  }
  const tasks = buildTaskForFile(file, messages, cfg, sessionCwd);
  return { tasks, parseErrors: errors.length, messageCount: messages.length };
}

// -------- helpers for multi-source archive dispatch ---------------------

function getCodexSourceConfig(cfg) {
  if (!cfg || !cfg.sources) return null;
  for (const s of cfg.sources) {
    if (s && s.type === 'codex') return s;
  }
  return null;
}

function processAll(cfg, opts) {
  const force = !!(opts && opts.force);
  logHeader('archive');

  const allTasks = [];
  let processed = 0;
  let reused = 0;
  let codexScanned = 0;

  // ---- Step 1: Codex source (fingerprint-cached path) ----
  const codexSrc = getCodexSourceConfig(cfg);
  const codexArchiveEnabled = codexSrc ? sources.shouldArchiveSource(codexSrc) : false;

  if (codexArchiveEnabled) {
    const scan = scanner.scanSessionsDir(cfg.sessionsDir);
    if (scan.missing) {
      process.stdout.write('[warning] codex sessions dir missing: ' + sanitize.redactPath(cfg.sessionsDir) + ' — skipping codex, continuing with other sources\n');
    } else {
      if (scan.errors.length) {
        for (const e of scan.errors) appendError(cfg, 'scan ' + e.path + ' ' + e.err);
      }
      process.stdout.write('found ' + scan.files.length + ' codex session file(s)\n');
      codexScanned = scan.files.length;

      const index = loadIndex(cfg);
      const fileMap = index.files || (index.files = {});

      for (const file of scan.files) {
        const fp = utils.fileFingerprint(file.path, { size: file.size, mtimeMs: file.mtimeMs });
        const prev = fileMap[file.path];
        let tasks;
        if (!force && prev && prev.fingerprint === fp && Array.isArray(prev.tasks) && prev.tasks.length) {
          tasks = prev.tasks;
          reused += 1;
        } else {
          try {
            const r = processFileRecord(file, cfg);
            tasks = r.tasks;
            processed += 1;
          } catch (err) {
            appendError(cfg, 'process ' + file.path + ' ' + (err && err.message ? err.message : String(err)));
            tasks = [];
          }
        }
        for (const t of tasks) allTasks.push(t);
        fileMap[file.path] = {
          size: file.size,
          mtimeMs: file.mtimeMs,
          fingerprint: fp,
          lastProcessedAt: new Date().toISOString(),
          tasksHash: utils.shortHash(tasks.map((t) => t.id + ':' + (t.messageCount || 0)).join('|')),
          taskIds: tasks.map((t) => t.id),
          tasks: tasks
        };
      }
      index.generatedAt = new Date().toISOString();
      index.sessionsDir = cfg.sessionsDir;
      const onDisk = {
        generatedAt: index.generatedAt,
        sessionsDir: cfg.sessionsDir,
        files: {}
      };
      for (const k of Object.keys(index.files || {})) {
        const v = index.files[k];
        onDisk.files[k] = Object.assign({}, v, {
          tasks: Array.isArray(v.tasks) ? v.tasks.map(sanitizeTaskForExport) : v.tasks
        });
      }
      saveIndex(cfg, onDisk);
    }
  } else {
    process.stdout.write('[info] codex source not archive-enabled, skipping codex scan\n');
  }

  // ---- Step 2: Non-Codex archive-enabled sources ----
  const multiResult = sources.collectAll(cfg, { skipTypes: ['codex'], archiveOnly: true });
  for (const e of multiResult.errors) {
    appendError(cfg, (e.path || '') + ' ' + (e.err || ''));
  }
  for (const t of multiResult.tasks) {
    if (!allTasks.some(function (existing) { return existing.id === t.id; })) {
      allTasks.push(t);
    }
  }
  const sourceStats = multiResult.sourceStats || {};
  for (const srcName of Object.keys(sourceStats)) {
    const ss = sourceStats[srcName];
    if (ss.tasks > 0) {
      process.stdout.write(srcName + ': ' + ss.tasks + ' task(s) from ' + ss.files + ' file(s)');
      if (ss.errors > 0) process.stdout.write(' (' + ss.errors + ' error(s))');
      process.stdout.write('\n');
    } else if (ss.errors > 0) {
      process.stdout.write(srcName + ': 0 tasks, ' + ss.errors + ' error(s)\n');
    }
  }

  // ---- Step 3: Write outputs (always, even if empty) ----
  const stats = writer.buildStats(allTasks, cfg);
  const journalFiles = writer.buildJournal(allTasks, cfg);
  const search = writer.buildSearch(allTasks, cfg);
  utils.writeTextSafe(path.join(cfg.dataDir, SEARCH_FILE), search);
  utils.writeJsonSafe(path.join(cfg.dataDir, TASKS_FILE), {
    generatedAt: new Date().toISOString(),
    sessionsDir: sanitize.redactPath(cfg.sessionsDir),
    tasks: allTasks.map(sanitizeTaskForExport)
  });
  utils.writeJsonSafe(path.join(cfg.dataDir, STATS_FILE), stats);
  utils.writeTextSafe(path.join(cfg.reportsDir, DASHBOARD_FILE), writer.buildDashboard(allTasks, stats, cfg));

  process.stdout.write('processed: ' + processed + ', reused: ' + reused + '\n');
  process.stdout.write('tasks: ' + allTasks.length + ', journal files: ' + journalFiles.length + '\n');
  return { tasks: allTasks, stats, scanned: codexScanned, missing: false, processed, reused };
}


// -------- preview: show what would be archived without writing ---
function cmdPreview(cfg, opts) {
  logHeader('preview');
  const sourceFilter = opts && opts.source ? opts.source : null;

  // If --source is specified, only preview that source
  if (sourceFilter) {
    return cmdPreviewSource(cfg, sourceFilter);
  }

  // Multi-source preview: collect from all enabled + archive-enabled sources
  const allTasks = [];
  let anySourceAvailable = false;

  // Step 1: Codex (legacy scanner)
  const codexCfg = getCodexSourceConfig(cfg);
  const codexArchiveEnabled = codexCfg && sources.isSourceArchiveEnabled(codexCfg);
  if (codexArchiveEnabled) {
    const scan = scanner.scanSessionsDir(cfg.sessionsDir);
    if (scan.missing) {
      process.stdout.write('[codex] sessions dir missing: ' + sanitize.redactPath(cfg.sessionsDir) + '\n');
    } else {
      anySourceAvailable = true;
      const index = loadIndex(cfg);
      const fileMap = index.files || {};
      const newFiles = [];
      const changedFiles = [];
      let unchanged = 0;
      for (const file of scan.files) {
        const fp = utils.fileFingerprint(file.path, { size: file.size, mtimeMs: file.mtimeMs });
        const prev = fileMap[file.path];
        if (!prev) { newFiles.push(file); }
        else if (prev.fingerprint !== fp) { changedFiles.push(file); }
        else { unchanged++; }
      }
      process.stdout.write('sessions: ' + scan.files.length + ' total, ' + newFiles.length + ' new, ' + changedFiles.length + ' changed, ' + unchanged + ' unchanged\n');
      if (newFiles.length > 0 || changedFiles.length > 0) {
        var previewCount = Math.min(10, newFiles.length + changedFiles.length);
        var previewFiles = newFiles.slice(0, 5).concat(changedFiles.slice(0, 5)).slice(0, previewCount);
        for (var pi = 0; pi < previewFiles.length; pi++) {
          var file = previewFiles[pi];
          var label = newFiles.indexOf(file) >= 0 ? 'NEW' : 'CHANGED';
          try {
            var r = processFileRecord(file, cfg);
            for (var ti = 0; ti < r.tasks.length; ti++) {
              var t = r.tasks[ti];
              var diffResult = sanitize.sanitizeTaskWithDiff(t);
              var redacted = diffResult.task;
              process.stdout.write('  [' + label + '] ' + sanitize.redactPath(file.path) + '\n');
              process.stdout.write('    title: ' + redacted.title + '\n');
              process.stdout.write('    type:  ' + redacted.taskType + '\n');
              process.stdout.write('    msgs:  ' + t.messageCount + '\n');
              if (diffResult.redactionCount > 0) {
                process.stdout.write('    redactions: ' + diffResult.redactionCount + ' (' + diffResult.patternNames.join(', ') + ')\n');
              }
            }
          } catch (err) {
            process.stdout.write('  [' + label + '] ' + sanitize.redactPath(file.path) + ' (parse error: ' + (err.message || err) + ')\n');
          }
        }
        var remaining = (newFiles.length + changedFiles.length) - previewCount;
        if (remaining > 0) { process.stdout.write('  ... and ' + remaining + ' more session(s)\n'); }
      }
    }
  }

  // Step 2: Non-Codex archive-enabled sources
  const adapters = sources.loadAdapters();
  for (const srcCfg of (cfg.sources || [])) {
    if (!srcCfg || srcCfg.type === 'codex') continue;
    if (!sources.isSourceArchiveEnabled(srcCfg)) continue;
    const adapter = adapters[srcCfg.type];
    if (!adapter) continue;
    try {
      const probeResult = adapter.probe(cfg);
      if (!probeResult.exists) {
        process.stdout.write('[' + srcCfg.name + '] source not found\n');
        continue;
      }
      anySourceAvailable = true;
      process.stdout.write('[' + srcCfg.name + '] ' + probeResult.files + ' file(s)\n');
      const collectResult = adapter.collect(cfg);
      const previewTasks = collectResult.tasks.slice(0, 5);
      for (const t of previewTasks) {
        const diffResult = sanitize.sanitizeTaskWithDiff(t);
        const redacted = diffResult.task;
        process.stdout.write('  [task] ' + redacted.title + '\n');
        process.stdout.write('    type: ' + redacted.taskType + ', date: ' + t.date + ', msgs: ' + t.messageCount + '\n');
        if (diffResult.redactionCount > 0) {
          process.stdout.write('    redactions: ' + diffResult.redactionCount + ' (' + diffResult.patternNames.join(', ') + ')\n');
        }
      }
      if (collectResult.tasks.length > 5) {
        process.stdout.write('  ... and ' + (collectResult.tasks.length - 5) + ' more task(s)\n');
      }
    } catch (err) {
      process.stdout.write('[' + srcCfg.name + '] error: ' + (err.message || err) + '\n');
    }
  }

  if (!anySourceAvailable) {
    process.stdout.write('No enabled sources found.\n');
    return 0;
  }

  process.stdout.write('\nRun `npm run archive` to archive.\n');
  return 0;
}

// -------- preview specific source (multi-source) -------------------------
function cmdPreviewSource(cfg, sourceName) {
  const adapters = sources.loadAdapters();
  const srcCfg = sources.getSourceByName(cfg, sourceName);
  if (!srcCfg) {
    process.stdout.write('Source not found: ' + sourceName + '\n');
    process.stdout.write('Available sources: ' + (cfg.sources || []).map(function (s) { return s.name; }).join(', ') + '\n');
    return 1;
  }
  const adapter = adapters[srcCfg.type];
  if (!adapter) {
    process.stdout.write('No adapter for source type: ' + srcCfg.type + '\n');
    return 1;
  }
  process.stdout.write('Previewing source: ' + sourceName + ' (type: ' + srcCfg.type + ')\n');
  try {
    const probeResult = adapter.probe(cfg);
    process.stdout.write('  exists: ' + (probeResult.exists ? 'yes' : 'no') + '\n');
    process.stdout.write('  files:  ' + (probeResult.files || 0) + '\n');
    if (probeResult.sessionsDir) process.stdout.write('  dir:    ' + sanitize.redactPath(probeResult.sessionsDir) + '\n');
    if (probeResult.error) process.stdout.write('  error:  ' + probeResult.error + '\n');
  } catch (err) {
    process.stdout.write('  probe error: ' + (err.message || err) + '\n');
  }
  process.stdout.write('\n');
  try {
    const result = adapter.collect(cfg);
    process.stdout.write('  tasks:  ' + result.tasks.length + '\n');
    process.stdout.write('  files:  ' + (result.fileCount || 0) + '\n');
    process.stdout.write('  errors: ' + (result.errors || []).length + '\n');
    if (result.errors && result.errors.length > 0) {
      for (const e of result.errors.slice(0, 5)) {
        process.stdout.write('    [error] ' + (e.path || '') + ' ' + (e.err || '') + '\n');
      }
    }
    // Show first 5 tasks as preview
    const previewTasks = result.tasks.slice(0, 5);
    for (const t of previewTasks) {
      const diffResult = sanitize.sanitizeTaskWithDiff(t);
      const redacted = diffResult.task;
      process.stdout.write('  [task] ' + redacted.title + '\n');
      process.stdout.write('    type: ' + redacted.taskType + ', date: ' + t.date + ', msgs: ' + t.messageCount + '\n');
      if (diffResult.redactionCount > 0) {
        process.stdout.write('    redactions: ' + diffResult.redactionCount + ' (' + diffResult.patternNames.join(', ') + ')\n');
      }
    }
    if (result.tasks.length > 5) {
      process.stdout.write('  ... and ' + (result.tasks.length - 5) + ' more task(s)\n');
    }
  } catch (err) {
    process.stdout.write('  collect error: ' + (err.message || err) + '\n');
  }
  return 0;
}

// -------- changelog: compare fingerprint cache with current sessions ---
function cmdChangelog(cfg) {
  logHeader("changelog");
  var scan = scanner.scanSessionsDir(cfg.sessionsDir);
  if (scan.missing) { process.stdout.write("sessions dir missing: " + cfg.sessionsDir + "\n"); return 0; }
  var index = loadIndex(cfg);
  var fileMap = index.files || {};
  var newFiles = [], changedFiles = [], unchanged = 0;
  for (var fi = 0; fi < scan.files.length; fi++) {
    var file = scan.files[fi];
    var fp = utils.fileFingerprint(file.path, { size: file.size, mtimeMs: file.mtimeMs });
    var prev = fileMap[file.path];
    if (!prev) { newFiles.push(file); }
    else if (prev.fingerprint !== fp) { changedFiles.push(file); }
    else { unchanged++; }
  }
  var lines = [];
  lines.push("# Changelog");
  lines.push("");
  lines.push("- generated: " + new Date().toISOString());
  lines.push("- total sessions: " + scan.files.length);
  lines.push("- unchanged: " + unchanged);
  lines.push("- new: " + newFiles.length);
  lines.push("- changed: " + changedFiles.length);
  lines.push("");
  if (newFiles.length === 0 && changedFiles.length === 0) {
    lines.push("_No changes since last archive._");
  } else {
    function displayTask(file, label) {
      try {
        var r = processFileRecord(file, cfg);
        for (var ti = 0; ti < r.tasks.length; ti++) {
          var red = sanitizeTaskForExport(r.tasks[ti]);
          lines.push("- **[" + label + "] " + red.title + "** (" + red.taskType + ", " + r.tasks[ti].messageCount + " msgs)");
          lines.push("  - file: " + sanitize.redactPath(file.path));
        }
      } catch(err) {
        lines.push("- _[" + label + "] parse error: " + (err.message || err) + "_");
      }
    }
    lines.push("## New sessions");
    lines.push("");
    if (newFiles.length === 0) { lines.push("_(none)_"); }
    else {
      for (var ni = 0; ni < Math.min(newFiles.length, 10); ni++) { displayTask(newFiles[ni], "NEW"); }
      if (newFiles.length > 10) { lines.push("- _... and " + (newFiles.length - 10) + " more_"); }
    }
    lines.push("");
    lines.push("## Changed sessions");
    lines.push("");
    if (changedFiles.length === 0) { lines.push("_(none)_"); }
    else {
      for (var ci = 0; ci < Math.min(changedFiles.length, 5); ci++) { displayTask(changedFiles[ci], "CHANGED"); }
      if (changedFiles.length > 5) { lines.push("- _... and " + (changedFiles.length - 5) + " more_"); }
    }
  }
  lines.push("");
  var md = lines.join("\n");
  utils.writeTextSafe(path.join(cfg.reportsDir, "fingerprint-changes.md"), md);
  process.stdout.write("wrote: reports/fingerprint-changes.md\n");
  process.stdout.write("new=" + newFiles.length + " changed=" + changedFiles.length + " unchanged=" + unchanged + "\n");
  return 0;
}
function sanitizeTaskForExport(t) {
  // Replace local Windows usernames in any path-like field, but keep
  // the original id, counts, timestamps, and metadata untouched.
  return Object.assign({}, t, {
    rawFilePath: sanitize.redactPath(t.rawFilePath),
    projectPath: t.projectPath ? sanitize.redactPath(t.projectPath) : null,
    userSummary: sanitize.redactText(t.userSummary || ''),
    assistantSummary: sanitize.redactText(t.assistantSummary || ''),
    title: sanitize.redactText(t.title || ''),
    keywords: sanitize.redactKeywords(t.keywords)
  });
}

function writeEmptyOutputs(cfg) {
  const stats = writer.buildStats([], cfg);
  utils.writeJsonSafe(path.join(cfg.dataDir, TASKS_FILE), {
    generatedAt: new Date().toISOString(),
    sessionsDir: sanitize.redactPath(cfg.sessionsDir),
    tasks: []
  });
  utils.writeJsonSafe(path.join(cfg.dataDir, STATS_FILE), stats);
  utils.writeTextSafe(path.join(cfg.dataDir, SEARCH_FILE),
    '# CodexJournal-Lite Search Index\n\n> No sessions found at ' + sanitize.redactPath(cfg.sessionsDir) + '\n');
  utils.writeTextSafe(path.join(cfg.reportsDir, DASHBOARD_FILE), writer.buildDashboard([], stats, cfg));
  saveIndex(cfg, { generatedAt: new Date().toISOString(), sessionsDir: sanitize.redactPath(cfg.sessionsDir), files: {} });
}

function cmdCheck(cfg) {
  logHeader('check');
  const results = [];
  const warnings = [];
  const nodeVer = process.versions.node;
  const major = parseInt(nodeVer.split('.')[0], 10);
  results.push({ name: 'node-version', ok: major >= 18, detail: nodeVer });
  const exists = utils.exists(cfg.sessionsDir);
  if (!exists) {
    warnings.push({ name: 'sessions-dir', detail: cfg.sessionsDir });
  }
  for (const d of [cfg.journalDir, cfg.dataDir, cfg.reportsDir]) {
    let writable = false;
    let detail = d;
    try {
      utils.ensureDir(d);
      const probe = path.join(d, '.write-probe-' + Date.now());
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      writable = true;
    } catch (err) {
      detail = d + ' (' + err.message + ')';
    }
    results.push({ name: 'writable:' + path.basename(d), ok: writable, detail });
  }
  if (exists) {
    results.push({ name: 'sessions-dir', ok: true, detail: cfg.sessionsDir });
  }
  let allOk = true;
  let hasWarn = false;
  for (const r of results) {
    const tag = r.ok ? 'OK ' : 'FAIL';
    process.stdout.write('[' + tag + '] ' + r.name + ' :: ' + r.detail + '\n');
    if (!r.ok) allOk = false;
  }
  for (const w of warnings) {
    hasWarn = true;
    process.stdout.write('[WARN] ' + w.name + ' :: ' + w.detail + '\n');
  }
  if (!exists) {
    process.stdout.write('\nNOTE: sessions dir does not exist. archive will produce empty outputs.\n');
  }
  process.stdout.write('\ncheck ' + (allOk ? 'passed' : 'failed') + '\n');
  return allOk ? 0 : 1;
}

function cmdStats(cfg) {
  logHeader('stats');
  const tasksFile = path.join(cfg.dataDir, TASKS_FILE);
  if (!utils.exists(tasksFile)) {
    process.stdout.write('No tasks.json found. Run `npm run archive` first.\n');
    return 1;
  }
  const data = utils.readJsonSafe(tasksFile, { tasks: [] });
  const stats = writer.buildStats(data.tasks || [], cfg);
  utils.writeJsonSafe(path.join(cfg.dataDir, STATS_FILE), stats);
  process.stdout.write('tasks: ' + stats.totals.tasks + ', days: ' + stats.totals.days + '\n');
  return 0;
}

function cmdBuildIndex(cfg) {
  logHeader('build-index');
  const scan = scanner.scanSessionsDir(cfg.sessionsDir);
  const index = {
    generatedAt: new Date().toISOString(),
    sessionsDir: cfg.sessionsDir,
    files: {}
  };
  if (scan.missing) {
    utils.writeJsonSafe(path.join(cfg.dataDir, INDEX_FILE), index);
    process.stdout.write('sessions dir missing; wrote empty index.\n');
    return 0;
  }
  const prev = loadIndex(cfg);
  const prevFiles = (prev && prev.files) || {};
  for (const f of scan.files) {
    const fp = utils.fileFingerprint(f.path, { size: f.size, mtimeMs: f.mtimeMs });
    const p = prevFiles[f.path] || {};
    index.files[f.path] = {
      size: f.size,
      mtimeMs: f.mtimeMs,
      fingerprint: fp,
      lastProcessedAt: p.lastProcessedAt || null,
      tasksHash: p.tasksHash || null,
      taskIds: p.taskIds || []
    };
  }
  utils.writeJsonSafe(path.join(cfg.dataDir, INDEX_FILE), index);
  process.stdout.write('indexed ' + scan.files.length + ' file(s)\n');
  return 0;
}

function cmdScanSources(cfg) {
  // Read-only probe of every "non-parsing" source registered in
  // config.json -> sources[]. currently only implements the IDEA / JetBrains
  // probe; the Codex source still goes through the legacy archive path.
  // This command MUST NOT touch journal/, data/tasks.json, data/stats.json,
  // data/search.md, reports/dashboard.md, or data/index.json. also writes
  // reports/source-scan-summary.json (machine-readable summary).
  logHeader('scan-sources');

  const target = sources.isSourceEnabled(cfg, 'idea-ai') ? 'idea-ai' : null;
  if (!target) {
    process.stdout.write('No idea-ai source enabled in config.json -> sources[]. Nothing to do.\n');
    return 0;
  }

  process.stdout.write('Probing IDEA / JetBrains directories (read-only)...\n');
  let result;
  try {
    result = sources.idea.scan(cfg);
  } catch (err) {
    process.stderr.write('FATAL in sources.idea.scan: ' + (err && err.stack ? err.stack : String(err)) + '\n');
    return 1;
  }

  utils.ensureDir(cfg.reportsDir);
  const mdOutFile = path.join(cfg.reportsDir, 'idea-log-inventory.md');
  const jsonOutFile = path.join(cfg.reportsDir, 'source-scan-summary.json');
  const md = sources.idea.renderMarkdown(result);
  const jsonSummary = sources.idea.renderSummaryJson(result);
  utils.writeTextSafe(mdOutFile, md);
  utils.writeJsonSafe(jsonOutFile, jsonSummary);

  process.stdout.write('summary: roots=' + result.summary.rootsExisting
    + ' logDirs=' + result.summary.logDirsDiscovered
    + ' files=' + result.summary.filesScanned
    + ' likelyAi=' + result.summary.filesLikelyAi
    + ' skippedLarge=' + result.summary.filesSkippedLarge + '\n');
  process.stdout.write('wrote: ' + mdOutFile + '\n');
  process.stdout.write('wrote: ' + jsonOutFile + '\n');

  return 0;
}

function cmdSummarize(cfg) {
  // Rule-based monthly/yearly summaries and work-pattern analysis.
  // Reads data/tasks.json; writes data/patterns.json, reports/work-patterns.md,
  // reports/monthly/*.md, reports/yearly/*.md.
  // Does NOT modify data/tasks.json, data/stats.json, data/search.md,
  // data/index.json, journal/*.md, reports/dashboard.md, or any reports/*.md from
  // scan-sources.
  logHeader('summarize');

  const tasksFile = path.join(cfg.dataDir, TASKS_FILE);
  if (!utils.exists(tasksFile)) {
    process.stderr.write('ERROR: data/tasks.json not found. Run `npm run archive` first.\n');
    return 1;
  }
  const data = utils.readJsonSafe(tasksFile, { tasks: [] });
  const tasks = data.tasks || [];
  if (tasks.length === 0) {
    process.stdout.write('No tasks found in data/tasks.json. Nothing to summarize.\n');
    return 0;
  }

  // Build patterns once.
  const patterns = analysis.buildPatterns(tasks);

  // data/patterns.json
  utils.writeJsonSafe(path.join(cfg.dataDir, 'patterns.json'), patterns);

  // reports/work-patterns.md
  utils.writeTextSafe(path.join(cfg.reportsDir, 'work-patterns.md'),
    analysis.renderWorkPatternsReport(patterns, cfg));

  // Monthly reports
  const months = analysis.groupByMonth(tasks);
  const monthlyDir = path.join(cfg.reportsDir, 'monthly');
  utils.ensureDir(monthlyDir);
  for (const group of months) {
    utils.writeTextSafe(path.join(monthlyDir, group.month + '.md'),
      analysis.renderMonthlyReport(group.month, group.tasks, patterns));
  }

  // Yearly reports
  const years = analysis.groupByYear(tasks);
  const yearlyDir = path.join(cfg.reportsDir, 'yearly');
  utils.ensureDir(yearlyDir);
  for (const group of years) {
    utils.writeTextSafe(path.join(yearlyDir, group.year + '.md'),
      analysis.renderYearlyReport(group.year, group.tasks, patterns));
  }

  process.stdout.write('tasks=' + tasks.length
    + ' months=' + months.length
    + ' years=' + years.length + '\n');
  process.stdout.write('wrote: data/patterns.json\n');
  process.stdout.write('wrote: reports/work-patterns.md\n');
  process.stdout.write('wrote monthly: ' + months.length + '\n');
  process.stdout.write('wrote yearly: ' + years.length + '\n');
  return 0;
}

function cmdDoctor(cfg, opts) {
  // Environment and output completeness check.
  // Writes reports/doctor.md. Does NOT modify any other file.
  // In default mode, user-data checks (sessionsDir, tasks.json, patterns.json,
  // generated reports) are WARN instead of FAIL. Use --strict for full release check.
  const strict = !!(opts && opts.strict);
  logHeader('doctor');
  const lines = [];
  const ok = [];
  const fail = [];
  const warn = [];
  function check(label, predicate, detail) {
    if (predicate) { ok.push(label); } else { fail.push(label + (detail ? ': ' + detail : '')); }
  }
  function checkOptional(label, predicate, detail) {
    if (strict) {
      check(label, predicate, detail);
    } else {
      if (predicate) { ok.push(label); } else { warn.push(label + (detail ? ': ' + detail : '')); }
    }
  }
  const pr = cfg && cfg.projectRoot ? cfg.projectRoot : path.resolve(__dirname, '..');
  const ar = cfg && cfg.appRoot ? cfg.appRoot : path.resolve(__dirname, '..');
  const isWorkspaceMode = pr !== ar;

  // ---- REQUIRED checks (always FAIL if missing) ----
  check('Node version >= 18', parseInt(process.versions.node, 10) >= 18, process.versions.node);
  check('Workspace root exists', fs.existsSync(pr));
  check('config.json exists', fs.existsSync(path.join(pr, 'config.json')));
  try { JSON.parse(fs.readFileSync(path.join(pr, 'config.json'), 'utf8')); check('config.json is JSON', true); } catch (_) { check('config.json is JSON', false); }
  // Source code dirs checked against APP_ROOT
  for (const d of ['scripts', 'src', 'docs']) check('dir: ' + d + ' exists (appRoot)', fs.existsSync(path.join(ar, d)));
  // package.json from APP_ROOT
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(ar, 'package.json'), 'utf8')); check('package.json readable (appRoot)', true); } catch (_) { check('package.json readable (appRoot)', false); }
  if (pkg) {
    for (const s of ['archive', 'check', 'verify', 'scan:sources', 'test:sources', 'summarize', 'doctor', 'index:outputs', 'package:local']) {
      check('script: ' + s, !!(pkg.scripts && pkg.scripts[s]));
    }
  }
  check('scripts/install-task.ps1 exists (appRoot)', fs.existsSync(path.join(ar, 'scripts', 'install-task.ps1')));
  check('scripts/git-commit.ps1 exists (appRoot)', fs.existsSync(path.join(ar, 'scripts', 'git-commit.ps1')));
  // Output dirs must be writable
  for (const d of ['journal', 'data', 'reports']) check('dir: ' + d + ' exists', fs.existsSync(path.join(pr, d)));

  // ---- OPTIONAL checks (WARN in default mode, FAIL in --strict) ----
  // These depend on user having run archive / generated outputs
  checkOptional('sessionsDir exists', fs.existsSync(cfg.sessionsDir), cfg.sessionsDir);
  checkOptional('data/tasks.json exists', fs.existsSync(path.join(cfg.dataDir, TASKS_FILE)));
  checkOptional('data/patterns.json exists', fs.existsSync(path.join(cfg.dataDir, 'patterns.json')));
  checkOptional('reports/dashboard.md exists', fs.existsSync(path.join(cfg.reportsDir, DASHBOARD_FILE)));
  checkOptional('reports/work-patterns.md exists', fs.existsSync(path.join(cfg.reportsDir, 'work-patterns.md')));
  checkOptional('reports/idea-log-inventory.md exists', fs.existsSync(path.join(cfg.reportsDir, 'idea-log-inventory.md')));
  checkOptional('reports/source-scan-summary.json exists', fs.existsSync(path.join(cfg.reportsDir, 'source-scan-summary.json')));

  lines.push('# Doctor Report');
  lines.push('');
  lines.push('- generatedAt: ' + new Date().toISOString());
  lines.push('- workspaceRoot: ' + pr);
  lines.push('- appRoot: ' + ar);
  lines.push('- mode: ' + (isWorkspaceMode ? 'workspace' : 'clone'));
  lines.push('- strict: ' + strict);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| result | count |');
  lines.push('| --- | --- |');
  lines.push('| pass | ' + ok.length + ' |');
  lines.push('| fail | ' + fail.length + ' |');
  if (warn.length > 0) {
    lines.push('| warn | ' + warn.length + ' |');
  }
  lines.push('');
  if (fail.length) {
    lines.push('## Failures (required)');
    lines.push('');
    for (const f of fail) lines.push('- [FAIL] ' + f);
    lines.push('');
  }
  if (warn.length) {
    lines.push('## Warnings (optional — run with --strict to treat as failures)');
    lines.push('');
    for (const w of warn) lines.push('- [WARN] ' + w);
    lines.push('');
  }
  lines.push('## Details');
  lines.push('');
  for (const p of ok) lines.push('- [OK] ' + p);
  for (const f of fail) lines.push('- [FAIL] ' + f);
  for (const w of warn) lines.push('- [WARN] ' + w);
  lines.push('');

  const mdPath = path.join(cfg.reportsDir, 'doctor.md');
  utils.writeTextSafe(mdPath, lines.join('\n'));
  process.stdout.write('pass=' + ok.length + ' fail=' + fail.length + (warn.length ? ' warn=' + warn.length : '') + '\n');
  process.stdout.write('wrote: ' + mdPath + '\n');
  return fail.length > 0 ? 1 : 0;
}

function gatherIndexFiles(cfg) {
  const pr = cfg && cfg.projectRoot ? cfg.projectRoot : path.resolve(__dirname, '..');
  const files = [];

  function add(relPath, type, desc, gen) {
    const abs = path.resolve(pr, relPath);
    let st;
    try { st = fs.statSync(abs); } catch (_) { return; }
    files.push({
      path: sanitize.redactPath(abs),
      relativePath: relPath.replace(/\\/g, '/'),
      type: type || 'unknown',
      size: st.size,
      mtime: st.mtime.toISOString(),
      description: desc || '',
      generatedBy: gen || ''
    });
  }

  add('README.md', 'md', 'Project overview and documentation', 'manual');
  add('CHANGELOG.md', 'md', 'Per-version change log', 'manual');
  add('config.json', 'json', 'Project configuration', 'manual');

  // docs/*.md
  const docsDir = path.join(pr, 'docs');
  if (fs.existsSync(docsDir)) {
    for (const e of fs.readdirSync(docsDir)) {
      if (e.endsWith('.md')) add('docs/' + e, 'md', 'Documentation', 'manual');
    }
  }

  // journal/*.md
  const jDir = path.join(pr, 'journal');
  if (fs.existsSync(jDir)) {
    for (const e of fs.readdirSync(jDir).sort()) {
      if (e.endsWith('.md')) add('journal/' + e, 'md', 'Daily journal', 'npm run archive');
    }
  }

  // data/ files
  add('data/tasks.json', 'json', 'Task records (14 fields per task)', 'npm run archive');
  add('data/stats.json', 'json', 'Aggregate statistics', 'npm run archive');
  add('data/search.md', 'md', 'Full-text search index', 'npm run archive');
  add('data/patterns.json', 'json', 'Work pattern analysis', 'npm run summarize');

  // reports/
  add('reports/dashboard.md', 'md', 'Local archive dashboard', 'npm run archive');
  add('reports/work-patterns.md', 'md', 'Work pattern analysis report', 'npm run summarize');
  add('reports/idea-log-inventory.md', 'md', 'IDEA / JetBrains log inventory', 'npm run scan:sources');
  add('reports/source-scan-summary.json', 'json', 'IDEA log scan summary', 'npm run scan:sources');
  add('reports/doctor.md', 'md', 'Environment/doctor check', 'npm run doctor');
  add('reports/output-index.md', 'md', 'Output file index', 'npm run index:outputs');
  add('reports/output-index.json', 'json', 'Output file index (machine-readable)', 'npm run index:outputs');

  // monthly/yearly reports
  const monthlyDir = path.join(pr, 'reports', 'monthly');
  if (fs.existsSync(monthlyDir)) {
    for (const e of fs.readdirSync(monthlyDir).sort()) {
      if (e.endsWith('.md')) add('reports/monthly/' + e, 'md', 'Monthly summary', 'npm run summarize');
    }
  }
  const yearlyDir = path.join(pr, 'reports', 'yearly');
  if (fs.existsSync(yearlyDir)) {
    for (const e of fs.readdirSync(yearlyDir).sort()) {
      if (e.endsWith('.md')) add('reports/yearly/' + e, 'md', 'Yearly summary', 'npm run summarize');
    }
  }

  return files;
}

function cmdIndexOutputs(cfg) {
  logHeader('index-outputs');
  const files = gatherIndexFiles(cfg);
  const outMd = path.join(cfg.reportsDir, 'output-index.md');
  const outJson = path.join(cfg.reportsDir, 'output-index.json');

  const jsonPayload = { generatedAt: new Date().toISOString(), files };
  utils.writeJsonSafe(outJson, jsonPayload);

  const lines = [];
  lines.push('# Output Index');
  lines.push('');
  lines.push('- generatedAt: ' + jsonPayload.generatedAt);
  lines.push('- total files: ' + files.length);
  lines.push('');
  lines.push('| path | type | size | generated by |');
  lines.push('| --- | --- | --- | --- |');
  for (const f of files) {
    lines.push('| ' + f.relativePath + ' | ' + f.type + ' | ' + f.size + ' | ' + f.generatedBy + ' |');
  }
  lines.push('');
  utils.writeTextSafe(outMd, lines.join('\n'));

  process.stdout.write('files=' + files.length + '\n');
  process.stdout.write('wrote: ' + outMd + '\n');
  process.stdout.write('wrote: ' + outJson + '\n');
  return 0;
}

// -------- source-doctor: health check for all source adapters -----------
function cmdSourceDoctor(cfg, opts) {
  const sourceFilter = opts && opts.source ? opts.source : null;
  const jsonOutput = !!(opts && opts.json);

  if (!jsonOutput) {
    logHeader('source-doctor');
  }

  // Run doctorAll and optionally filter by source name
  let results = sources.doctorAll(cfg);
  if (sourceFilter) {
    results = results.filter(function (r) {
      return r.name === sourceFilter || r.type === sourceFilter;
    });
    if (results.length === 0) {
      const msg = 'No enabled source matched: ' + sourceFilter + '\n';
      if (jsonOutput) {
        process.stdout.write(JSON.stringify({ error: sanitize.redactText(msg.trim()), results: [] }, null, 2) + '\n');
      } else {
        process.stdout.write(msg);
      }
      return 1;
    }
  }

  // Build the report payload with sanitized details
  const payload = {
    generatedAt: new Date().toISOString(),
    sources: results.map(function (r) {
      var doc = r.doctor || { healthy: false, checks: [], warnings: [] };
      return {
        id: r.name,
        type: r.type,
        enabled: r.enabled,
        archive: r.archive,
        capabilities: r.capabilities,
        healthy: doc.healthy,
        checks: (doc.checks || []).map(function (c) {
          return {
            label: sanitize.redactText(c.label || ''),
            pass: !!c.pass,
            detail: c.detail ? sanitize.redactText(String(c.detail)) : undefined
          };
        }),
        warnings: (doc.warnings || []).map(function (w) { return sanitize.redactText(String(w)); }),
        // Derived fields for the report
        detected: (doc.checks || []).some(function (c) { return c.pass; }),
        cliStatus: r.capabilities && r.capabilities.cliRequired
          ? ((doc.checks || []).find(function (c) { return /CLI/i.test(c.label); }) || {}).pass ? 'available' : 'not found'
          : 'not required',
        configuredPath: (function () {
          var srcCfg = sources.getSourceByType(cfg, r.type) || {};
          if (srcCfg.sessionsDir) return sanitize.redactPath(srcCfg.sessionsDir);
          if (Array.isArray(srcCfg.logDirs) && srcCfg.logDirs.length) return sanitize.redactPath(srcCfg.logDirs[0]);
          return '(default)';
        })(),
        sampleFiles: (function () {
          var check = (doc.checks || []).find(function (c) { return /file/i.test(c.label); });
          return check && check.detail ? sanitize.redactText(check.detail) : '0';
        })(),
        recommendedFix: (function () {
          if (doc.healthy) return 'none';
          var warns = doc.warnings || [];
          if (warns.length > 0) return sanitize.redactText(warns[0]);
          var failed = (doc.checks || []).find(function (c) { return !c.pass; });
          return failed ? sanitize.redactText(failed.label + ': ' + (failed.detail || 'failed')) : 'investigate';
        })()
      };
    })
  };

  // JSON output
  if (jsonOutput) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    // Human-readable output
    for (const s of payload.sources) {
      process.stdout.write('\n[' + (s.healthy ? 'OK' : 'FAIL') + '] ' + s.id + ' (type: ' + s.type + ')\n');
      process.stdout.write('  enabled:        ' + s.enabled + '\n');
      process.stdout.write('  archive:        ' + s.archive + '\n');
      process.stdout.write('  detected:       ' + s.detected + '\n');
      process.stdout.write('  cli status:     ' + s.cliStatus + '\n');
      process.stdout.write('  configured path: ' + s.configuredPath + '\n');
      process.stdout.write('  sample files:   ' + s.sampleFiles + '\n');
      process.stdout.write('  capabilities:   ' + JSON.stringify(s.capabilities) + '\n');
      if (s.checks.length > 0) {
        process.stdout.write('  checks:\n');
        for (const c of s.checks) {
          process.stdout.write('    [' + (c.pass ? 'PASS' : 'FAIL') + '] ' + c.label + (c.detail ? ' :: ' + c.detail : '') + '\n');
        }
      }
      if (s.warnings.length > 0) {
        process.stdout.write('  warnings:\n');
        for (const w of s.warnings) {
          process.stdout.write('    [WARN] ' + w + '\n');
        }
      }
      process.stdout.write('  recommended fix: ' + s.recommendedFix + '\n');
    }
  }

  // Write reports/source-doctor.md
  utils.ensureDir(cfg.reportsDir);
  const mdPath = path.join(cfg.reportsDir, 'source-doctor.md');
  const lines = [];
  lines.push('# Source Doctor Report');
  lines.push('');
  lines.push('- generatedAt: ' + payload.generatedAt);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| source | type | enabled | archive | healthy | cli | detected |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const s of payload.sources) {
    lines.push('| ' + s.id + ' | ' + s.type + ' | ' + s.enabled + ' | ' + s.archive + ' | ' + s.healthy + ' | ' + s.cliStatus + ' | ' + s.detected + ' |');
  }
  lines.push('');

  for (const s of payload.sources) {
    lines.push('## ' + s.id);
    lines.push('');
    lines.push('- type: ' + s.type);
    lines.push('- enabled: ' + s.enabled);
    lines.push('- archive: ' + s.archive);
    lines.push('- healthy: ' + s.healthy);
    lines.push('- detected: ' + s.detected);
    lines.push('- cli status: ' + s.cliStatus);
    lines.push('- configured path: ' + s.configuredPath);
    lines.push('- sample files: ' + s.sampleFiles);
    lines.push('- capabilities: ' + JSON.stringify(s.capabilities));
    lines.push('- recommended fix: ' + s.recommendedFix);
    lines.push('');
    if (s.checks.length > 0) {
      lines.push('### Checks');
      lines.push('');
      lines.push('| check | pass | detail |');
      lines.push('| --- | --- | --- |');
      for (const c of s.checks) {
        lines.push('| ' + c.label + ' | ' + (c.pass ? 'PASS' : 'FAIL') + ' | ' + (c.detail || '') + ' |');
      }
      lines.push('');
    }
    if (s.warnings.length > 0) {
      lines.push('### Warnings');
      lines.push('');
      for (const w of s.warnings) {
        lines.push('- ' + w);
      }
      lines.push('');
    }
  }

  utils.writeTextSafe(mdPath, lines.join('\n'));
  if (!jsonOutput) {
    process.stdout.write('\nwrote: ' + mdPath + '\n');
  }

  // Exit non-zero if any source is unhealthy
  const anyUnhealthy = payload.sources.some(function (s) { return !s.healthy; });
  return anyUnhealthy ? 1 : 0;
}

// -------- release-check: pre-release readiness verification -------------
// runReleaseChecks(cfg) runs 19 readiness checks against the project at
// cfg.appRoot and returns an array of { id, name, status, detail } where
// status is 'pass', 'blocker', or 'warning'. This function is exported for
// testability; cmdReleaseCheck wraps it with output and report writing.
function runReleaseChecks(cfg) {
  const appRoot = cfg && cfg.appRoot ? cfg.appRoot : PROJECT_ROOT;
  const results = [];
  let checkId = 0;

  function addCheck(name, status, detail) {
    checkId += 1;
    results.push({ id: checkId, name: name, status: status, detail: detail });
  }

  function readText(relPath) {
    try {
      return fs.readFileSync(path.join(appRoot, relPath), 'utf8');
    } catch (_) {
      return null;
    }
  }

  function exists(relPath) {
    return fs.existsSync(path.join(appRoot, relPath));
  }

  // ---- 1. package.json version is current ----
  const pkgRaw = readText('package.json');
  let pkg = null;
  try { pkg = pkgRaw ? JSON.parse(pkgRaw) : null; } catch (_) { pkg = null; }
  const currentVersion = pkg ? pkg.version : null;
  if (currentVersion && /^1\.\d+\.\d+/.test(currentVersion)) {
    addCheck('package.json version is current', 'pass', 'version: ' + currentVersion);
  } else {
    addCheck('package.json version is current', 'blocker',
      currentVersion ? 'unexpected version: ' + currentVersion : 'package.json not readable');
  }

  // ---- 2. CHANGELOG.md has current version entry ----
  const changelog = readText('CHANGELOG.md');
  if (changelog && currentVersion && changelog.indexOf(currentVersion) >= 0) {
    addCheck('CHANGELOG.md has current version entry', 'pass', 'found ' + currentVersion + ' entry');
  } else {
    addCheck('CHANGELOG.md has current version entry', 'blocker',
      changelog ? currentVersion + ' not found in CHANGELOG' : 'CHANGELOG.md not readable');
  }

  // ---- 3. README.md has no stale version references ----
  // Skip lines that are legitimate old-screenshot captions (e.g. "v0.5.2 preview").
  const readme = readText('README.md');
  const staleReadmeVersions = ['v1.1.2', 'v0.5.2', 'v1.1.0', 'v1.1.1', 'v1.2.0'];
  var foundStaleReadme = [];
  if (readme) {
    const readmeLines = readme.split('\n');
    for (const line of readmeLines) {
      // Skip legitimate old-screenshot captions and markdown tables
      if (/^\|.*v\d+\.\d+\.\d+.*\|/.test(line)) continue;
      if (/preview|screenshot|older UI|old UI/i.test(line)) continue;
      for (const v of staleReadmeVersions) {
        if (line.indexOf(v) >= 0) foundStaleReadme.push(v);
      }
    }
  }
  if (foundStaleReadme.length === 0) {
    addCheck('README.md has no stale version references', 'pass', 'no stale versions found');
  } else {
    addCheck('README.md has no stale version references', 'blocker',
      'found: ' + foundStaleReadme.join(', '));
  }

  // ---- 4. docs/ has no stale current-version references ----
  const staleDocsVersions = ['v1.1.0', 'v1.1.1', 'v1.1.2', 'v0.5.2', 'v1.2.0'];
  const docsDir = path.join(appRoot, 'docs');
  var foundStaleDocs = [];
  if (fs.existsSync(docsDir)) {
    for (const f of fs.readdirSync(docsDir)) {
      if (!f.endsWith('.md')) continue;
      const content = readText('docs/' + f);
      if (!content) continue;
      // Check line by line, skipping table rows (Release History tables
      // legitimately list old version numbers).
      var lines = content.split('\n');
      for (var li = 0; li < lines.length; li++) {
        if (lines[li].trim().charAt(0) === '|') continue;
        for (const v of staleDocsVersions) {
          if (lines[li].indexOf(v) >= 0) {
            foundStaleDocs.push(v + ' in docs/' + f);
          }
        }
      }
    }
  }
  if (foundStaleDocs.length === 0) {
    addCheck('docs/ has no stale current-version references', 'pass', 'no stale versions in docs');
  } else {
    addCheck('docs/ has no stale current-version references', 'warning',
      'found: ' + foundStaleDocs.join(', '));
  }

  // ---- 5. npm pack excludes real output files ----
  const npmignore = readText('.npmignore');
  const forbiddenDirPatterns = ['data/', 'journal/', 'reports/', 'dist/'];
  var npmignoreOk = false;
  if (npmignore) {
    npmignoreOk = forbiddenDirPatterns.every(function (p) {
      return npmignore.indexOf(p) >= 0;
    });
  }
  var filesFieldProtects = true;
  if (pkg && Array.isArray(pkg.files)) {
    // If files field is an allowlist, forbidden dirs are excluded unless
    // they appear as top-level directory entries (e.g. "data/").
    filesFieldProtects = !pkg.files.some(function (f) {
      return forbiddenDirPatterns.indexOf(f) >= 0;
    });
  }
  if (npmignoreOk || filesFieldProtects) {
    addCheck('npm pack excludes real output files', 'pass',
      npmignoreOk ? '.npmignore excludes data/journal/reports/dist' : 'files allowlist excludes forbidden dirs');
  } else {
    addCheck('npm pack excludes real output files', 'blocker',
      'no .npmignore protection and files field includes forbidden dirs');
  }

  // ---- 6. package:public script exists ----
  if (pkg && pkg.scripts && pkg.scripts['package:public']) {
    addCheck('package:public script exists', 'pass', 'found');
  } else {
    addCheck('package:public script exists', 'blocker', 'missing');
  }

  // ---- 7. test:sources script exists ----
  if (pkg && pkg.scripts && pkg.scripts['test:sources']) {
    addCheck('test:sources script exists', 'pass', 'found');
  } else {
    addCheck('test:sources script exists', 'blocker', 'missing');
  }

  // ---- 8. verify:fresh script exists ----
  if (pkg && pkg.scripts && pkg.scripts['verify:fresh']) {
    addCheck('verify:fresh script exists', 'pass', 'found');
  } else {
    addCheck('verify:fresh script exists', 'blocker', 'missing');
  }

  // ---- 9. test:privacy script exists ----
  if (pkg && pkg.scripts && pkg.scripts['test:privacy']) {
    addCheck('test:privacy script exists', 'pass', 'found');
  } else {
    addCheck('test:privacy script exists', 'blocker', 'missing');
  }

  // ---- 10. screenshots exist (warning, not blocker) ----
  const screenshotsDir = path.join(appRoot, 'docs', 'screenshots');
  if (fs.existsSync(screenshotsDir)) {
    const screenshots = fs.readdirSync(screenshotsDir)
      .filter(function (f) { return /\.(png|jpg|jpeg|gif|webp)$/i.test(f); });
    if (screenshots.length > 0) {
      addCheck('screenshots exist', 'pass', screenshots.length + ' screenshot(s) found');
    } else {
      addCheck('screenshots exist', 'warning', 'docs/screenshots/ is empty');
    }
  } else {
    addCheck('screenshots exist', 'warning', 'docs/screenshots/ not found');
  }

  // ---- 11. GitHub Actions workflow includes test:privacy and console test ----
  const ciYml = readText('.github/workflows/ci.yml');
  if (ciYml) {
    const aggregateTest = pkg && pkg.scripts && pkg.scripts.test
      ? pkg.scripts.test
      : '';
    const ciRunsAggregateTest = /\bnpm(?:\.cmd)?\s+(?:run\s+)?test(?:\s|$)/m.test(ciYml);
    const hasPrivacy = ciYml.indexOf('test:privacy') >= 0 ||
      (ciRunsAggregateTest && aggregateTest.indexOf('test:privacy') >= 0);
    const hasConsole = ciYml.indexOf('test:console') >= 0 ||
      ciYml.indexOf('smoke') >= 0 ||
      ciYml.indexOf('console.smoke') >= 0 ||
      (ciRunsAggregateTest && (
        aggregateTest.indexOf('test:console') >= 0 ||
        aggregateTest.indexOf('smoke') >= 0));
    if (hasPrivacy && hasConsole) {
      addCheck('CI workflow includes test:privacy and console test', 'pass',
        ciRunsAggregateTest
          ? 'covered by npm test aggregate'
          : 'found test:privacy and console/smoke');
    } else {
      var missing = [];
      if (!hasPrivacy) missing.push('test:privacy');
      if (!hasConsole) missing.push('test:console/smoke');
      addCheck('CI workflow includes test:privacy and console test', 'blocker',
        'missing: ' + missing.join(', '));
    }
  } else {
    addCheck('CI workflow includes test:privacy and console test', 'blocker',
      '.github/workflows/ci.yml not found');
  }

  // ---- 12. package.json files field excludes forbidden dirs ----
  if (pkg && Array.isArray(pkg.files)) {
    const badEntries = pkg.files.filter(function (f) {
      return forbiddenDirPatterns.indexOf(f) >= 0;
    });
    if (badEntries.length === 0) {
      addCheck('package.json files field excludes forbidden dirs', 'pass',
        'no data/journal/reports/dist directory entries');
    } else {
      addCheck('package.json files field excludes forbidden dirs', 'blocker',
        'forbidden entries: ' + badEntries.join(', '));
    }
  } else {
    addCheck('package.json files field excludes forbidden dirs', 'warning',
      'no files field defined');
  }

  // ---- 13. bin entry exists and is readable ----
  if (pkg && pkg.bin) {
    var binPath;
    if (typeof pkg.bin === 'string') {
      binPath = pkg.bin;
    } else {
      binPath = pkg.bin['codexjournal-lite'] || pkg.bin['codexjournal'] ||
        Object.keys(pkg.bin).map(function (k) { return pkg.bin[k]; })[0];
    }
    if (binPath && exists(binPath)) {
      addCheck('bin entry exists and is readable', 'pass', binPath);
    } else {
      addCheck('bin entry exists and is readable', 'blocker',
        binPath ? 'bin file not found: ' + binPath : 'no bin path');
    }
  } else {
    addCheck('bin entry exists and is readable', 'blocker', 'no bin field in package.json');
  }

  // ---- 14. help text includes all main commands ----
  const indexSrc = readText('src/index.js');
  const requiredCommands = ['archive', 'check', 'preview', 'changelog', 'doctor', 'source-doctor', 'release-check', 'export', 'tag', 'cluster', 'migrate'];
  if (indexSrc) {
    const missingCmds = requiredCommands.filter(function (c) {
      return indexSrc.indexOf(c) < 0;
    });
    if (missingCmds.length === 0) {
      addCheck('help text includes all main commands', 'pass',
        'all commands found in src/index.js');
    } else {
      addCheck('help text includes all main commands', 'blocker',
        'missing: ' + missingCmds.join(', '));
    }
  } else {
    addCheck('help text includes all main commands', 'blocker', 'src/index.js not found');
  }

  // ---- 14b. ISSUE_TEMPLATE has no stale version placeholders ----
  const issueTemplateDir = path.join(appRoot, '.github', 'ISSUE_TEMPLATE');
  var staleIssueRefs = [];
  if (fs.existsSync(issueTemplateDir)) {
    for (const f of fs.readdirSync(issueTemplateDir)) {
      if (!/\.(yml|yaml|md)$/i.test(f)) continue;
      const content = readText('.github/ISSUE_TEMPLATE/' + f);
      if (!content) continue;
      const stalePlaceholders = ['1.1.2', '1.1.1', '1.1.0', '0.5.2'];
      for (const v of stalePlaceholders) {
        if (content.indexOf(v) >= 0) {
          staleIssueRefs.push(v + ' in .github/ISSUE_TEMPLATE/' + f);
        }
      }
    }
  }
  if (staleIssueRefs.length === 0) {
    addCheck('ISSUE_TEMPLATE has no stale version placeholders', 'pass', 'clean');
  } else {
    addCheck('ISSUE_TEMPLATE has no stale version placeholders', 'blocker',
      'found: ' + staleIssueRefs.join(', '));
  }

  // ---- 14c. README/docs do not reference stale screenshot versions ----
  // Skip release history tables (| v1.x.x | description |) and CHANGELOG entries.
  const staleScreenshotVersions = ['v0.5.2', 'v1.1.2', 'v1.1.0', 'v1.1.1'];
  var staleScreenshotRefs = [];
  function findStaleRefs(text, sourceName) {
    if (!text) return;
    const lines = text.split('\n');
    for (const line of lines) {
      // Skip table rows (release history) and CHANGELOG headers
      if (/^\|.*v\d+\.\d+\.\d+.*\|/.test(line)) continue;
      if (/^##\s*\[\d+\.\d+\.\d+\]/.test(line)) continue;
      // Skip legitimate old-screenshot captions
      if (/preview|screenshot|older UI|old UI/i.test(line)) continue;
      for (const v of staleScreenshotVersions) {
        if (line.indexOf(v) >= 0) {
          staleScreenshotRefs.push(v + ' in ' + sourceName + ' (line: ' + line.trim().slice(0, 60) + ')');
        }
      }
    }
  }
  findStaleRefs(readme, 'README.md');
  if (fs.existsSync(docsDir)) {
    for (const f of fs.readdirSync(docsDir)) {
      if (!f.endsWith('.md')) continue;
      findStaleRefs(readText('docs/' + f), 'docs/' + f);
    }
  }
  if (staleScreenshotRefs.length === 0) {
    addCheck('README/docs have no stale screenshot version refs', 'pass', 'clean');
  } else {
    addCheck('README/docs have no stale screenshot version refs', 'blocker',
      'found: ' + staleScreenshotRefs.join(', '));
  }

  // ---- 15. SECURITY.md, CONTRIBUTING.md, LICENSE exist ----
  const requiredDocs = ['SECURITY.md', 'CONTRIBUTING.md', 'LICENSE'];
  const missingDocs = requiredDocs.filter(function (f) { return !exists(f); });
  if (missingDocs.length === 0) {
    addCheck('SECURITY.md, CONTRIBUTING.md, LICENSE exist', 'pass', 'all present');
  } else {
    addCheck('SECURITY.md, CONTRIBUTING.md, LICENSE exist', 'blocker',
      'missing: ' + missingDocs.join(', '));
  }

  // ---- 16. README contains quick start, privacy, and source support ----
  if (readme) {
    const hasQuickStart = /quick.?start/i.test(readme);
    const hasPrivacy = /privacy/i.test(readme);
    const hasSources = /supported.?sources|source.?support/i.test(readme);
    var missingSections = [];
    if (!hasQuickStart) missingSections.push('quick start');
    if (!hasPrivacy) missingSections.push('privacy');
    if (!hasSources) missingSections.push('source support');
    if (missingSections.length === 0) {
      addCheck('README contains quick start, privacy, and source support', 'pass',
        'all sections found');
    } else {
      addCheck('README contains quick start, privacy, and source support', 'blocker',
        'missing: ' + missingSections.join(', '));
    }
  } else {
    addCheck('README contains quick start, privacy, and source support', 'blocker',
      'README.md not found');
  }

  // ---- 17. verify:public-zip script exists ----
  if (pkg && pkg.scripts && pkg.scripts['verify:public-zip']) {
    addCheck('verify:public-zip script exists', 'pass', 'found');
  } else {
    addCheck('verify:public-zip script exists', 'blocker', 'missing');
  }

  return results;
}

function cmdReleaseCheck(cfg) {
  logHeader('release-check');

  const results = runReleaseChecks(cfg);
  const blockers = results.filter(function (r) { return r.status === 'blocker'; });
  const warnings = results.filter(function (r) { return r.status === 'warning'; });
  const passes = results.filter(function (r) { return r.status === 'pass'; });

  for (const r of results) {
    const tag = r.status === 'pass' ? 'PASS' : (r.status === 'blocker' ? 'FAIL' : 'WARN');
    process.stdout.write('[' + tag + '] #' + r.id + ' ' + r.name + ' :: ' + r.detail + '\n');
  }

  process.stdout.write('\npass=' + passes.length +
    ' blocker=' + blockers.length +
    ' warning=' + warnings.length + '\n');

  // Determine version for the report header
  const appRoot = cfg && cfg.appRoot ? cfg.appRoot : PROJECT_ROOT;
  var version = 'unknown';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    version = pkg.version || 'unknown';
  } catch (_) { /* keep 'unknown' */ }

  const reportsDir = cfg && cfg.reportsDir ? cfg.reportsDir : path.join(appRoot, 'reports');
  utils.ensureDir(reportsDir);

  const generatedAt = new Date().toISOString();
  const exitCode = blockers.length > 0 ? 1 : 0;
  const resultStr = exitCode === 0 ? 'READY' : 'NOT READY';

  // Write JSON report
  const jsonPayload = {
    generatedAt: generatedAt,
    version: version,
    result: resultStr,
    summary: {
      total: results.length,
      pass: passes.length,
      blocker: blockers.length,
      warning: warnings.length
    },
    checks: results
  };
  utils.writeJsonSafe(path.join(reportsDir, 'release-readiness.json'), jsonPayload);

  // Write Markdown report
  const lines = [];
  lines.push('# Release Readiness Report');
  lines.push('');
  lines.push('- generatedAt: ' + generatedAt);
  lines.push('- version: ' + version);
  lines.push('- result: ' + resultStr);
  lines.push('- total: ' + results.length + ' | pass: ' + passes.length +
    ' | blocker: ' + blockers.length + ' | warning: ' + warnings.length);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| # | check | status | detail |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of results) {
    lines.push('| ' + r.id + ' | ' + r.name + ' | ' + r.status.toUpperCase() + ' | ' + r.detail + ' |');
  }
  lines.push('');
  if (blockers.length > 0) {
    lines.push('## Blockers');
    lines.push('');
    for (const b of blockers) {
      lines.push('- #' + b.id + ' ' + b.name + ': ' + b.detail);
    }
    lines.push('');
  }
  if (warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const w of warnings) {
      lines.push('- #' + w.id + ' ' + w.name + ': ' + w.detail);
    }
    lines.push('');
  }
  utils.writeTextSafe(path.join(reportsDir, 'release-readiness.md'), lines.join('\n'));

  process.stdout.write('wrote: reports/release-readiness.md\n');
  process.stdout.write('wrote: reports/release-readiness.json\n');
  process.stdout.write('release readiness: ' + resultStr + '\n');

  return exitCode;
}

// -------- P6-1: export --------------------------------------------------
// Export sanitized tasks to dist/exports/ in jsonl or markdown format.
// Supports --format, --from, --to, --source, --type filter options.
// All output is sanitized; no raw secrets or unsanitized rawFilePath.
function loadTasksFromData(cfg) {
  const tasksFile = path.join(cfg.dataDir, TASKS_FILE);
  if (!utils.exists(tasksFile)) return [];
  const data = utils.readJsonSafe(tasksFile, { tasks: [] });
  // Support both legacy array format and {tasks:[]} format.
  if (Array.isArray(data)) return data;
  return data.tasks || [];
}

function buildExportRecord(t) {
  // Build a sanitized, share-safe record from a task object.
  // rawFilePath is excluded entirely from exports to avoid leaking
  // local directory structures even when sanitized.
  return {
    id: t.id,
    date: t.date,
    time: t.time,
    source: t.source,
    type: t.taskType,
    title: sanitize.redactText(t.title || ''),
    projectPath: t.projectPath ? sanitize.redactPath(t.projectPath) : null,
    keywords: sanitize.redactKeywords(t.keywords),
    messageCount: t.messageCount || 0,
    userSummary: sanitize.redactText(t.userSummary || ''),
    assistantSummary: sanitize.redactText(t.assistantSummary || ''),
    firstTimestamp: t.firstTimestamp || null,
    lastTimestamp: t.lastTimestamp || null
  };
}

function cmdExport(cfg, opts) {
  logHeader('export');

  const format = (opts && opts.format) || 'jsonl';
  if (format !== 'jsonl' && format !== 'markdown') {
    process.stderr.write('ERROR: --format must be "jsonl" or "markdown", got: ' + format + '\n');
    return 1;
  }

  const tasks = loadTasksFromData(cfg);
  if (tasks.length === 0) {
    process.stdout.write('No tasks found in data/tasks.json. Run `npm run archive` first.\n');
    return 0;
  }

  // Build a structured query from filter options and reuse searchQuery logic.
  const queryParts = [];
  if (opts && opts.source) queryParts.push('source:' + opts.source);
  if (opts && opts.type) queryParts.push('type:' + opts.type);
  if (opts && opts.from) queryParts.push('from:' + opts.from);
  if (opts && opts.to) queryParts.push('to:' + opts.to);
  const parsed = searchQuery.parseSearchQuery(queryParts.join(' '));

  const filtered = tasks.filter(function (t) {
    return searchQuery.matchTask(t, parsed);
  });

  if (filtered.length === 0) {
    process.stdout.write('No tasks matched the filter.\n');
    return 0;
  }

  // Sanitize every task before writing.
  const records = filtered.map(buildExportRecord);

  // Output directory: dist/exports/ under the workspace root.
  const exportDir = path.resolve(cfg.projectRoot || PROJECT_ROOT, 'dist', 'exports');
  utils.ensureDir(exportDir);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const generatedAt = new Date().toISOString();

  if (format === 'jsonl') {
    const outFile = path.join(exportDir, 'export-' + ts + '.jsonl');
    const lines = records.map(function (r) { return JSON.stringify(r); });
    utils.writeTextSafe(outFile, lines.join('\n') + '\n');
    process.stdout.write('exported ' + records.length + ' task(s) to ' + outFile + '\n');
  } else {
    const outFile = path.join(exportDir, 'export-' + ts + '.md');
    const lines = [];
    lines.push('# Export');
    lines.push('');
    lines.push('- generatedAt: ' + generatedAt);
    lines.push('- taskCount: ' + records.length);
    lines.push('- format: markdown');
    lines.push('');
    lines.push('| date | time | source | type | title | projectPath |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of records) {
      lines.push('| ' + (r.date || '') + ' | ' + (r.time || '') + ' | ' +
        (r.source || '') + ' | ' + (r.type || '') + ' | ' +
        (r.title || '') + ' | ' + (r.projectPath || '') + ' |');
    }
    lines.push('');
    utils.writeTextSafe(outFile, lines.join('\n'));
    process.stdout.write('exported ' + records.length + ' task(s) to ' + outFile + '\n');
  }

  return 0;
}

// -------- P6-2: tag -----------------------------------------------------
// Local-only tag storage in data/tags.json. Tags are sanitized via
// sanitize.redactText() and never modify the original task records.
function loadTags(cfg) {
  const tagsFile = path.join(cfg.dataDir, 'tags.json');
  return utils.readJsonSafe(tagsFile, {});
}

function saveTags(cfg, tags) {
  const tagsFile = path.join(cfg.dataDir, 'tags.json');
  utils.writeJsonSafe(tagsFile, tags);
}

function cmdTag(cfg, args) {
  logHeader('tag');

  const sub = args[0] || 'list';

  if (sub === 'add') {
    const taskId = args[1];
    const rawTag = args[2];
    if (!taskId || !rawTag) {
      process.stderr.write('Usage: tag add <taskId> <tag>\n');
      return 1;
    }
    const tag = sanitize.redactText(rawTag);
    if (!tag || tag.trim().length === 0) {
      process.stderr.write('ERROR: tag is empty after sanitization\n');
      return 1;
    }
    const tags = loadTags(cfg);
    if (!tags[taskId]) tags[taskId] = [];
    if (tags[taskId].indexOf(tag) < 0) {
      tags[taskId].push(tag);
    }
    saveTags(cfg, tags);
    process.stdout.write('added tag "' + tag + '" to task ' + taskId + '\n');
    return 0;
  }

  if (sub === 'remove') {
    const taskId = args[1];
    const rawTag = args[2];
    if (!taskId || !rawTag) {
      process.stderr.write('Usage: tag remove <taskId> <tag>\n');
      return 1;
    }
    const tag = sanitize.redactText(rawTag);
    const tags = loadTags(cfg);
    if (tags[taskId]) {
      const idx = tags[taskId].indexOf(tag);
      if (idx >= 0) {
        tags[taskId].splice(idx, 1);
        if (tags[taskId].length === 0) delete tags[taskId];
      }
    }
    saveTags(cfg, tags);
    process.stdout.write('removed tag "' + tag + '" from task ' + taskId + '\n');
    return 0;
  }

  if (sub === 'list') {
    const taskId = args[1];
    const tags = loadTags(cfg);
    if (taskId) {
      const taskTags = tags[taskId] || [];
      process.stdout.write('Tags for ' + taskId + ': ' +
        (taskTags.length ? taskTags.join(', ') : '(none)') + '\n');
    } else {
      const keys = Object.keys(tags);
      if (keys.length === 0) {
        process.stdout.write('No tags found.\n');
      } else {
        for (const k of keys) {
          process.stdout.write(k + ': ' + tags[k].join(', ') + '\n');
        }
      }
    }
    return 0;
  }

  if (sub === 'search') {
    const rawTag = args[1];
    if (!rawTag) {
      process.stderr.write('Usage: tag search <tag>\n');
      return 1;
    }
    const tag = sanitize.redactText(rawTag);
    const tags = loadTags(cfg);
    const matches = [];
    for (const k of Object.keys(tags)) {
      if (tags[k].indexOf(tag) >= 0) matches.push(k);
    }
    process.stdout.write('Tasks with tag "' + tag + '": ' + matches.length + '\n');
    for (const id of matches) {
      process.stdout.write('  ' + id + '\n');
    }
    return 0;
  }

  process.stderr.write('Unknown tag subcommand: ' + sub + '\n');
  process.stderr.write('Usage: tag <add|remove|list|search> [args]\n');
  return 1;
}

// -------- P6-3: cluster -------------------------------------------------
// Rule-based grouping of tasks by project, source, type, top keywords,
// and date week. No embeddings, no network. All output is sanitized.
function getWeekKey(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return 'unknown';
  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d.getTime())) return 'unknown';
  // Compute the Monday of the week (ISO-style week starting Monday).
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return y + '-W' + y + '-' + m + '-' + dd;
}

function cmdCluster(cfg) {
  logHeader('cluster');

  const tasks = loadTasksFromData(cfg);
  if (tasks.length === 0) {
    process.stdout.write('No tasks found in data/tasks.json. Run `npm run archive` first.\n');
    return 0;
  }

  // Sanitize all tasks before grouping.
  const sanitized = tasks.map(sanitizeTaskForExport);

  const byProject = {};
  const bySource = {};
  const byType = {};
  const byKeyword = {};
  const byWeek = {};

  for (const t of sanitized) {
    const proj = t.projectPath || '(none)';
    if (!byProject[proj]) byProject[proj] = [];
    byProject[proj].push(t.id);

    const src = t.source || 'unknown';
    if (!bySource[src]) bySource[src] = [];
    bySource[src].push(t.id);

    const tp = t.taskType || 'general';
    if (!byType[tp]) byType[tp] = [];
    byType[tp].push(t.id);

    if (Array.isArray(t.keywords)) {
      for (const kw of t.keywords) {
        if (!kw) continue;
        if (!byKeyword[kw]) byKeyword[kw] = [];
        byKeyword[kw].push(t.id);
      }
    }

    const wk = getWeekKey(t.date);
    if (!byWeek[wk]) byWeek[wk] = [];
    byWeek[wk].push(t.id);
  }

  // Top keywords: sort by frequency, keep top 20.
  const sortedKw = Object.keys(byKeyword)
    .sort(function (a, b) { return byKeyword[b].length - byKeyword[a].length; })
    .slice(0, 20);
  const topKeywords = {};
  for (const kw of sortedKw) topKeywords[kw] = byKeyword[kw];

  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt: generatedAt,
    taskCount: sanitized.length,
    clusters: {
      byProject: byProject,
      bySource: bySource,
      byType: byType,
      topKeywords: topKeywords,
      byWeek: byWeek
    }
  };

  utils.writeJsonSafe(path.join(cfg.reportsDir, 'clusters.json'), payload);

  // Markdown report
  const lines = [];
  lines.push('# Clusters Report');
  lines.push('');
  lines.push('- generatedAt: ' + generatedAt);
  lines.push('- taskCount: ' + sanitized.length);
  lines.push('');

  function writeGroup(title, groups) {
    lines.push('## ' + title);
    lines.push('');
    lines.push('| key | count |');
    lines.push('| --- | --- |');
    const keys = Object.keys(groups).sort(function (a, b) {
      return groups[b].length - groups[a].length;
    });
    for (const k of keys) {
      lines.push('| ' + k + ' | ' + groups[k].length + ' |');
    }
    lines.push('');
  }

  writeGroup('By Project', byProject);
  writeGroup('By Source', bySource);
  writeGroup('By Type', byType);
  writeGroup('Top Keywords', topKeywords);
  writeGroup('By Week', byWeek);

  utils.writeTextSafe(path.join(cfg.reportsDir, 'clusters.md'), lines.join('\n'));

  process.stdout.write('tasks: ' + sanitized.length + '\n');
  process.stdout.write('projects: ' + Object.keys(byProject).length + '\n');
  process.stdout.write('sources: ' + Object.keys(bySource).length + '\n');
  process.stdout.write('types: ' + Object.keys(byType).length + '\n');
  process.stdout.write('keywords: ' + Object.keys(byKeyword).length + '\n');
  process.stdout.write('weeks: ' + Object.keys(byWeek).length + '\n');
  process.stdout.write('wrote: reports/clusters.md\n');
  process.stdout.write('wrote: reports/clusters.json\n');

  return 0;
}

// -------- P6-4: migrate -------------------------------------------------
// Normalizes data/tasks.json to the {tasks:[]} format and generates
// data/archive-meta.json. Does not break old data; supports both legacy
// array format and the current {tasks:[]} format.
function cmdMigrate(cfg) {
  logHeader('migrate');

  const tasksFile = path.join(cfg.dataDir, TASKS_FILE);
  if (!utils.exists(tasksFile)) {
    process.stdout.write('No tasks.json found. Run `npm run archive` first.\n');
    return 1;
  }

  const raw = fs.readFileSync(tasksFile, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    process.stderr.write('ERROR: tasks.json is not valid JSON: ' + err.message + '\n');
    return 1;
  }

  const generatedAt = new Date().toISOString();
  const lines = [];
  lines.push('# Migration Report');
  lines.push('');
  lines.push('- generatedAt: ' + generatedAt);
  lines.push('');

  let tasks;
  let formatDetected;
  let migrated = false;

  if (Array.isArray(data)) {
    // Legacy array format — migrate to {tasks:[]}.
    formatDetected = 'array (legacy)';
    tasks = data;
    const newData = {
      generatedAt: generatedAt,
      sessionsDir: sanitize.redactPath(cfg.sessionsDir),
      tasks: tasks.map(sanitizeTaskForExport)
    };
    utils.writeJsonSafe(tasksFile, newData);
    migrated = true;
    lines.push('- detected format: ' + formatDetected);
    lines.push('- action: migrated to {tasks:[]} format');
    lines.push('- taskCount: ' + tasks.length);
  } else if (data && Array.isArray(data.tasks)) {
    // Current {tasks:[]} format — no migration needed.
    formatDetected = '{tasks:[]} (current)';
    tasks = data.tasks;
    lines.push('- detected format: ' + formatDetected);
    lines.push('- action: no migration needed');
    lines.push('- taskCount: ' + tasks.length);
  } else {
    formatDetected = 'unknown';
    process.stderr.write('ERROR: tasks.json has unknown format\n');
    lines.push('- detected format: unknown');
    lines.push('- action: FAILED - could not detect format');
    utils.writeTextSafe(path.join(cfg.reportsDir, 'migration-report.md'), lines.join('\n'));
    return 1;
  }

  // Write archive-meta.json
  const meta = {
    schemaVersion: 1,
    generatedAt: generatedAt,
    taskCount: tasks.length
  };
  utils.writeJsonSafe(path.join(cfg.dataDir, 'archive-meta.json'), meta);

  lines.push('');
  lines.push('## Archive Metadata');
  lines.push('');
  lines.push('| field | value |');
  lines.push('| --- | --- |');
  lines.push('| schemaVersion | ' + meta.schemaVersion + ' |');
  lines.push('| generatedAt | ' + meta.generatedAt + ' |');
  lines.push('| taskCount | ' + meta.taskCount + ' |');
  lines.push('');
  lines.push('## Result');
  lines.push('');
  lines.push('- status: success');
  lines.push('- migrated: ' + migrated);
  lines.push('- archive-meta.json: written');
  lines.push('');

  utils.writeTextSafe(path.join(cfg.reportsDir, 'migration-report.md'), lines.join('\n'));

  process.stdout.write('format: ' + formatDetected + '\n');
  process.stdout.write('tasks: ' + tasks.length + '\n');
  process.stdout.write('migrated: ' + migrated + '\n');
  process.stdout.write('wrote: data/archive-meta.json\n');
  process.stdout.write('wrote: reports/migration-report.md\n');

  return 0;
}

// -------- parse global CLI args ------------------------------------------
function parseGlobalArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sessions-dir' && args[i + 1]) {
      opts.sessionsDir = args[i + 1]; i++;
    }
    if (args[i] === '--config' && args[i + 1]) {
      opts.configPath = args[i + 1]; i++;
    }
    if (args[i] === '--source' && args[i + 1]) {
      opts.source = args[i + 1]; i++;
    }
    if (args[i] === '--root' && args[i + 1]) {
      opts.root = args[i + 1]; i++;
    }
    if (args[i] === '--format' && args[i + 1]) {
      opts.format = args[i + 1]; i++;
    }
    if (args[i] === '--from' && args[i + 1]) {
      opts.from = args[i + 1]; i++;
    }
    if (args[i] === '--to' && args[i + 1]) {
      opts.to = args[i + 1]; i++;
    }
    if (args[i] === '--type' && args[i + 1]) {
      opts.type = args[i + 1]; i++;
    }
    if (args[i] === '--json') {
      opts.json = true;
    }
  }
  // Also check environment variables
  if (!opts.sessionsDir && process.env.CODEXJOURNAL_SESSIONS_DIR) {
    opts.sessionsDir = process.env.CODEXJOURNAL_SESSIONS_DIR;
  }
  if (!opts.root && process.env.CODEXJOURNAL_ROOT) {
    opts.root = process.env.CODEXJOURNAL_ROOT;
  }
  return opts;
}

// -------- first-run detection --------------------------------------------
function detectFirstRun(cfg) {
  const tasksFile = path.join(cfg.dataDir, TASKS_FILE);
  const configFile = path.join(cfg.projectRoot || PROJECT_ROOT, 'config.json');
  const sessionsExists = fs.existsSync(cfg.sessionsDir);

  if (!fs.existsSync(tasksFile)) {
    process.stdout.write('\n[first-run] No archived data found. Running first archive...\n');
    if (!sessionsExists) {
      process.stdout.write('[first-run] Sessions directory not found: ' + cfg.sessionsDir + '\n');
      process.stdout.write('[first-run] Default session locations:\n');
      process.stdout.write('  Codex:       ~/.codex/sessions\n');
      process.stdout.write('  Claude Code: ~/.claude/projects\n');
      process.stdout.write('  Gemini CLI:  ~/.gemini/tmp\n');
      process.stdout.write('  OpenCode:    ~/.local/share/opencode (Unix) / %LOCALAPPDATA%\\opencode (Windows)\n');
      process.stdout.write('  IDEA/JetBrains: ~/.config/JetBrains (Unix) / %APPDATA%\\JetBrains (Windows)\n\n');
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'archive';
  const globalOpts = parseGlobalArgs(args);
  // WORKSPACE_ROOT: where data/journal/reports are written.
  // APP_ROOT: where source code and built-in assets live.
  const WORKSPACE_ROOT = resolveWorkspaceRoot(globalOpts);
  const cfg = cfgMod.loadConfig(WORKSPACE_ROOT, APP_ROOT, globalOpts);
  cfgMod.ensureOutputDirs(cfg);
  // Load custom redaction patterns from config
  if (cfg.redactPatterns) sanitize.setCustomPatterns(cfg.redactPatterns);

  // First-run detection for archive command
  if (cmd === 'archive' || cmd === undefined) {
    detectFirstRun(cfg);
  }

  switch (cmd) {
    case 'check':
      process.exit(cmdCheck(cfg));
      break;
    case 'archive':
      processAll(cfg, { force: args.includes('--force') });
      process.exit(0);
      break;
    case 'stats':
      process.exit(cmdStats(cfg));
      break;
    case 'build-index':
      process.exit(cmdBuildIndex(cfg));
      break;
    case 'preview':
      process.exit(cmdPreview(cfg, globalOpts));
      break;
    case 'changelog':
      process.exit(cmdChangelog(cfg));
      break;
    case 'scan-sources':
      process.exit(cmdScanSources(cfg));
      break;
    case 'summarize':
      process.exit(cmdSummarize(cfg));
      break;
    case 'doctor':
      process.exit(cmdDoctor(cfg, { strict: args.includes('--strict') }));
      break;
    case 'source-doctor':
      process.exit(cmdSourceDoctor(cfg, globalOpts));
      break;
    case 'release-check':
      process.exit(cmdReleaseCheck(cfg));
      break;
    case 'index-outputs':
      process.exit(cmdIndexOutputs(cfg));
      break;
    case 'export':
      process.exit(cmdExport(cfg, globalOpts));
      break;
    case 'tag':
      process.exit(cmdTag(cfg, args.slice(1)));
      break;
    case 'cluster':
      process.exit(cmdCluster(cfg));
      break;
    case 'migrate':
      process.exit(cmdMigrate(cfg));
      break;
    case 'help':
    case '--help':
    case '-h':
      var pkgVersion = require('../package.json').version;
      process.stdout.write('CodexJournal-Lite v' + pkgVersion + ' - Multi-source AI session archiver\n\n');
      process.stdout.write('Usage: node src/index.js <command> [options]\n\n');
      process.stdout.write('Commands:\n');
      process.stdout.write('  archive        Archive sessions from all enabled sources\n');
      process.stdout.write('  check          Verify environment (Node version, dirs, permissions)\n');
      process.stdout.write('  preview        Preview new/changed sessions without writing\n');
      process.stdout.write('  changelog      Generate fingerprint changelog report\n');
      process.stdout.write('  stats          Rebuild data/stats.json from tasks.json\n');
      process.stdout.write('  build-index    Rebuild data/index.json fingerprint cache\n');
      process.stdout.write('  scan-sources   Read-only probe of IDEA/JetBrains log directories\n');
      process.stdout.write('  summarize      Generate work-pattern, monthly, and yearly reports\n');
      process.stdout.write('  doctor         Environment and output completeness check\n');
      process.stdout.write('  source-doctor  Health check for all source adapters (doctor/capabilities)\n');
      process.stdout.write('  release-check  Pre-release readiness verification (17 checks)\n');
      process.stdout.write('  index-outputs  Generate output file index\n');
      process.stdout.write('  export         Export sanitized tasks to dist/exports/ (jsonl or markdown)\n');
      process.stdout.write('  tag            Manage local task tags (add/remove/list/search)\n');
      process.stdout.write('  cluster        Group tasks by project/source/type/keywords/week\n');
      process.stdout.write('  migrate        Migrate data format and generate archive metadata\n');
      process.stdout.write('  help           Show this help message\n\n');
      process.stdout.write('Global options:\n');
      process.stdout.write('  --sessions-dir <path>  Override sessions directory\n');
      process.stdout.write('  --config <path>        Override config.json path\n');
      process.stdout.write('  --source <name>        Filter by source name (preview, source-doctor, export)\n');
      process.stdout.write('  --root <path>          Override workspace root (data/journal/reports location)\n');
      process.stdout.write('  --force                Force re-parse all files (archive only)\n');
      process.stdout.write('  --strict               Treat optional checks as failures (doctor only)\n');
      process.stdout.write('  --json                 Output JSON format (source-doctor)\n');
      process.stdout.write('  --format <fmt>         Export format: jsonl or markdown (export only)\n');
      process.stdout.write('  --from <date>          Filter tasks from date YYYY-MM-DD (export only)\n');
      process.stdout.write('  --to <date>            Filter tasks to date YYYY-MM-DD (export only)\n');
      process.stdout.write('  --type <type>          Filter by task type (export only)\n');
      process.stdout.write('\nEnvironment variables:\n');
      process.stdout.write('  CODEXJOURNAL_SESSIONS_DIR  Override sessions directory\n');
      process.stdout.write('  CODEXJOURNAL_ROOT          Override workspace root\n');
      process.exit(0);
      break;
    default:
      process.stderr.write('Unknown command: ' + cmd + '\n');
      process.stderr.write('Run "node src/index.js help" for usage.\n');
      process.exit(2);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write('FATAL: ' + (err && err.stack ? err.stack : String(err)) + '\n');
    process.exit(1);
  }
}

module.exports = { processAll, cmdCheck, cmdPreview, cmdSourceDoctor, cmdReleaseCheck, runReleaseChecks, parseGlobalArgs, cmdExport, cmdTag, cmdCluster, cmdMigrate };
