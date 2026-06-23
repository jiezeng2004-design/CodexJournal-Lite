'use strict';

// src/migration.test.js
//
// Tests for the P6-4 Migrate command (cmdMigrate).
// Uses Node.js built-in assert only. No test framework, no npm dependencies.
//
// Run via: `node src/migration.test.js`
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
const cmdMigrate = indexMod.cmdMigrate;

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cj-migrate-'));
}

function setupWorkspace() {
  const dir = mkTempDir();
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  return dir;
}

function makeCfg(dir) {
  return {
    dataDir: path.join(dir, 'data'),
    reportsDir: path.join(dir, 'reports'),
    projectRoot: dir,
    sessionsDir: '/tmp/sessions'
  };
}

function makeTask(overrides) {
  return Object.assign({
    id: 't_test001',
    date: '2026-06-01',
    time: '10:00',
    source: 'codex-sessions',
    projectPath: '/home/testuser/project',
    title: 'Test task',
    taskType: 'general',
    keywords: ['test'],
    userSummary: 'Summary',
    assistantSummary: 'Summary',
    rawFilePath: '/home/testuser/.codex/sessions/test.jsonl',
    messageCount: 5,
    firstTimestamp: '2026-06-01T10:00:00.000Z',
    lastTimestamp: '2026-06-01T10:30:00.000Z'
  }, overrides || {});
}

function writeTasksJson(dir, data) {
  fs.writeFileSync(path.join(dir, 'data', 'tasks.json'), JSON.stringify(data, null, 2));
}

function writeLegacyArray(dir, tasks) {
  fs.writeFileSync(path.join(dir, 'data', 'tasks.json'), JSON.stringify(tasks, null, 2));
}

function writeCurrentFormat(dir, tasks) {
  writeTasksJson(dir, {
    generatedAt: new Date().toISOString(),
    sessionsDir: '/tmp/sessions',
    tasks: tasks
  });
}

function readTasksJson(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'tasks.json'), 'utf8'));
}

function readArchiveMeta(dir) {
  const file = path.join(dir, 'data', 'archive-meta.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readMigrationReport(dir) {
  const file = path.join(dir, 'reports', 'migration-report.md');
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = function () { return true; };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
}

// ------------------------------------------------------------------
// 1. Legacy array format compatibility
// ------------------------------------------------------------------
section('legacy array format');

test('migrate converts legacy array format to {tasks:[]} format', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [makeTask(), makeTask({ id: 't_002' }), makeTask({ id: 't_003' })];
    writeLegacyArray(dir, tasks);
    const cfg = makeCfg(dir);

    captureStdout(function () { cmdMigrate(cfg); });

    const data = readTasksJson(dir);
    assert.ok(!Array.isArray(data), 'tasks.json should no longer be a bare array');
    assert.ok(data.tasks, 'tasks.json should have tasks property');
    assert.ok(Array.isArray(data.tasks), 'tasks should be an array');
    assert.strictEqual(data.tasks.length, 3, 'should preserve all 3 tasks');
    assert.ok(data.generatedAt, 'should have generatedAt');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrate preserves task data when converting from legacy format', function () {
  const dir = setupWorkspace();
  try {
    const task = makeTask({ id: 't_preserve', title: 'Important task', taskType: 'bugfix' });
    writeLegacyArray(dir, [task]);
    const cfg = makeCfg(dir);

    captureStdout(function () { cmdMigrate(cfg); });

    const data = readTasksJson(dir);
    const migrated = data.tasks[0];
    assert.strictEqual(migrated.id, 't_preserve', 'id should be preserved');
    assert.strictEqual(migrated.title, 'Important task', 'title should be preserved');
    assert.strictEqual(migrated.taskType, 'bugfix', 'taskType should be preserved');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrate does not break when format is already {tasks:[]}', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [makeTask(), makeTask({ id: 't_002' })];
    writeCurrentFormat(dir, tasks);
    const cfg = makeCfg(dir);

    captureStdout(function () { cmdMigrate(cfg); });

    const data = readTasksJson(dir);
    assert.ok(data.tasks, 'should still have tasks property');
    assert.strictEqual(data.tasks.length, 2, 'should still have 2 tasks');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrate on current format returns 0 and does not modify data', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [makeTask()];
    writeCurrentFormat(dir, tasks);
    const cfg = makeCfg(dir);
    const originalData = readTasksJson(dir);

    let exitCode;
    captureStdout(function () { exitCode = cmdMigrate(cfg); });

    assert.strictEqual(exitCode, 0, 'should return 0 for current format');
    const data = readTasksJson(dir);
    assert.strictEqual(data.tasks.length, originalData.tasks.length, 'task count should not change');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 2. archive-meta.json generation
// ------------------------------------------------------------------
section('archive-meta.json generation');

test('migrate generates data/archive-meta.json with correct fields', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [makeTask(), makeTask({ id: 't_002' }), makeTask({ id: 't_003' })];
    writeCurrentFormat(dir, tasks);
    const cfg = makeCfg(dir);

    captureStdout(function () { cmdMigrate(cfg); });

    const meta = readArchiveMeta(dir);
    assert.ok(meta, 'archive-meta.json should be created');
    assert.strictEqual(meta.schemaVersion, 1, 'schemaVersion should be 1');
    assert.ok(meta.generatedAt, 'should have generatedAt');
    assert.strictEqual(meta.taskCount, 3, 'taskCount should be 3');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('archive-meta.json is generated for legacy format too', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [makeTask(), makeTask({ id: 't_002' })];
    writeLegacyArray(dir, tasks);
    const cfg = makeCfg(dir);

    captureStdout(function () { cmdMigrate(cfg); });

    const meta = readArchiveMeta(dir);
    assert.ok(meta, 'archive-meta.json should be created even for legacy format');
    assert.strictEqual(meta.schemaVersion, 1, 'schemaVersion should be 1');
    assert.strictEqual(meta.taskCount, 2, 'taskCount should be 2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 3. migration-report.md generation
// ------------------------------------------------------------------
section('migration-report.md generation');

test('migrate writes reports/migration-report.md', function () {
  const dir = setupWorkspace();
  try {
    writeCurrentFormat(dir, [makeTask()]);
    const cfg = makeCfg(dir);

    captureStdout(function () { cmdMigrate(cfg); });

    const report = readMigrationReport(dir);
    assert.ok(report, 'migration-report.md should be created');
    assert.ok(report.indexOf('# Migration Report') >= 0, 'should have # Migration Report header');
    assert.ok(report.indexOf('generatedAt') >= 0, 'should have generatedAt');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migration report for legacy format mentions migration action', function () {
  const dir = setupWorkspace();
  try {
    writeLegacyArray(dir, [makeTask()]);
    const cfg = makeCfg(dir);

    captureStdout(function () { cmdMigrate(cfg); });

    const report = readMigrationReport(dir);
    assert.ok(report.indexOf('array (legacy)') >= 0, 'should detect legacy array format');
    assert.ok(report.indexOf('migrated') >= 0, 'should mention migration action');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migration report for current format says no migration needed', function () {
  const dir = setupWorkspace();
  try {
    writeCurrentFormat(dir, [makeTask()]);
    const cfg = makeCfg(dir);

    captureStdout(function () { cmdMigrate(cfg); });

    const report = readMigrationReport(dir);
    assert.ok(report.indexOf('{tasks:[]} (current)') >= 0, 'should detect current format');
    assert.ok(report.indexOf('no migration needed') >= 0, 'should say no migration needed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migration report includes archive metadata section', function () {
  const dir = setupWorkspace();
  try {
    writeCurrentFormat(dir, [makeTask(), makeTask({ id: 't_002' })]);
    const cfg = makeCfg(dir);

    captureStdout(function () { cmdMigrate(cfg); });

    const report = readMigrationReport(dir);
    assert.ok(report.indexOf('## Archive Metadata') >= 0, 'should have Archive Metadata section');
    assert.ok(report.indexOf('schemaVersion') >= 0, 'should mention schemaVersion');
    assert.ok(report.indexOf('taskCount') >= 0, 'should mention taskCount');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 4. Edge cases
// ------------------------------------------------------------------
section('edge cases');

test('migrate with no tasks.json returns 1', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    let exitCode;
    captureStdout(function () { exitCode = cmdMigrate(cfg); });
    assert.strictEqual(exitCode, 1, 'should return 1 when no tasks.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrate with empty tasks array succeeds', function () {
  const dir = setupWorkspace();
  try {
    writeCurrentFormat(dir, []);
    const cfg = makeCfg(dir);
    let exitCode;
    captureStdout(function () { exitCode = cmdMigrate(cfg); });
    assert.strictEqual(exitCode, 0, 'should return 0 for empty tasks');
    const meta = readArchiveMeta(dir);
    assert.strictEqual(meta.taskCount, 0, 'taskCount should be 0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrate sanitizes tasks when converting legacy format', function () {
  const dir = setupWorkspace();
  try {
    const secretKey = ['sk', '1234567890abcdef'].join('-');
    const task = makeTask({
      id: 't_secret',
      title: 'Key: ' + secretKey,
      rawFilePath: '/home/testuser/.codex/sessions/secret.jsonl'
    });
    writeLegacyArray(dir, [task]);
    const cfg = makeCfg(dir);

    captureStdout(function () { cmdMigrate(cfg); });

    const data = readTasksJson(dir);
    const content = JSON.stringify(data);
    assert.ok(content.indexOf(secretKey) < 0,
      'raw API key should NOT appear in migrated data');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------
process.stdout.write('\n=== Migration Test Summary ===\n');
process.stdout.write('passed: ' + passed + '  failed: ' + failed + '\n');
if (failures.length) {
  process.stdout.write('\nFailures:\n');
  for (const f of failures) {
    process.stdout.write('  - ' + f.name + ': ' + f.message + '\n');
  }
}
process.exit(failed > 0 ? 1 : 0);
