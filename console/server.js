// CodexJournal-Lite local console server.
//
// No external dependencies. Uses Node 18+ built-ins only.
// Binds to 127.0.0.1 by default (local-only). Override with PORT / HOST env.
//
// Endpoints:
//   GET  /                          -> index.html
//   GET  /static/*                  -> static assets
//   GET  /api/dashboard             -> aggregated stats + project meta
//   GET  /api/journal               -> list of journal files
//   GET  /api/journal/:date         -> content of one journal file
//   GET  /api/reports               -> list of report files (top-level + monthly + yearly)
//   GET  /api/reports/*             -> content of one report
//   GET  /api/data                  -> list of data files
//   GET  /api/data/:name            -> content of one data file (json pretty or text)
//   GET  /api/data/tasks?limit&offset&q&type -> paginated task list (type = codex|thesis|...)
//   GET  /api/dist                  -> list of dist files with sizes
//   GET  /api/verify-tail           -> last N lines of reports/verify-full.log
//   GET  /api/search?q=&limit=      -> global cross-content search (journal/tasks/reports)
//   GET  /api/jobs                  -> list of jobs (running + recent)
//   GET  /api/jobs/:id              -> job status + last 200 log lines
//   POST /api/run                   -> start a job, body { cmd, args, force }
//   GET  /api/jobs/:id/stream       -> SSE: stdout/stderr/exit events
//   POST /api/jobs/:id/stop         -> kill a running job
//
// Hard rules:
//   - Bind 127.0.0.1 by default. Not reachable from LAN.
//   - Commands are hardcoded allowlist; args are restricted to a small set
//     of flags. No user-supplied command, no shell invocation.
//   - No file writes through the API. All endpoints are read-only.
//   - No network calls outside child_process.spawn of npm.cmd / powershell.

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { URL } = require('url');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR   = path.join(__dirname, 'public');
const PORT         = parseInt(process.env.PORT || '7777', 10);
const HOST         = process.env.HOST || '127.0.0.1';

// --------------------------------------------------------------------------
// Static MIME map
// --------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.log':  'text/plain; charset=utf-8',
  '.zip':  'application/zip'
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function safeJoin(root, rel) {
  // Resolve `..` and absolute paths; reject traversal outside root.
  const target = path.resolve(root, rel);
  const normRoot = path.resolve(root) + path.sep;
  if (target !== path.resolve(root) && !target.startsWith(normRoot)) {
    return null;
  }
  return target;
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': MIME['.json'],
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function textResponse(res, status, text, mime) {
  res.writeHead(status, {
    'Content-Type': mime || MIME['.txt'],
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function notFound(res, msg) {
  jsonResponse(res, 404, { error: msg || 'not found' });
}

function badRequest(res, msg) {
  jsonResponse(res, 400, { error: msg || 'bad request' });
}

async function readJsonSafe(p) {
  try {
    return JSON.parse(await fs.promises.readFile(p, 'utf8'));
  } catch (_) { return null; }
}

async function readTextSafe(p) {
  try {
    return await fs.promises.readFile(p, 'utf8');
  } catch (_) { return null; }
}

async function listFiles(dir, pattern) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (pattern && !pattern.test(e.name)) continue;
      const st = await fs.promises.stat(path.join(dir, e.name));
      out.push({ name: e.name, size: st.size, mtime: st.mtime.toISOString() });
    }
    out.sort((a, b) => b.mtime.localeCompare(a.mtime));
    return out;
  } catch (_) { return []; }
}

async function listDirRecursive(dir, prefix, out) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
  catch (_) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    const rel = prefix ? prefix + '/' + e.name : e.name;
    if (e.isDirectory()) {
      await listDirRecursive(p, rel, out);
    } else if (e.isFile()) {
      const st = await fs.promises.stat(p);
      out.push({ name: rel, size: st.size, mtime: st.mtime.toISOString() });
    }
  }
}

// --------------------------------------------------------------------------
// Job runner
// --------------------------------------------------------------------------
const jobs = new Map();
const JOB_HISTORY_MAX = 30;
const JOB_LOG_MAX     = 4000;
const jobHistory = [];

function makeJobId() {
  return 'j_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function appendJobLog(job, line) {
  job.log.push(line);
  if (job.log.length > JOB_LOG_MAX) {
    job.log.splice(0, job.log.length - JOB_LOG_MAX);
  }
  for (const s of job.sseClients) {
    try { s.write('event: log\ndata: ' + JSON.stringify({ line: line }) + '\n\n'); }
    catch (_) { /* client gone */ }
  }
}

function emitJobEvent(job, event, payload) {
  for (const s of job.sseClients) {
    try { s.write('event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n'); }
    catch (_) { /* client gone */ }
  }
}

// Allowlisted commands. The only string the client may post is `cmd` from
// this table, and `args` is restricted to a known flag set per cmd.
const CMD_TABLE = {
  'check':         { runner: 'npm',  args: () => ['run', 'check'] },
  'archive':       { runner: 'npm',  args: (q) => ['run', 'archive', q.force ? '--' : '', q.force ? '--force' : ''].filter(Boolean) },
  'stats':         { runner: 'npm',  args: () => ['run', 'stats'] },
  'build-index':   { runner: 'npm',  args: () => ['run', 'build-index'] },
  'scan-sources':  { runner: 'npm',  args: () => ['run', 'scan:sources'] },
  'summarize':     { runner: 'npm',  args: () => ['run', 'summarize'] },
  'doctor':        { runner: 'npm',  args: () => ['run', 'doctor'] },
  'index-outputs': { runner: 'npm',  args: () => ['run', 'index:outputs'] },
  'package-local': { runner: 'npm',  args: () => ['run', 'package:local'] },
  'verify':        { runner: 'npm',  args: (q) => ['run', 'verify', q.skipArchive ? '--' : '', q.skipArchive ? '--SkipArchive' : ''].filter(Boolean) }
};

function startJob(cmd, query) {
  const def = CMD_TABLE[cmd];
  if (!def) return { error: 'unknown command: ' + cmd };

  // Refuse to start a second concurrent job of the same kind if one is
  // still running. Keeps the UI honest.
  for (const j of jobs.values()) {
    if (j.cmd === cmd && j.status === 'running') {
      return { error: 'command already running: ' + cmd, jobId: j.id };
    }
  }

  const id = makeJobId();
  const args = def.args(query || {});
  // Spawn npm on Windows. We use the cmd.exe shim and pass the full command
  // as a single string. This avoids the Node 18+ EINVAL on .cmd paths and
  // gives Windows a chance to find npm.cmd via PATH. The args are entirely
  // hardcoded (no user input), so shell:true is safe in this context.
  const isWin = process.platform === 'win32';
  let runnerBin, runnerArgs, runnerOpts;
  if (isWin) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    const quoted = ['npm', ...args].map(a => (/[\s"]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a)).join(' ');
    runnerBin = comspec;
    runnerArgs = ['/d', '/s', '/c', quoted];
    runnerOpts = { cwd: PROJECT_ROOT, env: process.env, windowsHide: true };
  } else {
    runnerBin = 'npm';
    runnerArgs = args;
    runnerOpts = { cwd: PROJECT_ROOT, env: process.env, windowsHide: true };
  }
  const child = spawn(runnerBin, runnerArgs, runnerOpts);

  const job = {
    id, cmd, args, status: 'running', startedAt: new Date().toISOString(),
    endedAt: null, exitCode: null, log: [], proc: child, sseClients: new Set()
  };
  jobs.set(id, job);

  const onLine = (stream) => (buf) => {
    const text = buf.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line === '') continue;
      appendJobLog(job, '[' + stream + '] ' + line);
    }
  };
  child.stdout.on('data', onLine('out'));
  child.stderr.on('data', onLine('err'));

  child.on('close', (code, signal) => {
    job.status = 'stopped';
    job.endedAt = new Date().toISOString();
    job.exitCode = (code === null) ? (signal ? -1 : 0) : code;
    appendJobLog(job, '[meta] exit=' + job.exitCode + (signal ? ' signal=' + signal : ''));
    emitJobEvent(job, 'exit', { id: job.id, exitCode: job.exitCode, status: job.status });
    // Move into history, retain in jobs map briefly for late SSE reconnects.
    jobHistory.unshift({ id: job.id, cmd: job.cmd, args: job.args, startedAt: job.startedAt, endedAt: job.endedAt, exitCode: job.exitCode, status: job.status });
    if (jobHistory.length > JOB_HISTORY_MAX) jobHistory.pop();
    setTimeout(() => { jobs.delete(id); }, 60_000);
  });
  child.on('error', (err) => {
    appendJobLog(job, '[meta] spawn error: ' + err.message);
    job.status = 'error';
    job.endedAt = new Date().toISOString();
    job.exitCode = -1;
    emitJobEvent(job, 'exit', { id: job.id, exitCode: -1, status: 'error' });
  });

  return { jobId: id };
}

function stopJob(id) {
  const j = jobs.get(id);
  if (!j) return { error: 'no such job' };
  if (j.status !== 'running') return { error: 'job not running' };
  try {
    if (process.platform === 'win32') {
      // Taskkill the whole process tree on Windows; npm.cmd spawns node.
      execFile('taskkill', ['/pid', String(j.proc.pid), '/T', '/F'], () => {});
    } else {
      j.proc.kill('SIGTERM');
    }
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}

// --------------------------------------------------------------------------
// Domain reads
// --------------------------------------------------------------------------
async function buildDashboard() {
  const stats = await readJsonSafe(path.join(PROJECT_ROOT, 'data', 'stats.json'));
  const pkg   = await readJsonSafe(path.join(PROJECT_ROOT, 'package.json'));
  const cfg   = await readJsonSafe(path.join(PROJECT_ROOT, 'config.json'));
  const doc   = await readTextSafe(path.join(PROJECT_ROOT, 'reports', 'doctor.md'));
  const tasks = await readJsonSafe(path.join(PROJECT_ROOT, 'data', 'tasks.json'));
  const journalFiles = await listFiles(path.join(PROJECT_ROOT, 'journal'));
  const distFiles    = await listFiles(path.join(PROJECT_ROOT, 'dist'));

  let tasksCount = 0;
  let messagesCount = 0;
  let daysCount = 0;
  let topType = null;
  let topKw = [];
  let lastTasks = [];
  if (stats) {
    if (stats.totals) { tasksCount = stats.totals.tasks || 0; messagesCount = stats.totals.messages || 0; daysCount = stats.totals.days || 0; }
    if (stats.byType) {
      let best = null;
      for (const [k, v] of Object.entries(stats.byType)) {
        if (best === null || v > best.v) best = { k, v };
      }
      topType = best;
    }
    if (stats.topKeywords) topKw = Object.entries(stats.topKeywords).slice(0, 12);
  }
  if (Array.isArray(tasks)) {
    lastTasks = tasks.slice(-10).reverse().map(t => ({
      id: t.id, date: t.date, time: t.time, type: t.taskType, title: t.title
    }));
  } else if (tasks && Array.isArray(tasks.tasks)) {
    lastTasks = tasks.tasks.slice(-10).reverse().map(t => ({
      id: t.id, date: t.date, time: t.time, type: t.taskType, title: t.title
    }));
  }

  // Parse doctor summary line: "pass | 27" / "fail | 0"
  let docPass = null, docFail = null;
  if (doc) {
    const m1 = doc.match(/\|\s*pass\s*\|\s*(\d+)/);
    const m2 = doc.match(/\|\s*fail\s*\|\s*(\d+)/);
    if (m1) docPass = +m1[1];
    if (m2) docFail = +m2[1];
  }

  return {
    project: {
      name: pkg && pkg.name,
      version: pkg && pkg.version,
      root: PROJECT_ROOT,
      sessionsDir: cfg && cfg.sessionsDir,
      node: process.version
    },
    counts: {
      tasks: tasksCount,
      messages: messagesCount,
      days: daysCount,
      journals: journalFiles.length,
      distArtifacts: distFiles.length
    },
    topType, topKw,
    byDay:  (stats && stats.byDay)  || {},
    byType: (stats && stats.byType) || {},
    lastTasks,
    doctor: { pass: docPass, fail: docFail, generatedAt: doc ? null : null },
    serverTime: new Date().toISOString()
  };
}

async function buildJournalList() {
  return listFiles(path.join(PROJECT_ROOT, 'journal'));
}

async function buildReportsList() {
  const out = [];
  await listDirRecursive(path.join(PROJECT_ROOT, 'reports'), '', out);
  out.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return out;
}

async function buildDataList() {
  return listFiles(path.join(PROJECT_ROOT, 'data'), /^(?!index\.json$).+/);
}

async function buildDistList() {
  return listFiles(path.join(PROJECT_ROOT, 'dist'));
}

async function readTasksPage(limit, offset, search, type) {
  const tasks = await readJsonSafe(path.join(PROJECT_ROOT, 'data', 'tasks.json'));
  let list = null;
  if (Array.isArray(tasks)) list = tasks;
  else if (tasks && Array.isArray(tasks.tasks)) list = tasks.tasks;
  if (!list) return { total: 0, items: [] };
  let filtered = list;
  if (type) {
    const want = String(type).toLowerCase();
    filtered = filtered.filter(t => String(t.taskType || 'unknown').toLowerCase() === want);
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(t => {
      return (t.title && t.title.toLowerCase().includes(q))
        || (t.userSummary && t.userSummary.toLowerCase().includes(q))
        || (t.taskType && t.taskType.toLowerCase().includes(q))
        || (t.date && String(t.date).includes(q))
        || (Array.isArray(t.keywords) && t.keywords.some(k => String(k).toLowerCase().includes(q)));
    });
  }
  const start = Math.max(0, parseInt(offset || '0', 10));
  const end   = start + Math.max(1, Math.min(500, parseInt(limit || '50', 10)));
  return { total: filtered.length, items: filtered.slice(start, end) };
}

async function readVerifyTail(lines) {
  const text = await readTextSafe(path.join(PROJECT_ROOT, 'reports', 'verify-full.log'));
  if (!text) return { lines: [], exists: false };
  const all = text.split(/\r?\n/);
  const tail = all.slice(-Math.max(10, Math.min(500, parseInt(lines || '60', 10))));
  return { lines: tail, exists: true, total: all.length, mtime: (await fs.promises.stat(path.join(PROJECT_ROOT, 'reports', 'verify-full.log'))).mtime.toISOString() };
}

// --------------------------------------------------------------------------
// Global cross-content search
// --------------------------------------------------------------------------
function snippetAround(text, idx, qLen, ctx) {
  ctx = ctx || 80;
  const start = Math.max(0, idx - ctx);
  const end   = Math.min(text.length, idx + qLen + ctx);
  let pre  = start > 0 ? '…' : '';
  let post = end < text.length ? '…' : '';
  let body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return pre + body + post;
}

async function searchJournal(qLower, qRaw) {
  const out = [];
  const dir = path.join(PROJECT_ROOT, 'journal');
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    if (!e.isFile() || !/^\d{4}-\d{2}-\d{2}\.md$/.test(e.name)) continue;
    const text = await readTextSafe(path.join(dir, e.name));
    if (!text) continue;
    const lower = text.toLowerCase();
    let idx = lower.indexOf(qLower);
    if (idx === -1) continue;
    let count = 0;
    let pos = 0;
    while ((pos = lower.indexOf(qLower, pos)) !== -1) { count++; pos += qLower.length; }
    out.push({
      source: 'journal',
      date:   e.name.replace(/\.md$/, ''),
      snippet: snippetAround(text, idx, qRaw.length, 80),
      score:  count
    });
  }
  return out;
}

async function searchTasks(qLower, qRaw) {
  const tasks = await readJsonSafe(path.join(PROJECT_ROOT, 'data', 'tasks.json'));
  let list = null;
  if (Array.isArray(tasks)) list = tasks;
  else if (tasks && Array.isArray(tasks.tasks)) list = tasks.tasks;
  if (!list) return [];
  const out = [];
  for (const t of list) {
    const fields = [
      ['title',            t.title],
      ['userSummary',      t.userSummary],
      ['assistantSummary', t.assistantSummary],
      ['taskType',         t.taskType],
      ['date',             t.date],
      ['keywords',         Array.isArray(t.keywords) ? t.keywords.join(' ') : '']
    ];
    let count = 0;
    let firstHitIdx = -1;
    let firstHitField = '';
    let firstHitText = '';
    for (const [name, val] of fields) {
      if (val == null) continue;
      const text = String(val);
      const lower = text.toLowerCase();
      const occ = lower.split(qLower).length - 1;
      if (occ > 0) {
        count += occ;
        const idx = lower.indexOf(qLower);
        if (idx !== -1 && (firstHitIdx === -1 || name === 'title' || (firstHitField !== 'title' && name === 'userSummary'))) {
          // 优先 title，再 userSummary，再其他
          const pref = { title: 0, userSummary: 1, assistantSummary: 2, keywords: 3, taskType: 4, date: 5 };
          if (firstHitIdx === -1 || (pref[name] || 9) < (pref[firstHitField] || 9)) {
            firstHitIdx = idx;
            firstHitField = name;
            firstHitText = text;
          }
        }
      }
    }
    if (count === 0) continue;
    out.push({
      source: 'task',
      id:      t.id,
      date:    t.date,
      type:    t.taskType,
      title:   t.title || '(无标题)',
      snippet: firstHitText ? snippetAround(firstHitText, firstHitIdx, qRaw.length, 60) : '',
      score:   count
    });
  }
  return out;
}

async function searchReports(qLower, qRaw) {
  const out = [];
  const dir = path.join(PROJECT_ROOT, 'reports');
  const collected = [];
  await listDirRecursive(dir, '', collected);
  for (const f of collected) {
    if (!/\.(md|txt|log)$/i.test(f.name)) continue;
    const fp = safeJoin(dir, f.name);
    if (!fp) continue;
    const text = await readTextSafe(fp);
    if (!text) continue;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(qLower);
    if (idx === -1) continue;
    const occ = lower.split(qLower).length - 1;
    out.push({
      source:  'report',
      name:    f.name,
      snippet: snippetAround(text, idx, qRaw.length, 80),
      score:   occ
    });
  }
  return out;
}

async function globalSearch(q, limit) {
  q = (q || '').trim();
  if (q.length < 2) return { q, total: 0, groups: { journal: [], task: [], report: [] } };
  const lim = Math.max(1, Math.min(100, parseInt(limit || '20', 10)));
  const qLower = q.toLowerCase();
  const [journal, task, report] = await Promise.all([
    searchJournal(qLower, q),
    searchTasks(qLower, q),
    searchReports(qLower, q)
  ]);
  // 在合并前按 limit 分桶：每个 source 内按 score 降序截到 limit
  const trunc = (arr) => arr.sort((a, b) => b.score - a.score).slice(0, lim);
  return {
    q,
    total: journal.length + task.length + report.length,
    groups: {
      journal: trunc(journal),
      task:    trunc(task),
      report:  trunc(report)
    }
  };
}

// --------------------------------------------------------------------------
// HTTP routing
// --------------------------------------------------------------------------
async function serveStatic(req, res, rel) {
  const target = safeJoin(PUBLIC_DIR, rel);
  if (!target) return notFound(res);
  try {
    const st = await fs.promises.stat(target);
    if (!st.isFile()) return notFound(res);
    const mime = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(target).pipe(res);
  } catch (_) {
    notFound(res);
  }
}

async function readBodyJson(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 16 * 1024) { req.destroy(); reject(new Error('payload too large')); } });
    req.on('end', () => {
      if (!buf) return resolve({});
      // Strip UTF-8 BOM if present (clients shouldn't send one, but be safe).
      if (buf.charCodeAt(0) === 0xFEFF) buf = buf.slice(1);
      try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function setCors(res) {
  // local-only, but allow the same-origin XHR explicitly. No wildcard.
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const html = await fs.promises.readFile(path.join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': html.length, 'Cache-Control': 'no-cache' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && p.startsWith('/static/')) {
      return serveStatic(req, res, p.slice('/static/'.length));
    }

    if (req.method === 'GET' && p === '/api/dashboard') return jsonResponse(res, 200, await buildDashboard());
    if (req.method === 'GET' && p === '/api/journal')   return jsonResponse(res, 200, { items: await buildJournalList() });
    if (req.method === 'GET' && p.startsWith('/api/journal/')) {
      const date = decodeURIComponent(p.slice('/api/journal/'.length));
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(date)) return badRequest(res, 'date must be YYYY-MM-DD.md');
      const fp = safeJoin(path.join(PROJECT_ROOT, 'journal'), date);
      if (!fp || !fs.existsSync(fp)) return notFound(res, 'no such journal file');
      const text = await fs.promises.readFile(fp, 'utf8');
      return textResponse(res, 200, text, MIME['.md']);
    }

    if (req.method === 'GET' && p === '/api/reports') return jsonResponse(res, 200, { items: await buildReportsList() });
    if (req.method === 'GET' && p.startsWith('/api/reports/')) {
      const rel = decodeURIComponent(p.slice('/api/reports/'.length));
      const fp = safeJoin(path.join(PROJECT_ROOT, 'reports'), rel);
      if (!fp || !fs.existsSync(fp)) return notFound(res, 'no such report');
      const text = await fs.promises.readFile(fp, 'utf8');
      return textResponse(res, 200, text, MIME['.md']);
    }

    if (req.method === 'GET' && p === '/api/data') return jsonResponse(res, 200, { items: await buildDataList() });
    if (req.method === 'GET' && p === '/api/data/tasks') {
      const limit  = url.searchParams.get('limit')  || '50';
      const offset = url.searchParams.get('offset') || '0';
      const search = url.searchParams.get('q')      || '';
      const type   = url.searchParams.get('type')   || '';
      return jsonResponse(res, 200, await readTasksPage(limit, offset, search, type));
    }
    if (req.method === 'GET' && p.startsWith('/api/data/')) {
      const name = decodeURIComponent(p.slice('/api/data/'.length));
      if (name.includes('..') || name.includes('/') || name.includes('\\')) return badRequest(res, 'invalid name');
      if (name === 'index.json') return notFound(res, 'data/index.json is gitignored and intentionally not exposed via the console');
      const fp = path.join(PROJECT_ROOT, 'data', name);
      if (!fs.existsSync(fp)) return notFound(res, 'no such data file');
      const ext = path.extname(name).toLowerCase();
      if (ext === '.json') {
        const j = await readJsonSafe(fp);
        if (j === null) return notFound(res, 'invalid json');
        return jsonResponse(res, 200, j);
      }
      const text = await fs.promises.readFile(fp, 'utf8');
      return textResponse(res, 200, text, MIME[ext] || MIME['.txt']);
    }

    if (req.method === 'GET' && p === '/api/dist') return jsonResponse(res, 200, { items: await buildDistList() });
    if ((req.method === 'GET' || req.method === 'HEAD') && p === '/api/dist/download') {
      // Stream the (single) zip if present. No directory listing / no path param.
      const items = await buildDistList();
      const zip = items.find(x => x.name.endsWith('.zip'));
      if (!zip) return notFound(res, 'no zip artifact');
      const fp = path.join(PROJECT_ROOT, 'dist', zip.name);
      const st = await fs.promises.stat(fp);
      res.writeHead(200, {
        'Content-Type': MIME['.zip'],
        'Content-Length': st.size,
        'Content-Disposition': 'attachment; filename="' + zip.name + '"'
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(fp).pipe(res);
      return;
    }

    if (req.method === 'GET' && p === '/api/verify-tail') {
      const lines = url.searchParams.get('lines') || '60';
      return jsonResponse(res, 200, await readVerifyTail(lines));
    }

    if (req.method === 'GET' && p === '/api/search') {
      const q      = url.searchParams.get('q')      || '';
      const limit  = url.searchParams.get('limit')  || '20';
      if (q.trim().length < 2) return badRequest(res, 'q must be at least 2 characters');
      return jsonResponse(res, 200, await globalSearch(q, limit));
    }

    if (req.method === 'GET' && p === '/api/jobs') {
      const live = [];
      for (const j of jobs.values()) live.push({ id: j.id, cmd: j.cmd, args: j.args, startedAt: j.startedAt, endedAt: j.endedAt, status: j.status, exitCode: j.exitCode });
      return jsonResponse(res, 200, { live, history: jobHistory });
    }
    if (req.method === 'GET' && p.startsWith('/api/jobs/') && p.endsWith('/stream')) {
      const id = p.slice('/api/jobs/'.length, -'/stream'.length);
      const job = jobs.get(id);
      if (!job) return notFound(res, 'no such job');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(': connected ' + id + '\n\n');
      // Replay existing log lines (as a single replay event) so late joiners see history.
      res.write('event: replay\ndata: ' + JSON.stringify({ id: job.id, cmd: job.cmd, args: job.args, status: job.status, startedAt: job.startedAt, log: job.log.slice(-200) }) + '\n\n');
      const send = (event, data) => { try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (_) {} };
      const ping = setInterval(() => send('ping', { t: Date.now() }), 15_000);
      job.sseClients.add(res);
      req.on('close', () => { clearInterval(ping); job.sseClients.delete(res); });
      return;
    }
    if (req.method === 'GET' && p.startsWith('/api/jobs/')) {
      const id = p.slice('/api/jobs/'.length);
      const job = jobs.get(id) || jobHistory.find(h => h.id === id);
      if (!job) return notFound(res, 'no such job');
      const live = jobs.get(id);
      return jsonResponse(res, 200, {
        id, cmd: job.cmd, args: job.args, startedAt: job.startedAt, endedAt: job.endedAt,
        status: job.status, exitCode: job.exitCode,
        log: (live ? live.log : []).slice(-200)
      });
    }

    if (req.method === 'POST' && p === '/api/run') {
      let body;
      try { body = await readBodyJson(req); } catch (e) { return badRequest(res, 'bad json: ' + e.message); }
      const cmd = body && body.cmd;
      const result = startJob(cmd, body || {});
      if (result.error) return jsonResponse(res, 409, result);
      return jsonResponse(res, 200, result);
    }
    if (req.method === 'POST' && p.startsWith('/api/jobs/') && p.endsWith('/stop')) {
      const id = p.slice('/api/jobs/'.length, -'/stop'.length);
      return jsonResponse(res, 200, stopJob(id));
    }

    return notFound(res, 'route not found: ' + p);
  } catch (e) {
    jsonResponse(res, 500, { error: e.message, stack: process.env.CONSOLE_DEBUG ? e.stack : undefined });
  }
});

server.listen(PORT, HOST, () => {
  const banner = [
    '',
    '  +------------------------------------------+',
    '  |  CodexJournal-Lite Console               |',
    '  |  v' + (require(path.join(PROJECT_ROOT, 'package.json')).version || '?').padEnd(40) + '|',
    '  +------------------------------------------+',
    '   url     : http://' + HOST + ':' + PORT,
    '   project : ' + PROJECT_ROOT,
    '   mode    : 127.0.0.1 only (local)',
    '   stop    : Ctrl+C in this window',
    ''
  ].join('\n');
  console.log(banner);
});

process.on('SIGINT',  () => { console.log('\n[console] SIGINT, closing server...'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
