'use strict';

// src/sources/claude.test.js
//
// Offline regression tests for the Claude Code adapter.
// Uses Node.js built-in assert only. No test framework, no npm dependencies.
//
// Run via: `node src/sources/claude.test.js`
//
// Contract:
//   - exit 0 on success
//   - exit 1 on any failed assertion
//   - never makes network calls
//   - never writes outside the project root

const assert = require('assert');
const path = require('path');
const claude = require('./claude');
const sanitize = require('../sanitize');

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
// Mock cfg pointing to test-fixtures directory
// ------------------------------------------------------------------
const cfg = {
  maxSummaryChars: 300,
  sources: [
    { type: 'claude', sessionsDir: path.join('test-fixtures', 'claude-sessions', 'projects') }
  ]
};

const fixtureFile = path.join(
  'test-fixtures', 'claude-sessions', 'projects', '-test-project', 'session-001.jsonl'
);

// ------------------------------------------------------------------
// 1. parseClaudeFile: JSONL parsing
// ------------------------------------------------------------------
section('parseClaudeFile - JSONL format parsing');

const parsed = claude._internal.parseClaudeFile(fixtureFile, cfg);

test('parses JSONL without errors', () => {
  assert.strictEqual(parsed.errors.length, 0,
    'should have no parse errors, got: ' + JSON.stringify(parsed.errors));
});

test('extracts 4 messages total (2 user + 2 assistant)', () => {
  const userMsgs = parsed.messages.filter(function (m) { return m.kind === 'user'; });
  const assistantMsgs = parsed.messages.filter(function (m) { return m.kind === 'assistant'; });
  assert.strictEqual(userMsgs.length, 2, 'should have 2 user messages');
  assert.strictEqual(assistantMsgs.length, 2, 'should have 2 assistant messages');
  assert.strictEqual(parsed.messages.length, 4, 'should have 4 messages total');
});

test('first user message content is correct', () => {
  const userMsgs = parsed.messages.filter(function (m) { return m.kind === 'user'; });
  assert.ok(userMsgs[0].content.includes('Fix the login page CSS layout issue'),
    'first user message should contain the CSS layout text');
});

test('second user message contains the API key', () => {
  const userMsgs = parsed.messages.filter(function (m) { return m.kind === 'user'; });
  assert.ok(userMsgs[1].content.includes('sk-test1234567890abcdef'),
    'second user message should contain the API key');
});

test('assistant messages are extracted from content arrays', () => {
  const assistantMsgs = parsed.messages.filter(function (m) { return m.kind === 'assistant'; });
  assert.ok(assistantMsgs[0].content.includes('login.css'),
    'first assistant message should mention login.css');
});

test('aiTitle is extracted from ai-title entry', () => {
  assert.strictEqual(parsed.aiTitle, 'Fix login page CSS layout',
    'aiTitle should be "Fix login page CSS layout"');
});

test('cwd is extracted from user entry', () => {
  assert.strictEqual(parsed.cwd, '/home/test/project',
    'cwd should be /home/test/project');
});

test('sessionId is extracted', () => {
  assert.strictEqual(parsed.sessionId, 'sess-001',
    'sessionId should be sess-001');
});

test('timestamps are parsed from entries', () => {
  const firstMsg = parsed.messages[0];
  assert.ok(firstMsg.timestamp, 'first message should have a timestamp');
  assert.strictEqual(firstMsg.timestamp.getFullYear(), 2026);
});

// ------------------------------------------------------------------
// 2. collect: full pipeline
// ------------------------------------------------------------------
section('collect - full pipeline');

const result = claude.collect(cfg);

test('collect returns exactly one task', () => {
  assert.strictEqual(result.tasks.length, 1, 'should produce 1 task');
  assert.strictEqual(result.errors.length, 0, 'should have no errors');
});

test('collect scans 1 file in 1 project directory', () => {
  assert.strictEqual(result.fileCount, 1, 'should scan 1 file');
  assert.strictEqual(result.dirCount, 1, 'should find 1 project directory');
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

test('task source is claude-code', () => {
  assert.strictEqual(task.source, 'claude-code');
});

test('aiTitle is used as the task title', () => {
  assert.strictEqual(task.title, 'Fix login page CSS layout',
    'title should be the aiTitle value');
});

test('cwd is extracted as projectPath', () => {
  assert.strictEqual(task.projectPath, '/home/test/project',
    'projectPath should be the cwd from the fixture');
});

test('messageCount is 4', () => {
  assert.strictEqual(task.messageCount, 4);
});

test('date and time are derived from timestamps', () => {
  assert.strictEqual(task.date, '2026-01-15');
  assert.ok(task.time && task.time.length === 5, 'time should be HH:MM format');
});

test('firstTimestamp and lastTimestamp are ISO strings', () => {
  assert.ok(task.firstTimestamp, 'firstTimestamp should not be null');
  assert.ok(task.lastTimestamp, 'lastTimestamp should not be null');
  assert.ok(task.firstTimestamp.startsWith('2026-01-15'));
  assert.ok(task.lastTimestamp.startsWith('2026-01-15'));
});

// ------------------------------------------------------------------
// 3. API key redaction in userSummary
// ------------------------------------------------------------------
section('API key redaction in userSummary');

test('raw userSummary contains the API key (before sanitization)', () => {
  assert.ok(task.userSummary.includes('sk-test1234567890abcdef'),
    'raw userSummary should contain the API key extracted from the fixture');
});

test('API key is redacted after applying sanitize.redactText', () => {
  const redacted = sanitize.redactText(task.userSummary);
  assert.ok(!redacted.includes('sk-test1234567890abcdef'),
    'redacted userSummary should NOT contain the raw API key');
  assert.ok(redacted.includes('sk-' + sanitize.REDACTED),
    'redacted userSummary should contain sk-<REDACTED>');
});

test('redacted userSummary preserves non-sensitive text', () => {
  const redacted = sanitize.redactText(task.userSummary);
  assert.ok(redacted.includes('Fix the login page CSS layout issue'),
    'redacted userSummary should still contain the first user message');
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
