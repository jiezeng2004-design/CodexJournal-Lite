'use strict';

// src/sources/opencode.test.js
//
// Offline regression tests for the OpenCode adapter (file mode).
// Uses Node.js built-in assert only. No test framework, no npm dependencies.
//
// Run via: `node src/sources/opencode.test.js`
//
// Contract:
//   - exit 0 on success
//   - exit 1 on any failed assertion
//   - never makes network calls
//   - never writes outside the project root

const assert = require('assert');
const path = require('path');
const opencode = require('./opencode');

// Set cwd to project root so relative fixture paths resolve.
process.chdir(path.join(__dirname, '..', '..'));

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
// Mock cfg pointing to test-fixtures directory (file mode)
// ------------------------------------------------------------------
const cfg = {
  maxSummaryChars: 300,
  sources: [
    {
      type: 'opencode',
      mode: 'file',
      sessionsDir: path.join('test-fixtures', 'opencode-exports')
    }
  ]
};

const fixtureFile = path.join('test-fixtures', 'opencode-exports', 'session-001.json');

// ------------------------------------------------------------------
// 1. Low-level message extraction
// ------------------------------------------------------------------
section('extractMessages - JSON format parsing');

const fs = require('fs');
const rawData = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
const rawMessages = opencode._internal.extractMessages(rawData);

test('extracts 4 messages from the JSON export', () => {
  assert.strictEqual(rawMessages.length, 4,
    'should extract 4 messages from the messages array');
});

test('normalizeMessage maps roles correctly', () => {
  const normalized = rawMessages.map(function (m) { return opencode._internal.normalizeMessage(m); });
  const userMsgs = normalized.filter(function (m) { return m && m.kind === 'user'; });
  const assistantMsgs = normalized.filter(function (m) { return m && m.kind === 'assistant'; });
  assert.strictEqual(userMsgs.length, 2, 'should have 2 user messages');
  assert.strictEqual(assistantMsgs.length, 2, 'should have 2 assistant messages');
});

test('user messages content is correct', () => {
  const normalized = rawMessages.map(function (m) { return opencode._internal.normalizeMessage(m); });
  const userMsgs = normalized.filter(function (m) { return m && m.kind === 'user'; });
  assert.ok(userMsgs[0].content.includes('Create a REST API endpoint for user registration'),
    'first user message should contain the REST API request');
  assert.ok(userMsgs[1].content.includes('JWT'),
    'second user message should mention JWT');
});

test('assistant messages content is correct', () => {
  const normalized = rawMessages.map(function (m) { return opencode._internal.normalizeMessage(m); });
  const assistantMsgs = normalized.filter(function (m) { return m && m.kind === 'assistant'; });
  assert.ok(assistantMsgs[0].content.includes('input validation'),
    'first assistant message should mention input validation');
  assert.ok(assistantMsgs[1].content.includes('JWT token generation'),
    'second assistant message should mention JWT token generation');
});

// ------------------------------------------------------------------
// 2. collect: full pipeline (file mode)
// ------------------------------------------------------------------
section('collect - full pipeline (mode: file)');

const result = opencode.collect(cfg);

test('collect returns exactly one task', () => {
  assert.strictEqual(result.tasks.length, 1, 'should produce 1 task');
  assert.strictEqual(result.errors.length, 0, 'should have no errors');
});

test('collect scans 1 file', () => {
  assert.strictEqual(result.fileCount, 1, 'should scan 1 file');
});

const task = result.tasks[0];

test('task record has exactly 14 fields', () => {
  const keys = Object.keys(task);
  assert.strictEqual(keys.length, 14,
    'task should have exactly 14 fields, got ' + keys.length + ': ' + keys.join(', '));
});

test('task has all expected field names', () => {
  const expected = [
    'id', 'date', 'time', 'source', 'projectPath', 'title',
    'taskType', 'keywords', 'userSummary', 'assistantSummary',
    'rawFilePath', 'messageCount', 'firstTimestamp', 'lastTimestamp'
  ];
  const keys = Object.keys(task);
  for (const field of expected) {
    assert.ok(keys.indexOf(field) !== -1, 'task should have field: ' + field);
  }
});

test('task source is opencode', () => {
  assert.strictEqual(task.source, 'opencode');
});

test('projectPath is extracted from cwd', () => {
  assert.strictEqual(task.projectPath, '/home/test/opencode-project',
    'projectPath should be the cwd from the fixture');
});

test('messageCount is 4', () => {
  assert.strictEqual(task.messageCount, 4);
});

test('date and time are derived from timestamps', () => {
  assert.strictEqual(task.date, '2026-01-17');
  assert.ok(task.time && task.time.length === 5, 'time should be HH:MM format');
});

test('firstTimestamp and lastTimestamp are ISO strings', () => {
  assert.ok(task.firstTimestamp, 'firstTimestamp should not be null');
  assert.ok(task.lastTimestamp, 'lastTimestamp should not be null');
  assert.ok(task.firstTimestamp.startsWith('2026-01-17'));
  assert.ok(task.lastTimestamp.startsWith('2026-01-17'));
});

test('userSummary contains user message content', () => {
  assert.ok(task.userSummary.includes('REST API endpoint'),
    'userSummary should contain user message content');
});

test('assistantSummary contains assistant message content', () => {
  assert.ok(task.assistantSummary.includes('JWT'),
    'assistantSummary should contain assistant message content');
});

// ------------------------------------------------------------------
// 3. CLI mode tests with mocked spawnSync
// ------------------------------------------------------------------
section('collect - CLI mode with mocked spawnSync');

const childProcess = require('child_process');
const realSpawnSync = childProcess.spawnSync;
const fixtureData = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));

function makeMockSpawnSync(opts) {
  opts = opts || {};
  return function (binaryPath, args, options) {
    // opencode --version -> always success
    if (args.length === 1 && args[0] === '--version') {
      return { status: 0, stdout: 'opencode version 1.0.78\n', stderr: '' };
    }
    // opencode session list --format json
    if (args[0] === 'session' && args[1] === 'list') {
      if (opts.listFails) {
        return { status: 1, stdout: '', stderr: 'command not found' };
      }
      return {
        status: 0,
        stdout: JSON.stringify([{ id: 'sess-001' }, { id: 'sess-002' }]),
        stderr: ''
      };
    }
    // opencode list --format json (fallback)
    if (args[0] === 'list' && args[1] === '--format') {
      if (opts.listFails) {
        return { status: 1, stdout: '', stderr: 'command not found' };
      }
      return {
        status: 0,
        stdout: JSON.stringify([{ id: 'sess-001' }, { id: 'sess-002' }]),
        stderr: ''
      };
    }
    // opencode export <sessionId> (new top-level command)
    if (args[0] === 'export' && args.length === 2) {
      if (opts.newExportFails) {
        return { status: 1, stdout: '', stderr: 'unknown command: export' };
      }
      return { status: 0, stdout: JSON.stringify(fixtureData), stderr: '' };
    }
    // opencode session export --session <id> --format json (legacy)
    if (args[0] === 'session' && args[1] === 'export') {
      if (opts.legacyExportFails) {
        return { status: 1, stdout: '', stderr: 'export failed' };
      }
      return { status: 0, stdout: JSON.stringify(fixtureData), stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected command: ' + args.join(' ') };
  };
}

test('CLI mode: new export command succeeds', () => {
  childProcess.spawnSync = makeMockSpawnSync();
  try {
    const cliCfg = {
      maxSummaryChars: 300,
      sources: [{ type: 'opencode', mode: 'cli', binaryPath: 'opencode' }]
    };
    const result = opencode.collect(cliCfg);
    assert.strictEqual(result.tasks.length, 2, 'should produce 2 tasks from 2 sessions');
    assert.strictEqual(result.errors.length, 0, 'should have no errors');
    assert.strictEqual(result.fileCount, 2, 'should scan 2 sessions');
  } finally {
    childProcess.spawnSync = realSpawnSync;
  }
});

test('CLI mode: new command fails, legacy fallback succeeds', () => {
  childProcess.spawnSync = makeMockSpawnSync({ newExportFails: true });
  try {
    const cliCfg = {
      maxSummaryChars: 300,
      sources: [{ type: 'opencode', mode: 'cli', binaryPath: 'opencode' }]
    };
    const result = opencode.collect(cliCfg);
    assert.strictEqual(result.tasks.length, 2, 'should produce 2 tasks via legacy fallback');
    assert.strictEqual(result.errors.length, 0, 'should have no errors');
  } finally {
    childProcess.spawnSync = realSpawnSync;
  }
});

test('CLI mode: both export commands fail, returns readable error', () => {
  childProcess.spawnSync = makeMockSpawnSync({ newExportFails: true, legacyExportFails: true });
  try {
    const cliCfg = {
      maxSummaryChars: 300,
      sources: [{ type: 'opencode', mode: 'cli', binaryPath: 'opencode' }]
    };
    const result = opencode.collect(cliCfg);
    assert.strictEqual(result.tasks.length, 0, 'should produce 0 tasks');
    assert.strictEqual(result.errors.length, 2, 'should have 2 errors (one per session)');
    assert.ok(result.errors[0].err.indexOf('opencode export failed') !== -1,
      'error should mention "opencode export failed"');
    assert.ok(result.errors[0].err.indexOf('tried:') !== -1,
      'error should list tried commands');
  } finally {
    childProcess.spawnSync = realSpawnSync;
  }
});

test('CLI mode: isBinaryAvailable detects opencode --version', () => {
  childProcess.spawnSync = makeMockSpawnSync();
  try {
    assert.ok(opencode._internal.isBinaryAvailable('opencode'),
      'isBinaryAvailable should return true when --version succeeds');
  } finally {
    childProcess.spawnSync = realSpawnSync;
  }
});

test('CLI mode: exportSessionViaCLI tries new command first', () => {
  var newCommandTried = false;
  childProcess.spawnSync = function (binaryPath, args, options) {
    if (args[0] === 'export' && args.length === 2) {
      newCommandTried = true;
      return { status: 0, stdout: JSON.stringify(fixtureData), stderr: '' };
    }
    if (args.length === 1 && args[0] === '--version') {
      return { status: 0, stdout: 'opencode version 1.0.78\n', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  try {
    var result = opencode._internal.exportSessionViaCLI('opencode', 'sess-001');
    assert.ok(newCommandTried, 'should have tried the new export command');
    assert.ok(result.data, 'should return parsed data');
    assert.strictEqual(result.error, null, 'should have no error');
  } finally {
    childProcess.spawnSync = realSpawnSync;
  }
});

test('CLI mode: error messages are sanitized (no raw stderr)', () => {
  childProcess.spawnSync = makeMockSpawnSync({ newExportFails: true, legacyExportFails: true });
  try {
    const cliCfg = {
      maxSummaryChars: 300,
      sources: [{ type: 'opencode', mode: 'cli', binaryPath: 'opencode' }]
    };
    const result = opencode.collect(cliCfg);
    // Error should not contain raw stderr paths or sensitive info
    for (const err of result.errors) {
      assert.ok(err.err.indexOf('C:\\Users\\') === -1,
        'error should not contain raw Windows user paths');
    }
  } finally {
    childProcess.spawnSync = realSpawnSync;
  }
});

// ------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------
section('result');
process.stdout.write('\n');
process.stdout.write('passed: ' + passed + '\n');
process.stdout.write('failed: ' + failed + '\n');
if (failed > 0) {
  process.stdout.write('\nFAILURES:\n');
  for (const f of failures) {
    process.stdout.write('  - ' + f.name + ' :: ' + f.message + '\n');
  }
  process.exit(1);
}
process.exit(0);
