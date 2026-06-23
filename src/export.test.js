'use strict';

// src/export.test.js
//
// Tests for the P6-1 Export command (cmdExport).
// Uses Node.js built-in assert only. No test framework, no npm dependencies.
//
// Run via: `node src/export.test.js`
//
// Contract:
//   - exit 0 on success
//   - exit 1 on any failed assertion
//   - never makes network calls
//   - never writes outside temp dirs

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const indexMod = require('./index');
const cmdExport = indexMod.cmdExport;

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write('  [PASS] ' + name + '\n');
  } catch (err) {
    failed += 1;
    failures.push({ name: name, message: err.message });
    process.stdout.write('  [FAIL] ' + name + ' :: ' + err.message + '\n');
  }
}

function section(title) {
  process.stdout.write('\n--- ' + title + ' ---\n');
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function mkTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cj-export-'));
}

function setupWorkspace() {
  const dir = mkTempDir();
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  return dir;
}

function writeTasksJson(dir, tasks) {
  const data = {
    generatedAt: new Date().toISOString(),
    sessionsDir: '/tmp/sessions',
    tasks: tasks
  };
  fs.writeFileSync(path.join(dir, 'data', 'tasks.json'), JSON.stringify(data, null, 2));
}

function makeTask(overrides) {
  return Object.assign({
    id: 't_test001',
    date: '2026-06-01',
    time: '10:00',
    source: 'codex-sessions',
    projectPath: '/home/testuser/my-project',
    title: 'Test task',
    taskType: 'general',
    keywords: ['test', 'task'],
    userSummary: 'User summary text',
    assistantSummary: 'Assistant summary text',
    rawFilePath: '/home/testuser/.codex/sessions/test.jsonl',
    messageCount: 10,
    firstTimestamp: '2026-06-01T10:00:00.000Z',
    lastTimestamp: '2026-06-01T10:30:00.000Z'
  }, overrides || {});
}

function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = function (chunk) { captured += chunk; return true; };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return captured;
}

function findExportFile(dir, ext) {
  const exportDir = path.join(dir, 'dist', 'exports');
  if (!fs.existsSync(exportDir)) return null;
  const files = fs.readdirSync(exportDir).filter(function (f) { return f.endsWith(ext); });
  if (files.length === 0) return null;
  files.sort();
  return path.join(exportDir, files[files.length - 1]);
}

// ------------------------------------------------------------------
// 1. JSONL generation
// ------------------------------------------------------------------
section('jsonl generation');

test('jsonl export creates a .jsonl file with one JSON object per line', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [makeTask(), makeTask({ id: 't_test002', date: '2026-06-02' })];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdExport(cfg, { format: 'jsonl' }); });

    const file = findExportFile(dir, '.jsonl');
    assert.ok(file, 'jsonl export file should be created');
    const content = fs.readFileSync(file, 'utf8').trim();
    const lines = content.split('\n');
    assert.strictEqual(lines.length, 2, 'should have 2 lines (one per task)');

    // Each line should be valid JSON
    const obj0 = JSON.parse(lines[0]);
    const obj1 = JSON.parse(lines[1]);
    assert.ok(obj0.id, 'first record should have id');
    assert.ok(obj0.date, 'first record should have date');
    assert.ok(obj0.source, 'first record should have source');
    assert.ok(obj0.type, 'first record should have type');
    assert.ok(obj0.title, 'first record should have title');
    assert.ok('projectPath' in obj0, 'first record should have projectPath');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('jsonl export excludes rawFilePath', function () {
  const dir = setupWorkspace();
  try {
    writeTasksJson(dir, [makeTask()]);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdExport(cfg, { format: 'jsonl' }); });

    const file = findExportFile(dir, '.jsonl');
    const obj = JSON.parse(fs.readFileSync(file, 'utf8').trim());
    assert.ok(!('rawFilePath' in obj), 'export record should NOT contain rawFilePath');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 2. Markdown generation
// ------------------------------------------------------------------
section('markdown generation');

test('markdown export creates a .md file with table format', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [makeTask(), makeTask({ id: 't_test002', date: '2026-06-02', title: 'Second task' })];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdExport(cfg, { format: 'markdown' }); });

    const file = findExportFile(dir, '.md');
    assert.ok(file, 'markdown export file should be created');
    const content = fs.readFileSync(file, 'utf8');
    // Check header
    assert.ok(content.indexOf('# Export') >= 0, 'should have # Export header');
    // Check table header with correct columns
    assert.ok(content.indexOf('| date | time | source | type | title | projectPath |') >= 0,
      'should have table header with date/time/source/type/title/projectPath columns');
    // Check separator row
    assert.ok(content.indexOf('| --- | --- | --- | --- | --- | --- |') >= 0,
      'should have table separator row');
    // Check data rows (2 tasks)
    const dataRows = content.split('\n').filter(function (l) {
      return l.startsWith('| 2026-');
    });
    assert.strictEqual(dataRows.length, 2, 'should have 2 data rows');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 3. Filter effectiveness
// ------------------------------------------------------------------
section('filter effectiveness');

test('--source filter exports only matching tasks', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [
      makeTask({ id: 't_001', source: 'codex-sessions' }),
      makeTask({ id: 't_002', source: 'claude-code' }),
      makeTask({ id: 't_003', source: 'codex-sessions' })
    ];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdExport(cfg, { format: 'jsonl', source: 'codex-sessions' }); });

    const file = findExportFile(dir, '.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 2, 'should export 2 codex-sessions tasks');
    for (const line of lines) {
      const obj = JSON.parse(line);
      assert.strictEqual(obj.source, 'codex-sessions', 'all exported tasks should be codex-sessions');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--type filter exports only matching tasks', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [
      makeTask({ id: 't_001', taskType: 'general' }),
      makeTask({ id: 't_002', taskType: 'bugfix' }),
      makeTask({ id: 't_003', taskType: 'general' })
    ];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdExport(cfg, { format: 'jsonl', type: 'bugfix' }); });

    const file = findExportFile(dir, '.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 1, 'should export 1 bugfix task');
    const obj = JSON.parse(lines[0]);
    assert.strictEqual(obj.type, 'bugfix', 'exported task should be bugfix type');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--from/--to date range filter exports only matching tasks', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [
      makeTask({ id: 't_001', date: '2026-05-15' }),
      makeTask({ id: 't_002', date: '2026-06-01' }),
      makeTask({ id: 't_003', date: '2026-06-10' }),
      makeTask({ id: 't_004', date: '2026-07-01' })
    ];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdExport(cfg, { format: 'jsonl', from: '2026-06-01', to: '2026-06-30' }); });

    const file = findExportFile(dir, '.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 2, 'should export 2 tasks in June 2026');
    for (const line of lines) {
      const obj = JSON.parse(line);
      assert.ok(obj.date >= '2026-06-01' && obj.date <= '2026-06-30',
        'date should be within range: ' + obj.date);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no filter exports all tasks', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [
      makeTask({ id: 't_001' }),
      makeTask({ id: 't_002', source: 'claude-code' }),
      makeTask({ id: 't_003', taskType: 'bugfix' })
    ];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdExport(cfg, {}); });

    const file = findExportFile(dir, '.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 3, 'should export all 3 tasks');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 4. Secret does not leak
// ------------------------------------------------------------------
section('secret does not leak');

test('API keys in title are redacted in jsonl export', function () {
  const dir = setupWorkspace();
  try {
    const secretKey = ['sk', '1234567890abcdefGHIJ'].join('-');
    const tasks = [makeTask({
      title: 'Fix API key ' + secretKey,
      userSummary: 'My key is ' + secretKey,
      assistantSummary: 'Using token ' + secretKey
    })];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdExport(cfg, { format: 'jsonl' }); });

    const file = findExportFile(dir, '.jsonl');
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.indexOf(secretKey) < 0,
      'raw API key should NOT appear in export output');
    // The redacted form should be present
    assert.ok(content.indexOf('sk-<REDACTED>') >= 0,
      'redacted form sk-<REDACTED> should appear in title');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GitHub PAT in summary is redacted in jsonl export', function () {
  const dir = setupWorkspace();
  try {
    const pat = 'ghp_1234567890abcdefghijklmnopqrst';
    const tasks = [makeTask({
      title: 'Setup CI',
      userSummary: 'Use token ' + pat,
      assistantSummary: 'Configured with ' + pat
    })];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdExport(cfg, { format: 'jsonl' }); });

    const file = findExportFile(dir, '.jsonl');
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.indexOf(pat) < 0,
      'raw GitHub PAT should NOT appear in export output');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('secrets are redacted in markdown export', function () {
  const dir = setupWorkspace();
  try {
    const secretKey = ['sk', '9876543210fedcbaZYXW'].join('-');
    const tasks = [makeTask({
      title: 'Debug ' + secretKey,
      userSummary: 'Key: ' + secretKey
    })];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdExport(cfg, { format: 'markdown' }); });

    const file = findExportFile(dir, '.md');
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.indexOf(secretKey) < 0,
      'raw API key should NOT appear in markdown export');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('export with no tasks.json returns 0 gracefully', function () {
  const dir = setupWorkspace();
  try {
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };
    const output = captureStdout(function () {
      const code = cmdExport(cfg, {});
      assert.strictEqual(code, 0, 'should return 0 when no tasks.json');
    });
    assert.ok(output.indexOf('No tasks found') >= 0, 'should print no-tasks message');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid format returns 1', function () {
  const dir = setupWorkspace();
  try {
    writeTasksJson(dir, [makeTask()]);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };
    const code = cmdExport(cfg, { format: 'csv' });
    assert.strictEqual(code, 1, 'should return 1 for invalid format');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------
process.stdout.write('\n=== Export Test Summary ===\n');
process.stdout.write('passed: ' + passed + '  failed: ' + failed + '\n');
if (failures.length) {
  process.stdout.write('\nFailures:\n');
  for (const f of failures) {
    process.stdout.write('  - ' + f.name + ': ' + f.message + '\n');
  }
}
process.exit(failed > 0 ? 1 : 0);
