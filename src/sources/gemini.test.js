'use strict';

// src/sources/gemini.test.js
//
// Offline regression tests for the Gemini CLI adapter.
// Uses Node.js built-in assert only. No test framework, no npm dependencies.
//
// Run via: `node src/sources/gemini.test.js`
//
// Contract:
//   - exit 0 on success
//   - exit 1 on any failed assertion
//   - never makes network calls
//   - never writes outside the project root

const assert = require('assert');
const path = require('path');
const gemini = require('./gemini');

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
    { type: 'gemini', sessionsDir: path.join('test-fixtures', 'gemini-sessions') }
  ]
};

const fixtureFile = path.join('test-fixtures', 'gemini-sessions', 'checkpoint-001.json');

// ------------------------------------------------------------------
// 1. parseGeminiFile: JSON parsing
// ------------------------------------------------------------------
section('parseGeminiFile - JSON format parsing');

const parsed = gemini._internal.parseGeminiFile(fixtureFile, cfg);

test('parses JSON without errors', () => {
  assert.strictEqual(parsed.errors.length, 0,
    'should have no parse errors, got: ' + JSON.stringify(parsed.errors));
});

test('extracts 4 messages total (2 user + 2 assistant)', () => {
  const userMsgs = parsed.messages.filter(function (m) { return m.kind === 'user'; });
  const assistantMsgs = parsed.messages.filter(function (m) { return m.kind === 'assistant'; });
  assert.strictEqual(userMsgs.length, 2, 'should have 2 user messages');
  assert.strictEqual(assistantMsgs.length, 2, 'should have 2 assistant (model) messages');
  assert.strictEqual(parsed.messages.length, 4, 'should have 4 messages total');
});

test('user messages content is correct', () => {
  const userMsgs = parsed.messages.filter(function (m) { return m.kind === 'user'; });
  assert.ok(userMsgs[0].content.includes('Help me write a Python script to parse JSON files'),
    'first user message should contain the Python script request');
  assert.ok(userMsgs[1].content.includes('error handling'),
    'second user message should mention error handling');
});

test('model messages are normalized to assistant kind', () => {
  const assistantMsgs = parsed.messages.filter(function (m) { return m.kind === 'assistant'; });
  assert.ok(assistantMsgs[0].content.includes('json module'),
    'first model message should mention json module');
  assert.ok(assistantMsgs[1].content.includes('try-except'),
    'second model message should mention try-except');
});

test('cwd is extracted from JSON', () => {
  assert.strictEqual(parsed.cwd, '/home/test/gemini-project',
    'cwd should be /home/test/gemini-project');
});

test('sessionId is extracted from JSON', () => {
  assert.strictEqual(parsed.sessionId, 'gemini-001',
    'sessionId should be gemini-001');
});

test('timestamps are parsed from messages', () => {
  const firstMsg = parsed.messages[0];
  assert.ok(firstMsg.timestamp, 'first message should have a timestamp');
  assert.strictEqual(firstMsg.timestamp.getFullYear(), 2026);
});

// ------------------------------------------------------------------
// 2. collect: full pipeline
// ------------------------------------------------------------------
section('collect - full pipeline');

const result = gemini.collect(cfg);

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

test('task source is gemini-cli', () => {
  assert.strictEqual(task.source, 'gemini-cli');
});

test('title is correctly generated from first user message', () => {
  assert.strictEqual(task.title, 'Help me write a Python script to parse JSON files',
    'title should be generated from the first user message');
});

test('projectPath is extracted from cwd', () => {
  assert.strictEqual(task.projectPath, '/home/test/gemini-project',
    'projectPath should be the cwd from the fixture');
});

test('messageCount is 4', () => {
  assert.strictEqual(task.messageCount, 4);
});

test('date and time are derived from timestamps', () => {
  assert.strictEqual(task.date, '2026-01-16');
  assert.ok(task.time && task.time.length === 5, 'time should be HH:MM format');
});

test('firstTimestamp and lastTimestamp are ISO strings', () => {
  assert.ok(task.firstTimestamp, 'firstTimestamp should not be null');
  assert.ok(task.lastTimestamp, 'lastTimestamp should not be null');
  assert.ok(task.firstTimestamp.startsWith('2026-01-16'));
  assert.ok(task.lastTimestamp.startsWith('2026-01-16'));
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
