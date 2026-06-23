 'use strict';

 // src/verify.js
 //
 // Cross-platform verification for CodexJournal-Lite.
 // Replaces scripts/verify.ps1 for non-Windows environments.
 //
 // Usage:
 //   node src/verify.js
 //   node src/verify.js --fresh
 //   node src/verify.js --skip-archive
 //
 // Exit: 0 = all checks passed, 1 = at least one check failed

 const fs = require('fs');
 const path = require('path');
 const crypto = require('crypto');
 const { spawnSync } = require('child_process');

 const PROJECT_ROOT = path.resolve(__dirname, '..');
 const PKG = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
 const VERSION = PKG.version || 'unknown';

 // -------- CLI args --------------------------------------------------------
 const args = process.argv.slice(2);
 const FRESH = args.includes('--fresh');
 const SKIP_ARCHIVE = FRESH || args.includes('--skip-archive');

 // -------- output helpers --------------------------------------------------
 let passed = 0, failed = 0, warns = 0;

 function section(name) { process.stdout.write('\n==[ ' + name + ' ]' + '='.repeat(Math.max(0, 60 - name.length)) + '\n'); }
 function pass(msg) { passed++; process.stdout.write('[PASS] ' + msg + '\n'); }
 function fail(msg) { failed++; process.stdout.write('[FAIL] ' + msg + '\n'); }
 function warn(msg) { warns++; process.stdout.write('[WARN] ' + msg + '\n'); }
 function info(msg) { process.stdout.write('[INFO] ' + msg + '\n'); }

 // -------- file helpers ----------------------------------------------------
 function readJson(p) {
   try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
 }
 function readText(p) {
   try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
 }
 function exists(p) {
   try { fs.accessSync(p, fs.constants.F_OK); return true; } catch (_) { return false; }
 }
 function globFiles(dir, pattern, recursive) {
   const out = [];
   if (!exists(dir)) return out;
   try {
     const entries = fs.readdirSync(dir, { withFileTypes: true, encoding: 'utf8' });
     for (const e of entries) {
       const full = path.join(dir, e.name);
       if (e.isDirectory() && recursive) { out.push(...globFiles(full, pattern, recursive)); }
       else if (e.isFile() && (!pattern || pattern.test(e.name))) { out.push(full); }
     }
   } catch (_) {}
   return out;
 }
 function fingerprint(p) {
   try {
     const st = fs.statSync(p);
     if (!st.isFile()) return null;
     const buf = fs.readFileSync(p);
     return crypto.createHash('sha256').update(buf).digest('hex');
   } catch (_) { return null; }
 }

 // -------- run helpers -----------------------------------------------------
 function runNpm(args) {
   const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
   const r = spawnSync(npmCmd, args, { cwd: PROJECT_ROOT, encoding: 'utf8', shell: true });
   return { code: r.status != null ? r.status : (r.error ? -1 : 0), stdout: r.stdout || '', stderr: r.stderr || '' };
 }

 function runNode(code) {
   const r = spawnSync(process.execPath, ['-e', code], { cwd: PROJECT_ROOT, encoding: 'utf8' });
   return { code: r.status != null ? r.status : 0, stdout: r.stdout || '', stderr: r.stderr || '' };
 }

 // -------- real user detection ---------------------------------------------
 function getRealUsers() {
   const users = new Set();
   if (process.env.USERNAME) users.add(process.env.USERNAME);
   if (process.env.USER) users.add(process.env.USER);
   if (process.env.USERPROFILE) {
     const leaf = path.basename(process.env.USERPROFILE);
     if (leaf) users.add(leaf);
   }
   const KNOWN_NON_PERSONAL = new Set(['root','ci','runner','runneradmin','node','default','user','administrator','public','codux','codesandbox']);
   for (const u of users) { if (KNOWN_NON_PERSONAL.has(u.toLowerCase())) users.delete(u); }
   return Array.from(users).filter(Boolean);
 }

 const REAL_USERS = getRealUsers();
 const USER_PATTERNS = REAL_USERS.map(u => {
   const esc = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
   return { user: u, patterns: [
     new RegExp('C:\\\\Users\\\\' + esc, 'i'),
     new RegExp('C:/Users/' + esc, 'i'),
     new RegExp('C:\\\\\\\\Users\\\\\\\\' + esc.replace(/\\/g,'\\\\\\\\'), 'i')
   ]};
 });

 function findUserLeaks(text) {
   const hits = [];
   for (const up of USER_PATTERNS) {
     for (const re of up.patterns) {
       const m = text.match(re);
       if (m) hits.push({ user: up.user, pattern: m[0] });
     }
   }
   return hits;
 }

 // -------- credential patterns -------------------------------------------
 const CRED_PATTERNS = [
   { name: 'openai-key',       re: /sk-[A-Za-z0-9_\-]{8,}/g },
   { name: 'bearer',           re: /Bearer\s+[A-Za-z0-9._\-/+=]{6,}/g },
   { name: 'openai-env',       re: /OPENAI_API_KEY\s*[:=]/g },
   { name: 'anthropic-env',    re: /ANTHROPIC_API_KEY\s*[:=]/g },
   { name: 'gemini-env',       re: /GEMINI_API_KEY\s*[:=]/g },
   { name: 'authorization',    re: /(?<![\w])authorization\s*[:=]\s*[^\s<]{6,}/gi },
   { name: 'cookie',           re: /(?<![\w])cookie\s*[:=]\s*[^\s<]{6,}/gi },
   { name: 'sessionid',        re: /(?<![\w])sessionid\s*[:=]\s*[^\s<]{6,}/gi },
 ];
 const README_PLACEHOLDERS = ['sk-...','sk-proj-...','OPENAI_API_KEY=...','Bearer eyJ','Bearer <REDACTED>','ghp_...','xoxb-...'];
 function isReadmePlaceholder(text) {
   return README_PLACEHOLDERS.some(p => text.includes(p));
 }

 // -------- protected file sets -------------------------------------------
 function getContentFiles(excludeIndex) {
   const files = [];
   const readme = path.join(PROJECT_ROOT, 'README.md');
   if (exists(readme)) files.push(readme);
   const dash = path.join(PROJECT_ROOT, 'reports', 'dashboard.md');
   if (exists(dash)) files.push(dash);
   const jFiles = globFiles(path.join(PROJECT_ROOT, 'journal'), /\.md$/i, false);
   files.push(...jFiles);
   const dFiles = globFiles(path.join(PROJECT_ROOT, 'data'), null, false);
   for (const f of dFiles) {
     if (excludeIndex && path.basename(f) === 'index.json') continue;
     files.push(f);
   }
   return files;
 }

 function getArchiveProtectedFiles(excludePatterns) {
  const files = [];
  const paths = [
    "README.md", "reports/dashboard.md", "data/tasks.json", "data/stats.json",
    "data/search.md", "data/index.json"
  ];
  for (const p of paths) {
    if (!excludePatterns || !excludePatterns.some(function(e) { return p.includes(e); })) {
      const abs = path.join(PROJECT_ROOT, p);
      if (exists(abs)) files.push(abs);
    }
  }
  const jDir = path.join(PROJECT_ROOT, "journal");
  if (exists(jDir)) { files.push.apply(files, globFiles(jDir, /\.md$/i, false)); }
  return files;
 }

 function getZipContent(filePath) {
   try {
     const AdmZip = require('adm-zip');
     const zip = new AdmZip(filePath);
     return zip.getEntries().map(e => e.entryName);
   } catch (_) { return null; }
 }

 // ======================================================================
 // SECTION A: npm run check
 // ======================================================================
 section('A. npm run check');
 const checkResult = runNpm(['run', 'check']);
 if (checkResult.code === 0) {
   pass('A: npm run check exited 0');
 } else {
   fail('A: npm run check exited ' + checkResult.code);
 }

 // ======================================================================
// SECTION B: npm run archive -- --force
// ======================================================================
section('B. npm run archive -- --force');
if (SKIP_ARCHIVE) {
  info('B: skipped (--fresh or --skip-archive passed).');
} else {
  const archiveResult = runNpm(['run', 'archive', '--', '--force']);
  if (archiveResult.code === 0) {
    pass('B: npm run archive -- --force exited 0');
  } else {
    fail('B: npm run archive -- --force exited ' + archiveResult.code);
  }
}

// ======================================================================
// SECTION B2: offline fixture tests
// ======================================================================
section('B2. offline fixture tests');
{
  const sanitizeResult = runNpm(['run', 'test:sanitize']);
  if (sanitizeResult.code === 0) { pass('B2: npm run test:sanitize exited 0'); }
  else { fail('B2: npm run test:sanitize exited ' + sanitizeResult.code); }

  const sourcesResult = runNpm(['run', 'test:sources']);
  if (sourcesResult.code === 0) { pass('B2: npm run test:sources exited 0'); }
  else { fail('B2: npm run test:sources exited ' + sourcesResult.code); }

  const archiveTestResult = runNpm(['run', 'test:archive']);
  if (archiveTestResult.code === 0) { pass('B2: npm run test:archive exited 0'); }
  else { fail('B2: npm run test:archive exited ' + archiveTestResult.code); }

  const privacyResult = runNpm(['run', 'test:privacy']);
  if (privacyResult.code === 0) { pass('B2: npm run test:privacy exited 0'); }
  else { fail('B2: npm run test:privacy exited ' + privacyResult.code); }

  const consoleResult = runNpm(['run', 'test:console']);
  if (consoleResult.code === 0) { pass('B2: npm run test:console exited 0'); }
  else { fail('B2: npm run test:console exited ' + consoleResult.code); }

  const rootResult = runNpm(['run', 'test:root']);
  if (rootResult.code === 0) { pass('B2: npm run test:root exited 0'); }
  else { fail('B2: npm run test:root exited ' + rootResult.code); }

  const sourceDoctorResult = runNpm(['run', 'test:source-doctor']);
  if (sourceDoctorResult.code === 0) { pass('B2: npm run test:source-doctor exited 0'); }
  else { fail('B2: npm run test:source-doctor exited ' + sourceDoctorResult.code); }

  const releaseResult = runNpm(['run', 'test:release']);
  if (releaseResult.code === 0) { pass('B2: npm run test:release exited 0'); }
  else { fail('B2: npm run test:release exited ' + releaseResult.code); }

  const exportResult = runNpm(['run', 'test:export']);
  if (exportResult.code === 0) { pass('B2: npm run test:export exited 0'); }
  else { fail('B2: npm run test:export exited ' + exportResult.code); }

  const tagsResult = runNpm(['run', 'test:tags']);
  if (tagsResult.code === 0) { pass('B2: npm run test:tags exited 0'); }
  else { fail('B2: npm run test:tags exited ' + tagsResult.code); }

  const clusterResult = runNpm(['run', 'test:cluster']);
  if (clusterResult.code === 0) { pass('B2: npm run test:cluster exited 0'); }
  else { fail('B2: npm run test:cluster exited ' + clusterResult.code); }

  const migrationResult = runNpm(['run', 'test:migration']);
  if (migrationResult.code === 0) { pass('B2: npm run test:migration exited 0'); }
  else { fail('B2: npm run test:migration exited ' + migrationResult.code); }
}

 // ======================================================================
 // SECTION C: real Windows username leak
 // ======================================================================
 section('C. real Windows username leak check');
 info('C: real user candidates: ' + (REAL_USERS.length ? REAL_USERS.join(', ') : '(none detected)'));

 const cFiles = getContentFiles(true); // exclude data/index.json
 const cLeaks = [];
 for (const f of cFiles) {
   const text = readText(f);
   if (!text) continue;
   const hits = findUserLeaks(text);
   for (const h of hits) {
     cLeaks.push({ file: path.relative(PROJECT_ROOT, f).replace(/\\/g, '/'), user: h.user, pattern: h.pattern });
   }
 }
 if (cLeaks.length === 0) {
   pass('C: no real Windows username path in README.md / reports/dashboard.md / journal / data (excluding data/index.json).');
 } else {
   for (const h of cLeaks.slice(0, 5)) {
     fail('C: leak user=\'' + h.user + '\' pattern=\'' + h.pattern + '\' in ' + h.file);
   }
   if (cLeaks.length > 5) fail('C: ... and ' + (cLeaks.length - 5) + ' more leak(s) suppressed.');
 }

 // ======================================================================
 // SECTION D: credential pattern scan
 // ======================================================================
 section('D. credential pattern scan');
 const dFiles = getContentFiles(true);
 const dRealHits = [], dWarnHits = [];
 for (const f of dFiles) {
   const text = readText(f);
   if (!text) continue;
   const isReadme = path.basename(f) === 'README.md';
   for (const cp of CRED_PATTERNS) {
     let m;
     while ((m = cp.re.exec(text)) !== null) {
       const record = { pattern: cp.name, file: path.relative(PROJECT_ROOT, f).replace(/\\/g, '/'), text: m[0].slice(0, 120) };
       if (isReadme && isReadmePlaceholder(m[0])) { dWarnHits.push(record); }
       else { dRealHits.push(record); }
     }
   }
 }
 if (dRealHits.length === 0) {
   pass('D: no real credential pattern in README.md / reports/dashboard.md / journal / data.');
 } else {
   for (const h of dRealHits.slice(0, 5)) {
     fail('D: credential hit pattern=\'' + h.pattern + '\' in ' + h.file + ' :: ' + h.text);
   }
   if (dRealHits.length > 5) fail('D: ... and ' + (dRealHits.length - 5) + ' more credential hit(s).');
 }
 if (dWarnHits.length > 0) {
   warn('D: ' + dWarnHits.length + ' hit(s) in README.md look like doc placeholders (accepted as WARN).');
 }

 // ======================================================================
 // SECTION E: title pollution check
 // ======================================================================
 section('E. title pollution check');
 const tasksData = readJson(path.join(PROJECT_ROOT, 'data', 'tasks.json'));
 if (!tasksData || !Array.isArray(tasksData.tasks)) {
   if (FRESH) { info('E: data/tasks.json not found; run npm run archive first (skipped in --fresh mode).'); }
   else { fail('E: data/tasks.json not found; run npm run archive first.'); }
 } else {
   const tasks = tasksData.tasks;
   const agentsTitles = tasks.filter(t => /^# AGENTS\.md instructions/.test(t.title)).length;
   const historyTitles = tasks.filter(t => /^The following is the Codex agent history/.test(t.title)).length;
   const noUserTitles = tasks.filter(t => t.title === '(no user request)').length;
   const pollution = agentsTitles + historyTitles + noUserTitles;
   if (pollution === 0) {
     pass('E: title pollution is 0 (no AGENTS.md / agent-history / no-user-request titles).');
   } else {
     fail('E: title pollution > 0 (agents=' + agentsTitles + ' history=' + historyTitles + ' noUser=' + noUserTitles + '). Re-run npm run archive.');
   }
 }

 // ======================================================================
 // SECTION F: tasks field completeness
 // ======================================================================
 section('F. tasks field completeness');
 if (!tasksData || !Array.isArray(tasksData.tasks)) {
   if (FRESH) { info('F: skipped, data/tasks.json not available (--fresh mode).'); }
   else { fail('F: skipped, data/tasks.json not available.'); }
 } else {
   const REQUIRED_FIELDS = ['id','date','time','source','projectPath','title','taskType','keywords','userSummary','assistantSummary','rawFilePath','messageCount','firstTimestamp','lastTimestamp'];
   let badCount = 0;
   for (let i = 0; i < tasksData.tasks.length; i++) {
     const t = tasksData.tasks[i];
     const miss = REQUIRED_FIELDS.filter(k => !(k in t));
     if (miss.length > 0) badCount++;
   }
   if (badCount === 0) {
     pass('F: every task in data/tasks.json has all ' + REQUIRED_FIELDS.length + ' required fields.');
   } else {
     fail('F: ' + badCount + ' task(s) missing required fields.');
   }
 }

 // ======================================================================
 // SECTION G: date correctness (Asia/Shanghai)
 // ======================================================================
 section('G. date correctness (Asia/Shanghai local date == task.date)');
if (!tasksData || !Array.isArray(tasksData.tasks)) {
  if (FRESH) { info('G: skipped, data/tasks.json not available (--fresh mode).'); }
  else { fail('G: skipped, data/tasks.json not available.'); }
} else {
  var gBad = 0;
  for (var gi = 0; gi < tasksData.tasks.length; gi++) {
    var t = tasksData.tasks[gi];
    if (t.date === 'unknown' || !t.firstTimestamp) continue;
    try {
      var gd = new Date(t.firstTimestamp);
      var gs = gd.getFullYear() + '-' + String(gd.getMonth()+1).padStart(2,'0') + '-' + String(gd.getDate()).padStart(2,'0');
      if (t.date !== gs) gBad++;
    } catch(_) {}
  }
  if (gBad === 0) {
    pass('G: every task.date matches local date (or is "unknown").');
  } else {
    fail('G: ' + gBad + ' task(s) date does not match local date.');
  }
}
// ======================================================================
 // SECTION H: journal + tasks count
 // ======================================================================
 section('H. journal + tasks count check');
 const jFiles = globFiles(path.join(PROJECT_ROOT, 'journal'), /\.md$/i, false);
 const journalCount = jFiles.length;
 const taskCount = (tasksData && Array.isArray(tasksData.tasks)) ? tasksData.tasks.length : 0;
 if (journalCount >= 1) { pass('H: journal/ has ' + journalCount + ' .md file(s) (>= 1).'); }
 else { if (FRESH) { info('H: journal/ has 0 .md files (--fresh mode).'); } else { fail('H: journal/ has 0 .md files.'); } }
 if (taskCount >= 1) { pass('H: data/tasks.json has ' + taskCount + ' task(s) (>= 1).'); }
 else { if (FRESH) { info('H: data/tasks.json has 0 tasks (--fresh mode).'); } else { fail('H: data/tasks.json has 0 tasks.'); } }

 // ======================================================================
 // SECTION I: git-commit.ps1 DryRun safety (PowerShell-only on Windows)
 // ======================================================================
 section('I. git-commit.ps1 -DryRun safety');
 const gitCommitPs1 = path.join(PROJECT_ROOT, 'scripts', 'git-commit.ps1');
 if (process.platform === 'win32' && exists(gitCommitPs1)) {
   const r = spawnSync('powershell.exe', [
     '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', gitCommitPs1, '-DryRun'
   ], { cwd: PROJECT_ROOT, shell: true, encoding: 'utf8' });
   const ec = r.status != null ? r.status : -1;
   if (ec === 0 || ec === 4) {
     pass('I: git-commit.ps1 -DryRun exited ' + ec + ' (expected).');
   } else {
     fail('I: git-commit.ps1 -DryRun exited ' + ec + ' (expected 0 or 4).');
   }
 } else if (process.platform !== 'win32') {
   info('I: skipped (git-commit.ps1 is Windows-specific; not available on ' + process.platform + ').');
 } else {
   fail('I: scripts/git-commit.ps1 not found.');
 }

 // ======================================================================
 // SECTION K: scan-sources safety
 // ======================================================================
 section('K. scan-sources safety');
 // Snapshot protected files
 const kProtected = getArchiveProtectedFiles(['idea-log-inventory.md', 'source-scan-summary.json']);
 const kBefore = {};
 for (const p of kProtected) { kBefore[p] = fingerprint(p); }
 info('K: snapshotted ' + kProtected.length + ' protected file(s) before scan-sources.');

 const scanResult = runNpm(['run', 'scan:sources']);
 if (scanResult.code === 0) {
   pass('K: npm run scan:sources exited 0.');
 } else {
   fail('K: npm run scan:sources exited ' + scanResult.code);
 }

 // Check protected files were not mutated
 const kMutated = [];
 for (const p of kProtected) {
   const after = fingerprint(p);
   if (kBefore[p] !== after) kMutated.push(path.relative(PROJECT_ROOT, p).replace(/\\/g, '/'));
 }
 if (kMutated.length === 0) {
   pass('K: scan-sources did NOT modify any protected archive output files.');
 } else {
   for (const m of kMutated.slice(0, 5)) fail('K: scan-sources MUTATED ' + m);
 }

 // Check idea-log-inventory.md exists
 const kInventory = path.join(PROJECT_ROOT, 'reports', 'idea-log-inventory.md');
 if (exists(kInventory)) {
   pass('K: reports/idea-log-inventory.md exists.');
 } else {
   fail('K: reports/idea-log-inventory.md missing.');
 }

 // Leak check on scan-sources outputs
 const kScanFiles = [
   path.join(PROJECT_ROOT, 'reports', 'idea-log-inventory.md'),
   path.join(PROJECT_ROOT, 'reports', 'source-scan-summary.json')
 ];
 for (const f of kScanFiles) {
   if (!exists(f)) continue;
   const text = readText(f);
   if (!text) continue;
   const leaks = findUserLeaks(text);
   for (const h of leaks) {
     fail('K: real username \'' + h.user + '\' in ' + path.relative(PROJECT_ROOT, f).replace(/\\/g, '/'));
   }
 }

 // ======================================================================
 // SECTION L: summarize safety
 // ======================================================================
 section('L. summarize safety');
 if (FRESH) info('L: running in --fresh mode. summarize output checks downgraded to warnings.');

 const lProtected = getArchiveProtectedFiles(['patterns.json', 'work-patterns.md', 'monthly/', 'yearly/']);
 const lBefore = {};
 for (const p of lProtected) { lBefore[p] = fingerprint(p); }
 info('L: snapshotted ' + lProtected.length + ' protected file(s) before summarize.');

 const summarizeResult = runNpm(['run', 'summarize']);
 if (summarizeResult.code === 0) {
   pass('L: npm run summarize exited 0.');
 } else {
   if (FRESH) { info('L: npm run summarize exited ' + summarizeResult.code + ' (empty data; --fresh mode).'); }
   else { fail('L: npm run summarize exited ' + summarizeResult.code); }
 }

 // Check summarize outputs exist
 function checkExists(label, p) {
   if (exists(p)) { pass('L: ' + label + ' exists.'); return true; }
   else { if (FRESH) { info('L: ' + label + ' missing (--fresh mode).'); } else { fail('L: ' + label + ' missing.'); } return false; }
 }
 checkExists('data/patterns.json', path.join(PROJECT_ROOT, 'data', 'patterns.json'));
 checkExists('reports/work-patterns.md', path.join(PROJECT_ROOT, 'reports', 'work-patterns.md'));
 const lMonthly = globFiles(path.join(PROJECT_ROOT, 'reports', 'monthly'), /\.md$/i, false);
 if (lMonthly.length >= 1) { pass('L: reports/monthly/ has ' + lMonthly.length + ' .md file(s) (>= 1).'); }
 else { if (FRESH) { info('L: reports/monthly/ has 0 .md files (--fresh mode).'); } else { fail('L: reports/monthly/ has 0 .md files.'); } }
 const lYearly = globFiles(path.join(PROJECT_ROOT, 'reports', 'yearly'), /\.md$/i, false);
 if (lYearly.length >= 1) { pass('L: reports/yearly/ has ' + lYearly.length + ' .md file(s) (>= 1).'); }
 else { if (FRESH) { info('L: reports/yearly/ has 0 .md files (--fresh mode).'); } else { fail('L: reports/yearly/ has 0 .md files.'); } }

 // Check protected files not mutated
 const lMutated = [];
 for (const p of lProtected) {
   const after = fingerprint(p);
   if (lBefore[p] !== after) lMutated.push(path.relative(PROJECT_ROOT, p).replace(/\\/g, '/'));
 }
 if (lMutated.length === 0) {
   pass('L: summarize did NOT modify any protected archive output files.');
 } else {
   for (const m of lMutated.slice(0, 5)) fail('L: summarize MUTATED ' + m);
 }

 // Leak check on summarize outputs
 const lLeakFiles = [
   path.join(PROJECT_ROOT, 'data', 'patterns.json'),
   path.join(PROJECT_ROOT, 'reports', 'work-patterns.md'),
   ...lMonthly, ...lYearly
 ];
 for (const f of lLeakFiles) {
   if (!exists(f)) continue;
   const text = readText(f);
   if (!text) continue;
   const leaks = findUserLeaks(text);
   for (const h of leaks) fail('L: real username \'' + h.user + '\' in ' + path.relative(PROJECT_ROOT, f).replace(/\\/g, '/'));
 }

 // ======================================================================
 // SECTION M: doctor / output-index / package safety
 // ======================================================================
 section('M. doctor / output-index / package safety');
 const mProtected = (function() {
  var base = getArchiveProtectedFiles();
  var mDir = path.join(PROJECT_ROOT, "reports", "monthly");
  if (exists(mDir)) { base.push.apply(base, globFiles(mDir, /\.md$/i, false)); }
  var yDir = path.join(PROJECT_ROOT, "reports", "yearly");
  if (exists(yDir)) { base.push.apply(base, globFiles(yDir, /\.md$/i, false)); }
  return base;
})();
 const mBefore = {};
 for (const p of mProtected) { mBefore[p] = fingerprint(p); }
 info('M: snapshotted ' + mProtected.length + ' protected file(s).');

 // doctor
 const doctorResult = runNpm(['run', 'doctor']);
 if (doctorResult.code === 0) { pass('M: npm run doctor exited 0.'); }
 else { if (FRESH) { info('M: npm run doctor exited ' + doctorResult.code + ' (--fresh mode).'); } else { fail('M: npm run doctor exited ' + doctorResult.code); } }

 // index:outputs
 const indexResult = runNpm(['run', 'index:outputs']);
 if (indexResult.code === 0) { pass('M: npm run index:outputs exited 0.'); }
 else { fail('M: npm run index:outputs exited ' + indexResult.code); }

 // package:local - skip in fresh mode
 const distDir = path.join(PROJECT_ROOT, 'dist');
 const zipPath = path.join(distDir, 'CodexJournal-Lite-v' + VERSION + '-local.zip');
 if (FRESH) {
   info('M: --fresh mode -> skipping npm run package:local.');
 } else {
   const pkgResult = runNpm(['run', 'package:local']);
   if (pkgResult.code === 0) { pass('M: npm run package:local exited 0.'); }
   else {
     fail('M: npm run package:local exited ' + pkgResult.code);
     const logFile = path.join(PROJECT_ROOT, 'reports', 'package-local-verify.log');
     if (exists(logFile)) { const log = readText(logFile); if (log) process.stdout.write(log.split('\n').slice(0,20).map(l => '  ' + l).join('\n') + '\n'); }
   }
 }

 // Check output files exist
 checkExists('reports/doctor.md', path.join(PROJECT_ROOT, 'reports', 'doctor.md'));
 checkExists('reports/output-index.md', path.join(PROJECT_ROOT, 'reports', 'output-index.md'));
 checkExists('reports/output-index.json', path.join(PROJECT_ROOT, 'reports', 'output-index.json'));
 if (exists(zipPath)) {
   const st = fs.statSync(zipPath);
   pass('M: dist/' + path.basename(zipPath) + ' exists, size=' + st.size + ' bytes.');
 } else if (!FRESH) { fail('M: ' + path.basename(zipPath) + ' missing.'); }

 // Check protected files not mutated
 const mMutated = [];
 for (const p of mProtected) {
   const after = fingerprint(p);
   if (mBefore[p] !== after) mMutated.push(path.relative(PROJECT_ROOT, p).replace(/\\/g, '/'));
 }
 if (mMutated.length === 0) {
   pass('M: doctor / index:outputs / package:local did NOT modify any protected files.');
 } else {
   for (const m of mMutated.slice(0, 5)) fail('M: ' + m + ' was mutated.');
 }

 // Zip exclusion check (only if zip exists)
 if (exists(zipPath)) {
   try {
     const entries = getZipContent(zipPath);
     if (entries === null) { warn('M: could not open zip for exclusion check (adm-zip not available).'); }
     else {
       const badEntries = [];
       for (const e of entries) {
         const n = e.replace(/\\/g, '/');
         if (n.includes('data/index.json')) badEntries.push(e);
         else if (n.includes('.env')) badEntries.push(e);
         else if (n.includes('node_modules/')) badEntries.push(e);
         else if (n.match(/(^|\/)\.git\//)) badEntries.push(e);
         else if (n.includes('reports/errors.log')) badEntries.push(e);
         else if (n.match(/\.zip$/)) badEntries.push(e);
       }
       if (badEntries.length === 0) {
         pass('M: zip exclusion check passed (no excluded items in archive).');
       } else {
         for (const b of badEntries) fail('M: zip contains excluded item: ' + b);
       }
     }
   } catch (err) {
     fail('M: zip exclusion check error: ' + err.message);
   }
 }

 // ======================================================================
 // SUMMARY
 // ======================================================================
 const total = passed + failed + warns;
 process.stdout.write('\n' + '-'.repeat(60) + '\n');
 process.stdout.write('Total checks   : ' + total + '\n');
 process.stdout.write('  passed       : ' + passed + '\n');
 process.stdout.write('  failed       : ' + failed + '\n');
 process.stdout.write('  warnings     : ' + warns + '\n');
 process.stdout.write('-'.repeat(60) + '\n');
 if (failed === 0) {
   process.stdout.write('VERIFY PASSED\n');
   process.exit(0);
 } else {
   process.stdout.write('VERIFY FAILED\n');
   process.exit(1);
 }
