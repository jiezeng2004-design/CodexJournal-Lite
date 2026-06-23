'use strict';

// src/searchQuery.test.js
//
// Tests for the structured search query parser and matcher.
// Uses Node.js built-in assert only. No test framework, no npm dependencies.
//
// Run via: `node src/searchQuery.test.js`

const assert = require('assert');
const sq = require('./searchQuery');

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
// 1. Parser tests
// ------------------------------------------------------------------
section('parseSearchQuery - basic parsing');

test('parses free-text terms', () => {
  var r = sq.parseSearchQuery('hello world');
  assert.strictEqual(r.textTerms.length, 2);
  assert.strictEqual(r.textTerms[0], 'hello');
  assert.strictEqual(r.textTerms[1], 'world');
});

test('parses empty query', () => {
  var r = sq.parseSearchQuery('');
  assert.strictEqual(r.textTerms.length, 0);
  assert.strictEqual(r.phrases.length, 0);
  assert.strictEqual(Object.keys(r.filters).length, 0);
});

test('parses quoted phrase', () => {
  var r = sq.parseSearchQuery('"REST API endpoint"');
  assert.strictEqual(r.phrases.length, 1);
  assert.strictEqual(r.phrases[0], 'REST API endpoint');
});

test('parses field:value filter', () => {
  var r = sq.parseSearchQuery('source:codex');
  assert.ok(r.filters.source);
  assert.strictEqual(r.filters.source[0], 'codex');
});

test('parses type: as taskType alias', () => {
  var r = sq.parseSearchQuery('type:document');
  assert.ok(r.filters.taskType);
  assert.strictEqual(r.filters.taskType[0], 'document');
});

test('parses from: as dateFrom alias', () => {
  var r = sq.parseSearchQuery('from:2026-06-01');
  assert.ok(r.filters.dateFrom);
  assert.strictEqual(r.filters.dateFrom[0], '2026-06-01');
});

test('parses to: as dateTo alias', () => {
  var r = sq.parseSearchQuery('to:2026-06-23');
  assert.ok(r.filters.dateTo);
  assert.strictEqual(r.filters.dateTo[0], '2026-06-23');
});

test('parses keyword: filter', () => {
  var r = sq.parseSearchQuery('keyword:auth');
  assert.ok(r.filters.keywords);
  assert.strictEqual(r.filters.keywords[0], 'auth');
});

test('parses path: as projectPath alias', () => {
  var r = sq.parseSearchQuery('path:myproject');
  assert.ok(r.filters.projectPath);
  assert.strictEqual(r.filters.projectPath[0], 'myproject');
});

test('parses title: filter', () => {
  var r = sq.parseSearchQuery('title:settings');
  assert.ok(r.filters.title);
  assert.strictEqual(r.filters.title[0], 'settings');
});

test('parses quoted field value', () => {
  var r = sq.parseSearchQuery('title:"REST API"');
  assert.ok(r.filters.title);
  assert.strictEqual(r.filters.title[0], 'rest api');
});

test('parses negative filter -source:codex', () => {
  var r = sq.parseSearchQuery('-source:codex');
  assert.ok(r.excludeFilters.source);
  assert.strictEqual(r.excludeFilters.source[0], 'codex');
});

test('parses negative filter -type:document', () => {
  var r = sq.parseSearchQuery('-type:document');
  assert.ok(r.excludeFilters.taskType);
  assert.strictEqual(r.excludeFilters.taskType[0], 'document');
});

test('parses combined query with fields, phrases, and text', () => {
  var r = sq.parseSearchQuery('source:codex "REST API" -type:test hello');
  assert.ok(r.filters.source);
  assert.strictEqual(r.phrases.length, 1);
  assert.strictEqual(r.phrases[0], 'REST API');
  assert.ok(r.excludeFilters.taskType);
  assert.strictEqual(r.textTerms.length, 1);
  assert.strictEqual(r.textTerms[0], 'hello');
});

test('field names are lowercased', () => {
  var r = sq.parseSearchQuery('Source:Codex TYPE:Document');
  assert.ok(r.filters.source);
  assert.ok(r.filters.taskType);
});

test('values are lowercased for filters', () => {
  var r = sq.parseSearchQuery('source:Codex');
  assert.strictEqual(r.filters.source[0], 'codex');
});

test('text terms preserve case', () => {
  var r = sq.parseSearchQuery('Hello WORLD');
  assert.strictEqual(r.textTerms[0], 'Hello');
  assert.strictEqual(r.textTerms[1], 'WORLD');
});

// ------------------------------------------------------------------
// 2. matchTask tests
// ------------------------------------------------------------------
section('matchTask - field matching');

var sampleTask = {
  source: 'codex-sessions',
  taskType: 'codex',
  date: '2026-06-15',
  title: 'REST API design for user registration',
  keywords: ['auth', 'jwt', 'registration'],
  projectPath: '/home/user/myproject',
  rawFilePath: '/path/to/session.json',
  userSummary: 'Create a REST API endpoint',
  assistantSummary: 'Implemented JWT authentication'
};

test('source filter matches', () => {
  var p = sq.parseSearchQuery('source:codex');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('source filter does not match different source', () => {
  var p = sq.parseSearchQuery('source:claude');
  assert.ok(!sq.matchTask(sampleTask, p));
});

test('type filter matches taskType', () => {
  var p = sq.parseSearchQuery('type:codex');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('type filter does not match different type', () => {
  var p = sq.parseSearchQuery('type:document');
  assert.ok(!sq.matchTask(sampleTask, p));
});

test('date filter matches exact date', () => {
  var p = sq.parseSearchQuery('date:2026-06-15');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('date filter matches date prefix', () => {
  var p = sq.parseSearchQuery('date:2026-06');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('from: filter matches date range start', () => {
  var p = sq.parseSearchQuery('from:2026-06-01');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('from: filter rejects date before range', () => {
  var p = sq.parseSearchQuery('from:2026-07-01');
  assert.ok(!sq.matchTask(sampleTask, p));
});

test('to: filter matches date range end', () => {
  var p = sq.parseSearchQuery('to:2026-06-30');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('to: filter rejects date after range', () => {
  var p = sq.parseSearchQuery('to:2026-05-01');
  assert.ok(!sq.matchTask(sampleTask, p));
});

test('title filter matches', () => {
  var p = sq.parseSearchQuery('title:REST');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('title filter does not match missing text', () => {
  var p = sq.parseSearchQuery('title:database');
  assert.ok(!sq.matchTask(sampleTask, p));
});

test('keyword filter matches', () => {
  var p = sq.parseSearchQuery('keyword:auth');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('keyword filter does not match missing keyword', () => {
  var p = sq.parseSearchQuery('keyword:database');
  assert.ok(!sq.matchTask(sampleTask, p));
});

test('path filter matches projectPath', () => {
  var p = sq.parseSearchQuery('path:myproject');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('path filter matches rawFilePath', () => {
  var p = sq.parseSearchQuery('path:session');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('path filter does not match missing path', () => {
  var p = sq.parseSearchQuery('path:nonexistent');
  assert.ok(!sq.matchTask(sampleTask, p));
});

// ------------------------------------------------------------------
// 3. matchTask - combined and negative tests
// ------------------------------------------------------------------
section('matchTask - combined and negative');

test('combined source + keyword matches', () => {
  var p = sq.parseSearchQuery('source:codex keyword:auth');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('combined from + to date range matches', () => {
  var p = sq.parseSearchQuery('from:2026-06-01 to:2026-06-30');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('combined from + to + type matches', () => {
  var p = sq.parseSearchQuery('from:2026-06-01 to:2026-06-23 type:codex');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('negative filter -source excludes matching source', () => {
  var p = sq.parseSearchQuery('-source:claude');
  assert.ok(sq.matchTask(sampleTask, p), 'should match because source is not claude');
});

test('negative filter -source excludes matching source (own)', () => {
  var p = sq.parseSearchQuery('-source:codex');
  assert.ok(!sq.matchTask(sampleTask, p), 'should not match because source is codex');
});

test('negative filter -type excludes matching type', () => {
  var p = sq.parseSearchQuery('-type:codex');
  assert.ok(!sq.matchTask(sampleTask, p));
});

test('free-text term matches across fields', () => {
  var p = sq.parseSearchQuery('JWT');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('free-text term does not match missing text', () => {
  var p = sq.parseSearchQuery('database');
  assert.ok(!sq.matchTask(sampleTask, p));
});

test('quoted phrase matches', () => {
  var p = sq.parseSearchQuery('"REST API"');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('quoted phrase does not match partial', () => {
  var p = sq.parseSearchQuery('"REST database"');
  assert.ok(!sq.matchTask(sampleTask, p));
});

test('combined field + free-text + negative', () => {
  var p = sq.parseSearchQuery('source:codex JWT -type:document');
  assert.ok(sq.matchTask(sampleTask, p));
});

test('empty parsed query matches everything', () => {
  var p = sq.parseSearchQuery('');
  assert.ok(sq.matchTask(sampleTask, p));
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
