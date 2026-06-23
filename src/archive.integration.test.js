'use strict';

// src/archive.integration.test.js
//
// Integration tests for multi-source archive dispatch.
// Tests that archive works correctly when:
// A. Codex disabled + Codex dir missing + Claude/Gemini/OpenCode fixture enabled
// B. Codex enabled + Codex dir missing + Claude fixture enabled
// C. Codex enabled + empty Codex dir + other fixtures enabled
// D. All sources missing -> tasks=[], exit 0
//
// Run: node src/archive.integration.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(APP_ROOT, 'test-fixtures');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  [PASS] ' + name);
  } catch (err) {
    failed++;
    console.error('  [FAIL] ' + name + ': ' + (err.message || err));
  }
}

// Create a temp workspace directory
function mkTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-test-'));
  // Create output dirs
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'journal'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  return dir;
}

// Create a config with specified source settings
function makeConfig(sources) {
  return {
    sessionsDir: '/nonexistent/codex/sessions',
    journalDir: 'journal',
    dataDir: 'data',
    reportsDir: 'reports',
    timezone: 'local',
    maxSummaryChars: 300,
    maxKeywordCount: 12,
    sources: sources,
    redactPatterns: [],
    plugins: []
  };
}

// Write config and run archive in a temp workspace
function runArchiveInWorkspace(workspace, config) {
  const configPath = path.join(workspace, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Use spawnSync to run the CLI
  const { spawnSync } = require('child_process');
  const result = spawnSync(process.execPath, [
    path.join(APP_ROOT, 'src', 'index.js'),
    'archive', '--force',
    '--root', workspace,
    '--config', configPath
  ], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 60000
  });

  return result;
}

// Read tasks.json from workspace
function readTasks(workspace) {
  const tasksFile = path.join(workspace, 'data', 'tasks.json');
  if (!fs.existsSync(tasksFile)) return [];
  const data = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
  return data.tasks || [];
}

// Clean up temp workspace
function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

console.log('=== Archive Integration Tests ===\n');

// ---- Test A: Codex disabled + Codex dir missing + Claude/Gemini/OpenCode fixtures ----
console.log('Test A: Codex disabled + Claude/Gemini/OpenCode fixtures enabled');
{
  const ws = mkTempWorkspace();
  try {
    const config = makeConfig([
      { name: 'codex', type: 'codex', enabled: false, archive: true, sessionsDir: '/nonexistent/codex' },
      { name: 'claude-code', type: 'claude', enabled: true, archive: true, sessionsDir: path.join(FIXTURES, 'claude-sessions', 'projects') },
      { name: 'gemini-cli', type: 'gemini', enabled: true, archive: true, sessionsDir: path.join(FIXTURES, 'gemini-sessions') },
      { name: 'opencode', type: 'opencode', enabled: true, archive: true, mode: 'file', sessionsDir: path.join(FIXTURES, 'opencode-exports') }
    ]);
    const result = runArchiveInWorkspace(ws, config);
    test('A: archive exits with code 0', function () {
      assert.strictEqual(result.status, 0, 'Expected exit 0, got ' + result.status + ': ' + result.stderr);
    });
    const tasks = readTasks(ws);
    test('A: tasks.length >= 3 (claude + gemini + opencode)', function () {
      assert.ok(tasks.length >= 3, 'Expected >= 3 tasks, got ' + tasks.length);
    });
    test('A: no codex-source tasks', function () {
      const codexTasks = tasks.filter(function (t) { return t.source === 'codex-sessions'; });
      assert.strictEqual(codexTasks.length, 0, 'Expected 0 codex tasks, got ' + codexTasks.length);
    });
    test('A: has claude-code tasks', function () {
      const claudeTasks = tasks.filter(function (t) { return t.source === 'claude-code'; });
      assert.ok(claudeTasks.length >= 1, 'Expected >= 1 claude task');
    });
  } finally {
    cleanup(ws);
  }
}

// ---- Test B: Codex enabled + Codex dir missing + Claude fixture ----
console.log('\nTest B: Codex enabled + Codex dir missing + Claude fixture enabled');
{
  const ws = mkTempWorkspace();
  try {
    const config = makeConfig([
      { name: 'codex', type: 'codex', enabled: true, archive: true, sessionsDir: '/nonexistent/codex/sessions' },
      { name: 'claude-code', type: 'claude', enabled: true, archive: true, sessionsDir: path.join(FIXTURES, 'claude-sessions', 'projects') }
    ]);
    const result = runArchiveInWorkspace(ws, config);
    test('B: archive exits with code 0', function () {
      assert.strictEqual(result.status, 0, 'Expected exit 0, got ' + result.status + ': ' + result.stderr);
    });
    const tasks = readTasks(ws);
    test('B: tasks.length >= 1 (claude only)', function () {
      assert.ok(tasks.length >= 1, 'Expected >= 1 task, got ' + tasks.length);
    });
    test('B: has claude-code tasks', function () {
      const claudeTasks = tasks.filter(function (t) { return t.source === 'claude-code'; });
      assert.ok(claudeTasks.length >= 1, 'Expected >= 1 claude task');
    });
  } finally {
    cleanup(ws);
  }
}

// ---- Test C: Codex enabled + empty Codex dir + other fixtures ----
console.log('\nTest C: Codex enabled + empty Codex dir + other fixtures enabled');
{
  const ws = mkTempWorkspace();
  // Create an empty codex sessions dir
  const emptyCodexDir = path.join(ws, 'empty-codex');
  fs.mkdirSync(emptyCodexDir, { recursive: true });
  try {
    const config = makeConfig([
      { name: 'codex', type: 'codex', enabled: true, archive: true, sessionsDir: emptyCodexDir },
      { name: 'claude-code', type: 'claude', enabled: true, archive: true, sessionsDir: path.join(FIXTURES, 'claude-sessions', 'projects') }
    ]);
    const result = runArchiveInWorkspace(ws, config);
    test('C: archive exits with code 0', function () {
      assert.strictEqual(result.status, 0, 'Expected exit 0, got ' + result.status + ': ' + result.stderr);
    });
    const tasks = readTasks(ws);
    test('C: tasks.length >= 1 (claude from fixture)', function () {
      assert.ok(tasks.length >= 1, 'Expected >= 1 task, got ' + tasks.length);
    });
    test('C: has claude-code tasks', function () {
      const claudeTasks = tasks.filter(function (t) { return t.source === 'claude-code'; });
      assert.ok(claudeTasks.length >= 1, 'Expected >= 1 claude task');
    });
  } finally {
    cleanup(ws);
  }
}

// ---- Test D: All sources missing -> tasks=[], exit 0 ----
console.log('\nTest D: All sources missing -> tasks=[], exit 0');
{
  const ws = mkTempWorkspace();
  try {
    const config = makeConfig([
      { name: 'codex', type: 'codex', enabled: true, archive: true, sessionsDir: '/nonexistent/codex' },
      { name: 'claude-code', type: 'claude', enabled: true, archive: true, sessionsDir: '/nonexistent/claude' }
    ]);
    const result = runArchiveInWorkspace(ws, config);
    test('D: archive exits with code 0', function () {
      assert.strictEqual(result.status, 0, 'Expected exit 0, got ' + result.status + ': ' + result.stderr);
    });
    const tasks = readTasks(ws);
    test('D: tasks.length === 0', function () {
      assert.strictEqual(tasks.length, 0, 'Expected 0 tasks, got ' + tasks.length);
    });
  } finally {
    cleanup(ws);
  }
}

// ---- Test E: IDEA archive=false -> not in tasks ----
console.log('\nTest E: IDEA archive=false -> not in tasks.json');
{
  const ws = mkTempWorkspace();
  try {
    const config = makeConfig([
      { name: 'codex', type: 'codex', enabled: false, archive: true, sessionsDir: '/nonexistent/codex' },
      { name: 'idea-ai', type: 'idea', enabled: true, archive: false, logDirs: [] },
      { name: 'claude-code', type: 'claude', enabled: true, archive: true, sessionsDir: path.join(FIXTURES, 'claude-sessions', 'projects') }
    ]);
    const result = runArchiveInWorkspace(ws, config);
    test('E: archive exits with code 0', function () {
      assert.strictEqual(result.status, 0, 'Expected exit 0, got ' + result.status + ': ' + result.stderr);
    });
    const tasks = readTasks(ws);
    test('E: no idea-ai tasks in output', function () {
      const ideaTasks = tasks.filter(function (t) { return t.source === 'idea-ai' || t.source === 'idea'; });
      assert.strictEqual(ideaTasks.length, 0, 'Expected 0 idea tasks, got ' + ideaTasks.length);
    });
  } finally {
    cleanup(ws);
  }
}

// ---- Test F: Workspace root isolation (npx mode) ----
console.log('\nTest F: Workspace root isolation');
{
  const ws = mkTempWorkspace();
  try {
    const config = makeConfig([
      { name: 'codex', type: 'codex', enabled: false, archive: true, sessionsDir: '/nonexistent' },
      { name: 'claude-code', type: 'claude', enabled: true, archive: true, sessionsDir: path.join(FIXTURES, 'claude-sessions', 'projects') }
    ]);
    const result = runArchiveInWorkspace(ws, config);
    test('F: archive exits with code 0', function () {
      assert.strictEqual(result.status, 0, 'Expected exit 0, got ' + result.status + ': ' + result.stderr);
    });
    test('F: tasks.json written to workspace, not APP_ROOT', function () {
      const wsTasks = path.join(ws, 'data', 'tasks.json');
      assert.ok(fs.existsSync(wsTasks), 'tasks.json should exist in workspace');
    });
  } finally {
    cleanup(ws);
  }
}

// Summary
console.log('\n=== Summary ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.error('\nINTEGRATION TEST FAILED');
  process.exit(1);
} else {
  console.log('\nAll integration tests passed.');
  process.exit(0);
}
