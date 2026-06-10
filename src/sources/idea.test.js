'use strict';

// src/sources/idea.test.js
//
// Offline test for the IDEA / JetBrains read-only probe. Uses the
// synthetic log tree under test-fixtures/idea-logs/ so that the test
// does NOT depend on any real JetBrains installation on the host.
//
// Run via: `npm run test:sources`
//
// Contract:
//   - exit 0 on success
//   - exit 1 on any failed assertion
//   - never touches the real Codex sessions dir
//   - never writes anywhere outside test-fixtures/ and stdout

const fs = require('fs');
const path = require('path');
const idea = require('./idea');

let passed = 0;
let failed = 0;
const failures = [];

function check(label, cond, detail) {
  if (cond) {
    passed += 1;
    process.stdout.write('  [PASS] ' + label + '\n');
  } else {
    failed += 1;
    failures.push({ label: label, detail: detail || '(no detail)' });
    process.stdout.write('  [FAIL] ' + label + (detail ? (' :: ' + detail) : '') + '\n');
  }
}

function section(name) {
  process.stdout.write('\n--- ' + name + ' ---\n');
}

const here = __dirname;
const projectRoot = path.resolve(here, '..', '..');
const fixtureRoot = path.resolve(projectRoot, 'test-fixtures', 'idea-logs', 'JetBrains');

section('fixture setup');
check('test-fixtures/idea-logs/JetBrains exists', fs.existsSync(fixtureRoot),
  'expected ' + fixtureRoot + ' to exist; run from the project root');
check('project root resolves to a real directory', fs.existsSync(projectRoot),
  'expected ' + projectRoot);

// Synthetic config: point idea-ai.logDirs at the fixture tree. The
// scanner should then find the canonical log sub-directory layout
// (PyCharm2025.3/log) and report exactly the 3 fixtures we wrote.
const cfg = {
  sources: [
    {
      name: 'idea-ai',
      type: 'idea',
      enabled: true,
      logDirs: [fixtureRoot]
    }
  ]
};

section('scan fixture tree');
const result = idea.scan(cfg);

check('scan returned a result object', result && typeof result === 'object');
check('result.source = "idea-ai"', result.source === 'idea-ai', JSON.stringify(result.source));
check('result.scannedAt is a valid ISO string', typeof result.scannedAt === 'string' && !isNaN(Date.parse(result.scannedAt)),
  'scannedAt=' + result.scannedAt);
check('result.thresholds present', result.thresholds && result.thresholds.maxFileBytes > 0);

check('result.candidateFiles.length >= 3', result.candidateFiles.length >= 3,
  'candidateFiles=' + result.candidateFiles.length);
check('result.likelyAiFiles.length >= 2', result.likelyAiFiles.length >= 2,
  'likelyAiFiles=' + result.likelyAiFiles.length);
check('result.skippedLargeFiles.length == 0', result.skippedLargeFiles.length === 0,
  'skippedLargeFiles=' + result.skippedLargeFiles.length);

// v0.4.1 split: roots vs log-dirs vs files.
check('result.searchedRoots includes the fixture root',
  Array.isArray(result.searchedRoots) && result.searchedRoots.length >= 1,
  'searchedRoots.length=' + (result.searchedRoots ? result.searchedRoots.length : 'undef'));
check('result.existingRoots contains the fixture root',
  Array.isArray(result.existingRoots) && result.existingRoots.indexOf(fixtureRoot) >= 0,
  'existingRoots=' + JSON.stringify(result.existingRoots));
check('result.discoveredLogDirs has at least one entry',
  Array.isArray(result.discoveredLogDirs) && result.discoveredLogDirs.length >= 1,
  'discoveredLogDirs=' + JSON.stringify(result.discoveredLogDirs));
check('result.discoveredLogDirs is a subset of fixture candidates',
  result.discoveredLogDirs.some((d) => d.indexOf('PyCharm20253') >= 0 || d.indexOf('PyCharm2025.3') >= 0 || d.indexOf('PyCharm') >= 0),
  'discoveredLogDirs=' + JSON.stringify(result.discoveredLogDirs));
check('result.existingRootsWithoutLogDirs is an array',
  Array.isArray(result.existingRootsWithoutLogDirs),
  'existingRootsWithoutLogDirs type=' + typeof result.existingRootsWithoutLogDirs);
check('result.summary.rootsExisting >= 1', result.summary && result.summary.rootsExisting >= 1,
  'summary.rootsExisting=' + (result.summary ? result.summary.rootsExisting : 'undef'));
check('result.summary.logDirsDiscovered >= 1', result.summary && result.summary.logDirsDiscovered >= 1,
  'summary.logDirsDiscovered=' + (result.summary ? result.summary.logDirsDiscovered : 'undef'));
check('result.summary.filesLikelyAi >= 2', result.summary && result.summary.filesLikelyAi >= 2,
  'summary.filesLikelyAi=' + (result.summary ? result.summary.filesLikelyAi : 'undef'));

section('per-file records');

// Per-file invariants. The fixture contributes exactly 3 files; the
// host may contribute more if a real JetBrains installation happens to
// exist. We restrict the per-file checks to the 3 fixture files so the
// test is portable across machines. The filter matches the fixture's
// unique path segment (`test-fixtures/idea-logs/`) so it does not
// accidentally pick up real `idea.log` files elsewhere on disk.
const fixturePathMarker = 'test-fixtures' + path.sep + 'idea-logs' + path.sep;
const fixtureFiles = result.candidateFiles.filter((f) => f.path.indexOf(fixturePathMarker) >= 0);
check('every fixture file is present in candidateFiles', fixtureFiles.length === 3,
  'fixtureFiles count=' + fixtureFiles.length + ' (paths: ' + fixtureFiles.map((f) => f.path).join(' | ') + ')');
check('every fixture file has a non-empty previewLines',
  fixtureFiles.every((f) => typeof f.previewLines === 'string' && f.previewLines.length > 0),
  'fixtureFiles with empty preview: ' + fixtureFiles.filter((f) => !(f.previewLines && f.previewLines.length > 0)).map((f) => f.path).join(' | '));
check('every fixture file has an ext in [.log,.txt,.json,.jsonl]',
  fixtureFiles.every((f) => ['.log', '.txt', '.json', '.jsonl'].indexOf(f.ext) >= 0));
check('likelyAi sample contains the fixture "ai-assistant.log"',
  result.likelyAiFiles.some((f) => f.path.indexOf(fixturePathMarker) >= 0 && f.path.indexOf('ai-assistant.log') >= 0),
  'likelyAi fixture match: ' + JSON.stringify(result.likelyAiFiles.filter((f) => f.path.indexOf(fixturePathMarker) >= 0).map((f) => f.path)));

// Real-username check (no 洪, no hard-coded admin, etc.).
const realUserNames = new Set();
if (process.env.USERNAME) realUserNames.add(process.env.USERNAME);
if (process.env.USER) realUserNames.add(process.env.USER);
if (process.env.USERPROFILE) realUserNames.add(path.basename(process.env.USERPROFILE));
// Filter out common CI / Docker / system usernames that are not personal
// identities. This prevents false positives in GitHub Actions, Docker
// containers, and similar non-interactive environments.
const KNOWN_NON_PERSONAL = new Set([
  'root', 'ci', 'runner', 'runneradmin', 'node',
  'default', 'user', 'administrator', 'public'
]);
for (const n of realUserNames) {
  if (n && KNOWN_NON_PERSONAL.has(n.toLowerCase())) {
    realUserNames.delete(n);
  }
}
function realUserInPath(p) {
  for (const u of realUserNames) {
    if (!u) continue;
    if (p.toLowerCase().indexOf(u.toLowerCase()) >= 0) return u;
  }
  return null;
}
let userLeak = null;
for (const f of result.candidateFiles) {
  const u = realUserInPath(f.path);
  if (u) { userLeak = { path: f.path, user: u }; break; }
}
if (userLeak) {
  for (const f of result.likelyAiFiles) {
    const u = realUserInPath(f.path);
    if (u) { userLeak = { path: f.path, user: u }; break; }
  }
}
check('no real Windows username appears in any candidate file path',
  userLeak === null,
  userLeak ? ('leak user=' + userLeak.user + ' in ' + userLeak.path) : '(clean)');

section('renderMarkdown');
const md = idea.renderMarkdown(result);
check('renderMarkdown returns a non-empty string', typeof md === 'string' && md.length > 0);
check('markdown contains "IDEA / JetBrains AI Log Inventory"', md.indexOf('IDEA / JetBrains AI Log Inventory') >= 0);
check('markdown contains "Likely AI-related files"', md.indexOf('Likely AI-related files') >= 0);
check('markdown contains "Existing roots without log directories"', md.indexOf('Existing roots without log directories') >= 0);
check('markdown contains "ai-assistant.log"', md.indexOf('ai-assistant.log') >= 0);
check('markdown contains "Discovered log directories"', md.indexOf('Discovered log directories') >= 0);
check('markdown contains "Searched roots"', md.indexOf('Searched roots') >= 0);
check('markdown contains a keyword hit for the "ai-assistant.log" file',
  /ai-assistant\.log[\s\S]{0,400}matched keywords/i.test(md),
  'ai-assistant.log section missing the keyword list');
// Real-username check on markdown output too.
let mdLeak = null;
for (const u of realUserNames) {
  if (!u) continue;
  if (md.indexOf(u) >= 0) { mdLeak = u; break; }
}
check('markdown contains no real Windows username (no ' + (realUserNames.size ? Array.from(realUserNames).join('/') : 'env') + ')',
  mdLeak === null,
  mdLeak ? ('found ' + mdLeak) : '(clean)');

section('renderSummaryJson');
const summary = idea.renderSummaryJson(result);
check('renderSummaryJson returns an object with sources.idea-ai',
  summary && summary.sources && summary.sources['idea-ai']);
check('summary has schemaVersion', summary && typeof summary.schemaVersion === 'string' && summary.schemaVersion.length > 0,
  'schemaVersion=' + (summary && summary.schemaVersion));
check('summary.sources["idea-ai"].candidateFiles >= 3', summary && summary.sources['idea-ai'].candidateFiles >= 3,
  'candidateFiles=' + (summary && summary.sources['idea-ai'].candidateFiles));
check('summary.sources["idea-ai"].likelyAiFiles >= 2', summary && summary.sources['idea-ai'].likelyAiFiles >= 2,
  'likelyAiFiles=' + (summary && summary.sources['idea-ai'].likelyAiFiles));
check('summary has searchedRoots/existingRoots/discoveredLogDirs',
  summary && summary.sources['idea-ai'].searchedRoots && summary.sources['idea-ai'].existingRoots && summary.sources['idea-ai'].discoveredLogDirs);
check('summary.likelyAiFileSample is an array (capped at 20)',
  summary && Array.isArray(summary.sources['idea-ai'].likelyAiFileSample) && summary.sources['idea-ai'].likelyAiFileSample.length <= 20,
  'sample length=' + (summary && summary.sources['idea-ai'].likelyAiFileSample && summary.sources['idea-ai'].likelyAiFileSample.length));
// Real-username check on the JSON output too.
const summaryText = JSON.stringify(summary);
let summaryLeak = null;
for (const u of realUserNames) {
  if (!u) continue;
  if (summaryText.indexOf(u) >= 0) { summaryLeak = u; break; }
}
check('summary JSON contains no real Windows username',
  summaryLeak === null,
  summaryLeak ? ('found ' + summaryLeak) : '(clean)');

section('result');
process.stdout.write('\n');
process.stdout.write('passed: ' + passed + '\n');
process.stdout.write('failed: ' + failed + '\n');
if (failed > 0) {
  process.stdout.write('\nFAILURES:\n');
  for (const f of failures) {
    process.stdout.write('  - ' + f.label + ' :: ' + f.detail + '\n');
  }
  process.exit(1);
}
process.exit(0);
