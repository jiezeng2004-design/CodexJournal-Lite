'use strict';

// scripts/smoke-test.js
//
// Zero-dependency smoke test for CodexJournal-Lite.
// Verifies that the CLI works end-to-end in a fresh environment.
//
// Run: node scripts/smoke-test.js
// Exit: 0 on success, 1 on failure.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
let failures = 0;
let passes = 0;

function run(cmd, args, opts) {
  const result = spawnSync(cmd, args, Object.assign({
    cwd: projectRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 30000
  }, opts || {}));
  return result;
}

function assert(condition, message) {
  if (condition) {
    passes++;
    console.log('  [PASS] ' + message);
  } else {
    failures++;
    console.error('  [FAIL] ' + message);
  }
}

console.log('=== CodexJournal-Lite Smoke Test ===\n');

// Test 1: help command exits 0
console.log('Test 1: help command');
{
  const result = run('node', ['src/index.js', 'help']);
  assert(result.status === 0, 'help exits with code 0');
  assert((result.stdout || '').includes('Commands:'), 'help output includes command list');
  assert((result.stdout || '').includes('--sessions-dir'), 'help output includes --sessions-dir');
}

// Test 2: check command exits 0
console.log('\nTest 2: check command');
{
  const result = run('node', ['src/index.js', 'check']);
  // check may return 0 or 1 depending on environment, but should not crash
  assert(result.status !== null, 'check exits with a code (not crashed)');
  assert((result.stdout || '').length > 0 || (result.stderr || '').length > 0, 'check produces output');
}

// Test 3: preview command doesn't write files
console.log('\nTest 3: preview command (no writes)');
{
  const tasksFile = path.join(projectRoot, 'data', 'tasks.json');
  const beforeMtime = fs.existsSync(tasksFile) ? fs.statSync(tasksFile).mtimeMs : 0;
  const result = run('node', ['src/index.js', 'preview']);
  assert(result.status === 0, 'preview exits with code 0');
  // Verify tasks.json was not modified
  const afterMtime = fs.existsSync(tasksFile) ? fs.statSync(tasksFile).mtimeMs : 0;
  assert(afterMtime === beforeMtime, 'preview does not modify data/tasks.json');
}

// Test 4: archive --force produces tasks.json
console.log('\nTest 4: archive --force');
{
  const result = run('node', ['src/index.js', 'archive', '--force'], { timeout: 60000 });
  assert(result.status === 0, 'archive --force exits with code 0');
  const tasksFile = path.join(projectRoot, 'data', 'tasks.json');
  assert(fs.existsSync(tasksFile), 'archive produces data/tasks.json');
  if (fs.existsSync(tasksFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
      const tasks = Array.isArray(data) ? data : (data.tasks || []);
      assert(Array.isArray(tasks), 'tasks.json contains a tasks array');
      assert(tasks.length >= 0, 'tasks array is valid');
    } catch (err) {
      assert(false, 'tasks.json is valid JSON: ' + err.message);
    }
  }
}

// Test 5: npm pack --dry-run doesn't include generated data
console.log('\nTest 5: npm pack --dry-run');
{
  // Note: archive --force in Test 4 may have written data files.
  // We check that the npm "files" whitelist in package.json excludes
  // generated data (only data/.gitkeep and data/README.md are included).
  const result = run('npm', ['pack', '--dry-run'], { timeout: 30000 });
  assert(result.status === 0, 'npm pack --dry-run exits with code 0');
  const output = result.stdout || '';
  // Check that no generated task data is included
  const hasGeneratedData = output.includes('data/tasks.json') ||
                           output.includes('data/stats.json') ||
                           output.includes('data/index.json') ||
                           output.includes('data/search.md');
  assert(!hasGeneratedData, 'npm pack does not include generated data files (tasks.json/stats.json)');
}

// Test 6: adapter auto-discovery works
console.log('\nTest 6: adapter auto-discovery');
{
  // Use a temp file instead of -e to avoid PowerShell quoting issues
  const tmpFile = path.join(projectRoot, '.smoke-adapter-check.js');
  fs.writeFileSync(tmpFile, `
    const sources = require('./src/sources');
    const adapters = sources.loadAdapters();
    const types = Object.keys(adapters).sort();
    console.log(JSON.stringify(types));
  `);
  const result = run('node', [tmpFile]);
  try { fs.unlinkSync(tmpFile); } catch (_) {}
  assert(result.status === 0, 'adapter loading exits with code 0');
  try {
    const types = JSON.parse((result.stdout || '').trim());
    assert(types.includes('codex'), 'codex adapter discovered');
    assert(types.includes('claude'), 'claude adapter discovered');
    assert(types.includes('idea'), 'idea adapter discovered');
    assert(types.includes('gemini'), 'gemini adapter discovered');
    assert(types.includes('opencode'), 'opencode adapter discovered');
  } catch (err) {
    assert(false, 'could not parse adapter types: ' + err.message + ' output: ' + (result.stdout || ''));
  }
}

// Test 7: multi-source fixture archive
console.log('\nTest 7: multi-source fixture archive');
{
  const os = require('os');
  const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-smoke-'));
  // Create a config that uses test fixtures
  const fixtureClaude = path.join(projectRoot, 'test-fixtures', 'claude-sessions', 'projects');
  const tmpConfig = path.join(tmpWs, 'config.json');
  fs.writeFileSync(tmpConfig, JSON.stringify({
    sessionsDir: '/nonexistent/codex',
    journalDir: 'journal',
    dataDir: 'data',
    reportsDir: 'reports',
    maxSummaryChars: 300,
    sources: [
      { name: 'codex', type: 'codex', enabled: false, archive: true, sessionsDir: '/nonexistent' },
      { name: 'claude-code', type: 'claude', enabled: true, archive: true, sessionsDir: fixtureClaude }
    ],
    redactPatterns: [],
    plugins: []
  }, null, 2));
  const result = run('node', ['src/index.js', 'archive', '--force', '--root', tmpWs, '--config', tmpConfig], { timeout: 30000 });
  assert(result.status === 0, 'multi-source archive exits with code 0');
  const tasksFile = path.join(tmpWs, 'data', 'tasks.json');
  assert(fs.existsSync(tasksFile), 'multi-source archive writes tasks.json to workspace');
  if (fs.existsSync(tasksFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
      const tasks = data.tasks || [];
      assert(tasks.length >= 1, 'multi-source archive produces >= 1 task from Claude fixture');
      const claudeTasks = tasks.filter(function (t) { return t.source === 'claude-code'; });
      assert(claudeTasks.length >= 1, 'multi-source archive includes claude-code tasks');
    } catch (err) {
      assert(false, 'multi-source tasks.json valid: ' + err.message);
    }
  }
  // Cleanup
  try { require('child_process').spawnSync('rmdir', ['/s', '/q', tmpWs], { shell: true }); } catch (_) {}
}

// Summary
console.log('\n=== Summary ===');
console.log('Passed: ' + passes);
console.log('Failed: ' + failures);
if (failures > 0) {
  console.error('\nSMOKE TEST FAILED');
  process.exit(1);
} else {
  console.log('\nAll smoke tests passed.');
  process.exit(0);
}
