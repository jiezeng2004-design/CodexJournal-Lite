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

const PROJECT_ROOT = path.resolve(__dirname, '..');

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

function processAll(cfg, opts) {
  const force = !!(opts && opts.force);
  logHeader('archive');
  const scan = scanner.scanSessionsDir(cfg.sessionsDir);
  if (scan.missing) {
    process.stdout.write('sessions dir missing: ' + cfg.sessionsDir + '\n');
    writeEmptyOutputs(cfg);
    return { tasks: [], scanned: 0, missing: true };
  }
  if (scan.errors.length) {
    for (const e of scan.errors) appendError(cfg, 'scan ' + e.path + ' ' + e.err);
  }
  process.stdout.write('found ' + scan.files.length + ' session file(s)\n');

  const index = loadIndex(cfg);
  const fileMap = index.files || (index.files = {});

  // Reuse previous task records when the fingerprint matches; re-parse otherwise.
  const allTasks = [];
  let processed = 0;
  let reused = 0;
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
    // Keep original (un-redacted) path in the cache for fingerprint stability
    // across runs, but the disk-written index.json below has the redacted form.
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
  // data/index.json is a local-only cache (see .gitignore) used to track
  // fingerprint stability across runs. We deliberately keep the original
  // absolute paths in its keys so that lookups stay stable. We do, however,
  // redact the per-task rawFilePath / summaries that are embedded in the
  // cache, so that the file is safe to inspect or copy if needed.
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
  return { tasks: allTasks, stats, scanned: scan.files.length, missing: false, processed, reused };
}

function sanitizeTaskForExport(t) {
  // Replace local Windows usernames in any path-like field, but keep
  // the original id, counts, timestamps, and metadata untouched.
  return Object.assign({}, t, {
    rawFilePath: sanitize.redactPath(t.rawFilePath),
    projectPath: t.projectPath ? sanitize.redactPath(t.projectPath) : null,
    userSummary: sanitize.redactText(t.userSummary || ''),
    assistantSummary: sanitize.redactText(t.assistantSummary || ''),
    title: sanitize.redactText(t.title || '')
  });
}

function writeEmptyOutputs(cfg) {
  const stats = writer.buildStats([], cfg);
  utils.writeJsonSafe(path.join(cfg.dataDir, TASKS_FILE), {
    generatedAt: new Date().toISOString(),
    sessionsDir: cfg.sessionsDir,
    tasks: []
  });
  utils.writeJsonSafe(path.join(cfg.dataDir, STATS_FILE), stats);
  utils.writeTextSafe(path.join(cfg.dataDir, SEARCH_FILE),
    '# CodexJournal-Lite Search Index\n\n> No sessions found at ' + cfg.sessionsDir + '\n');
  utils.writeTextSafe(path.join(cfg.reportsDir, DASHBOARD_FILE), writer.buildDashboard([], stats, cfg));
  saveIndex(cfg, { generatedAt: new Date().toISOString(), sessionsDir: cfg.sessionsDir, files: {} });
}

function cmdCheck(cfg) {
  logHeader('check');
  const results = [];
  const nodeVer = process.versions.node;
  const major = parseInt(nodeVer.split('.')[0], 10);
  results.push({ name: 'node-version', ok: major >= 18, detail: nodeVer });
  const exists = utils.exists(cfg.sessionsDir);
  results.push({ name: 'sessions-dir', ok: exists, detail: cfg.sessionsDir });
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
  let allOk = true;
  for (const r of results) {
    const tag = r.ok ? 'OK ' : 'FAIL';
    process.stdout.write('[' + tag + '] ' + r.name + ' :: ' + r.detail + '\n');
    if (!r.ok) allOk = false;
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
  // config.json -> sources[]. v0.4.1 only implements the IDEA / JetBrains
  // probe; the Codex source still goes through the legacy archive path.
  // This command MUST NOT touch journal/, data/tasks.json, data/stats.json,
  // data/search.md, reports/dashboard.md, or data/index.json. v0.4.1 also writes
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

function cmdDoctor(cfg) {
  // Environment and output completeness check.
  // Writes reports/doctor.md. Does NOT modify any other file.
  logHeader('doctor');
  const lines = [];
  const ok = [];
  const fail = [];
  function check(label, predicate, detail) {
    if (predicate) { ok.push(label); } else { fail.push(label + (detail ? ': ' + detail : '')); }
  }
  const pr = cfg && cfg.projectRoot ? cfg.projectRoot : path.resolve(__dirname, '..');
  check('Node version >= 18', parseInt(process.versions.node, 10) >= 18, process.versions.node);
  check('Project root exists', fs.existsSync(pr));
  check('config.json exists', fs.existsSync(path.join(pr, 'config.json')));
  try { JSON.parse(fs.readFileSync(path.join(pr, 'config.json'), 'utf8')); check('config.json is JSON', true); } catch (_) { check('config.json is JSON', false); }
  check('sessionsDir exists', fs.existsSync(cfg.sessionsDir));
  for (const d of ['journal', 'data', 'reports', 'scripts', 'src', 'docs']) check('dir: ' + d + ' exists', fs.existsSync(path.join(pr, d)));
  const pkg = JSON.parse(fs.readFileSync(path.join(pr, 'package.json'), 'utf8'));
  for (const s of ['archive', 'check', 'verify', 'scan:sources', 'test:sources', 'summarize', 'doctor', 'index:outputs', 'package:local']) {
    check('script: ' + s, !!(pkg.scripts && pkg.scripts[s]));
  }
  check('data/tasks.json exists', fs.existsSync(path.join(cfg.dataDir, TASKS_FILE)));
  check('data/patterns.json exists', fs.existsSync(path.join(cfg.dataDir, 'patterns.json')));
  check('reports/dashboard.md exists', fs.existsSync(path.join(cfg.reportsDir, DASHBOARD_FILE)));
  check('reports/work-patterns.md exists', fs.existsSync(path.join(cfg.reportsDir, 'work-patterns.md')));
  check('reports/idea-log-inventory.md exists', fs.existsSync(path.join(cfg.reportsDir, 'idea-log-inventory.md')));
  check('reports/source-scan-summary.json exists', fs.existsSync(path.join(cfg.reportsDir, 'source-scan-summary.json')));
  check('scripts/install-task.ps1 exists', fs.existsSync(path.join(pr, 'scripts', 'install-task.ps1')));
  check('scripts/git-commit.ps1 exists', fs.existsSync(path.join(pr, 'scripts', 'git-commit.ps1')));

  lines.push('# Doctor Report');
  lines.push('');
  lines.push('- generatedAt: ' + new Date().toISOString());
  lines.push('- projectRoot: ' + pr);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| result | count |');
  lines.push('| --- | --- |');
  lines.push('| pass | ' + ok.length + ' |');
  lines.push('| fail | ' + fail.length + ' |');
  lines.push('');
  if (fail.length) {
    lines.push('## Failures');
    lines.push('');
    for (const f of fail) lines.push('- ' + f);
    lines.push('');
  }
  lines.push('## Details');
  lines.push('');
  for (const p of ok) lines.push('- [OK] ' + p);
  for (const f of fail) lines.push('- [FAIL] ' + f);
  lines.push('');

  const mdPath = path.join(cfg.reportsDir, 'doctor.md');
  utils.writeTextSafe(mdPath, lines.join('\n'));
  process.stdout.write('pass=' + ok.length + ' fail=' + fail.length + '\n');
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

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'archive';
  const cfg = cfgMod.loadConfig(PROJECT_ROOT);
  cfgMod.ensureOutputDirs(cfg);

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
    case 'scan-sources':
      process.exit(cmdScanSources(cfg));
      break;
    case 'summarize':
      process.exit(cmdSummarize(cfg));
      break;
    case 'doctor':
      process.exit(cmdDoctor(cfg));
      break;
    case 'index-outputs':
      process.exit(cmdIndexOutputs(cfg));
      break;
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write('Usage: node src/index.js <check|archive|stats|build-index|scan-sources|summarize|doctor|index-outputs> [--force]\n');
      process.exit(0);
      break;
    default:
      process.stderr.write('Unknown command: ' + cmd + '\n');
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

module.exports = { processAll, cmdCheck };
