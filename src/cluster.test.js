'use strict';

// src/cluster.test.js
//
// Tests for the P6-3 Cluster command (cmdCluster).
// Uses Node.js built-in assert only. No test framework, no npm dependencies.
//
// Run via: `node src/cluster.test.js`
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
const cmdCluster = indexMod.cmdCluster;

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cj-cluster-'));
}

function setupWorkspace() {
  const dir = mkTempDir();
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
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
    projectPath: '/home/testuser/project-a',
    title: 'Test task',
    taskType: 'general',
    keywords: ['test', 'task'],
    userSummary: 'Summary',
    assistantSummary: 'Summary',
    rawFilePath: '/home/testuser/.codex/sessions/test.jsonl',
    messageCount: 5,
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

function readClustersJson(dir) {
  const file = path.join(dir, 'reports', 'clusters.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readClustersMd(dir) {
  const file = path.join(dir, 'reports', 'clusters.md');
  return fs.readFileSync(file, 'utf8');
}

// ------------------------------------------------------------------
// 1. Grouping logic
// ------------------------------------------------------------------
section('grouping logic');

test('clusters by project groups tasks by projectPath', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [
      makeTask({ id: 't_001', projectPath: '/home/user/project-a' }),
      makeTask({ id: 't_002', projectPath: '/home/user/project-a' }),
      makeTask({ id: 't_003', projectPath: '/home/user/project-b' })
    ];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdCluster(cfg); });

    const json = readClustersJson(dir);
    const byProject = json.clusters.byProject;
    // projectPath is sanitized, so we check by count
    const projectKeys = Object.keys(byProject);
    assert.strictEqual(projectKeys.length, 2, 'should have 2 project groups');
    // Find the group with 2 tasks
    const groupWith2 = projectKeys.find(function (k) { return byProject[k].length === 2; });
    assert.ok(groupWith2, 'should have a project group with 2 tasks');
    assert.ok(byProject[groupWith2].indexOf('t_001') >= 0, 't_001 should be in the group');
    assert.ok(byProject[groupWith2].indexOf('t_002') >= 0, 't_002 should be in the group');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clusters by source groups tasks by source', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [
      makeTask({ id: 't_001', source: 'codex-sessions' }),
      makeTask({ id: 't_002', source: 'claude-code' }),
      makeTask({ id: 't_003', source: 'codex-sessions' })
    ];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdCluster(cfg); });

    const json = readClustersJson(dir);
    const bySource = json.clusters.bySource;
    assert.strictEqual(Object.keys(bySource).length, 2, 'should have 2 source groups');
    assert.strictEqual(bySource['codex-sessions'].length, 2, 'codex-sessions should have 2 tasks');
    assert.strictEqual(bySource['claude-code'].length, 1, 'claude-code should have 1 task');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clusters by type groups tasks by taskType', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [
      makeTask({ id: 't_001', taskType: 'general' }),
      makeTask({ id: 't_002', taskType: 'bugfix' }),
      makeTask({ id: 't_003', taskType: 'general' }),
      makeTask({ id: 't_004', taskType: 'thesis' })
    ];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdCluster(cfg); });

    const json = readClustersJson(dir);
    const byType = json.clusters.byType;
    assert.strictEqual(Object.keys(byType).length, 3, 'should have 3 type groups');
    assert.strictEqual(byType['general'].length, 2, 'general should have 2 tasks');
    assert.strictEqual(byType['bugfix'].length, 1, 'bugfix should have 1 task');
    assert.strictEqual(byType['thesis'].length, 1, 'thesis should have 1 task');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clusters by keyword groups tasks by keywords', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [
      makeTask({ id: 't_001', keywords: ['api', 'test'] }),
      makeTask({ id: 't_002', keywords: ['api', 'debug'] }),
      makeTask({ id: 't_003', keywords: ['test', 'fix'] })
    ];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdCluster(cfg); });

    const json = readClustersJson(dir);
    const topKw = json.clusters.topKeywords;
    assert.ok(topKw['api'], 'api keyword should be present');
    assert.ok(topKw['test'], 'test keyword should be present');
    assert.strictEqual(topKw['api'].length, 2, 'api should have 2 tasks');
    assert.strictEqual(topKw['test'].length, 2, 'test should have 2 tasks');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clusters by week groups tasks by ISO week', function () {
  const dir = setupWorkspace();
  try {
    // 2026-06-01 is a Monday, 2026-06-03 is Wednesday (same week)
    // 2026-06-08 is Monday of the next week
    const tasks = [
      makeTask({ id: 't_001', date: '2026-06-01' }),
      makeTask({ id: 't_002', date: '2026-06-03' }),
      makeTask({ id: 't_003', date: '2026-06-08' })
    ];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdCluster(cfg); });

    const json = readClustersJson(dir);
    const byWeek = json.clusters.byWeek;
    const weekKeys = Object.keys(byWeek);
    assert.strictEqual(weekKeys.length, 2, 'should have 2 week groups');
    // Find the week with 2 tasks
    const weekWith2 = weekKeys.find(function (k) { return byWeek[k].length === 2; });
    assert.ok(weekWith2, 'should have a week with 2 tasks');
    assert.ok(byWeek[weekWith2].indexOf('t_001') >= 0, 't_001 should be in the same week as t_002');
    assert.ok(byWeek[weekWith2].indexOf('t_002') >= 0, 't_002 should be in the same week as t_001');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('task without projectPath is grouped under (none)', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [
      makeTask({ id: 't_001', projectPath: null }),
      makeTask({ id: 't_002', projectPath: '/home/user/proj' })
    ];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdCluster(cfg); });

    const json = readClustersJson(dir);
    const byProject = json.clusters.byProject;
    assert.ok(byProject['(none)'], 'should have a (none) group for tasks without projectPath');
    assert.ok(byProject['(none)'].indexOf('t_001') >= 0, 't_001 should be in (none) group');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 2. Output format
// ------------------------------------------------------------------
section('output format');

test('clusters.json has correct structure', function () {
  const dir = setupWorkspace();
  try {
    writeTasksJson(dir, [makeTask()]);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdCluster(cfg); });

    const json = readClustersJson(dir);
    assert.ok(json.generatedAt, 'should have generatedAt');
    assert.ok(typeof json.taskCount === 'number', 'should have taskCount number');
    assert.ok(json.clusters, 'should have clusters object');
    assert.ok(json.clusters.byProject, 'should have byProject');
    assert.ok(json.clusters.bySource, 'should have bySource');
    assert.ok(json.clusters.byType, 'should have byType');
    assert.ok(json.clusters.topKeywords, 'should have topKeywords');
    assert.ok(json.clusters.byWeek, 'should have byWeek');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clusters.md has correct markdown structure', function () {
  const dir = setupWorkspace();
  try {
    writeTasksJson(dir, [makeTask(), makeTask({ id: 't_002', source: 'claude-code' })]);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdCluster(cfg); });

    const md = readClustersMd(dir);
    assert.ok(md.indexOf('# Clusters Report') >= 0, 'should have # Clusters Report header');
    assert.ok(md.indexOf('## By Project') >= 0, 'should have By Project section');
    assert.ok(md.indexOf('## By Source') >= 0, 'should have By Source section');
    assert.ok(md.indexOf('## By Type') >= 0, 'should have By Type section');
    assert.ok(md.indexOf('## Top Keywords') >= 0, 'should have Top Keywords section');
    assert.ok(md.indexOf('## By Week') >= 0, 'should have By Week section');
    // Each section should have a table
    assert.ok(md.indexOf('| key | count |') >= 0, 'should have table headers');
    assert.ok(md.indexOf('| --- | --- |') >= 0, 'should have table separators');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clusters.md tables are sorted by count descending', function () {
  const dir = setupWorkspace();
  try {
    const tasks = [
      makeTask({ id: 't_001', source: 'codex-sessions' }),
      makeTask({ id: 't_002', source: 'codex-sessions' }),
      makeTask({ id: 't_003', source: 'codex-sessions' }),
      makeTask({ id: 't_004', source: 'claude-code' })
    ];
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdCluster(cfg); });

    const md = readClustersMd(dir);
    // In the By Source section, codex-sessions (3) should appear before claude-code (1)
    const sourceSection = md.substring(md.indexOf('## By Source'), md.indexOf('## By Type'));
    const codexIdx = sourceSection.indexOf('codex-sessions');
    const claudeIdx = sourceSection.indexOf('claude-code');
    assert.ok(codexIdx >= 0 && claudeIdx >= 0, 'both sources should be in the report');
    assert.ok(codexIdx < claudeIdx, 'codex-sessions (3 tasks) should appear before claude-code (1 task)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cluster with no tasks returns 0 gracefully', function () {
  const dir = setupWorkspace();
  try {
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };
    const output = captureStdout(function () {
      const code = cmdCluster(cfg);
      assert.strictEqual(code, 0, 'should return 0 when no tasks');
    });
    assert.ok(output.indexOf('No tasks') >= 0, 'should print no-tasks message');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('top keywords limited to 20 entries', function () {
  const dir = setupWorkspace();
  try {
    // Create 25 distinct keywords
    const tasks = [];
    for (let i = 0; i < 25; i++) {
      tasks.push(makeTask({ id: 't_' + i, keywords: ['kw' + i] }));
    }
    writeTasksJson(dir, tasks);
    const cfg = { dataDir: path.join(dir, 'data'), reportsDir: path.join(dir, 'reports'), projectRoot: dir, sessionsDir: '/tmp/sessions' };

    captureStdout(function () { cmdCluster(cfg); });

    const json = readClustersJson(dir);
    const kwCount = Object.keys(json.clusters.topKeywords).length;
    assert.ok(kwCount <= 20, 'topKeywords should be limited to 20, got ' + kwCount);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------
process.stdout.write('\n=== Cluster Test Summary ===\n');
process.stdout.write('passed: ' + passed + '  failed: ' + failed + '\n');
if (failures.length) {
  process.stdout.write('\nFailures:\n');
  for (const f of failures) {
    process.stdout.write('  - ' + f.name + ': ' + f.message + '\n');
  }
}
process.exit(failed > 0 ? 1 : 0);
