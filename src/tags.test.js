'use strict';

// src/tags.test.js
//
// Tests for the P6-2 Tag command (cmdTag).
// Uses Node.js built-in assert only. No test framework, no npm dependencies.
//
// Run via: `node src/tags.test.js`
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
const cmdTag = indexMod.cmdTag;

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cj-tags-'));
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

function readTags(dir) {
  const tagsFile = path.join(dir, 'data', 'tags.json');
  if (!fs.existsSync(tagsFile)) return {};
  return JSON.parse(fs.readFileSync(tagsFile, 'utf8'));
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

// ------------------------------------------------------------------
// 1. add
// ------------------------------------------------------------------
section('add');

test('tag add stores a tag for a task', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    const tags = readTags(dir);
    assert.ok(tags['t_001'], 't_001 should have tags');
    assert.ok(tags['t_001'].indexOf('bugfix') >= 0, 'bugfix tag should be stored');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tag add does not duplicate existing tag', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    const tags = readTags(dir);
    const count = tags['t_001'].filter(function (t) { return t === 'bugfix'; }).length;
    assert.strictEqual(count, 1, 'bugfix should appear only once');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tag add supports multiple tags on same task', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'release']); });
    const tags = readTags(dir);
    assert.strictEqual(tags['t_001'].length, 2, 'should have 2 tags');
    assert.ok(tags['t_001'].indexOf('bugfix') >= 0, 'should have bugfix');
    assert.ok(tags['t_001'].indexOf('release') >= 0, 'should have release');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 2. remove
// ------------------------------------------------------------------
section('remove');

test('tag remove deletes a tag from a task', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'release']); });
    captureStdout(function () { cmdTag(cfg, ['remove', 't_001', 'bugfix']); });
    const tags = readTags(dir);
    assert.ok(tags['t_001'].indexOf('bugfix') < 0, 'bugfix should be removed');
    assert.ok(tags['t_001'].indexOf('release') >= 0, 'release should remain');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tag remove cleans up empty tag arrays', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    captureStdout(function () { cmdTag(cfg, ['remove', 't_001', 'bugfix']); });
    const tags = readTags(dir);
    assert.ok(!tags['t_001'], 't_001 entry should be removed when no tags left');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tag remove on non-existent tag does not error', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    const code = cmdTag(cfg, ['remove', 't_001', 'nonexistent']);
    assert.strictEqual(code, 0, 'should return 0 even if tag does not exist');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 3. list
// ------------------------------------------------------------------
section('list');

test('tag list shows all tags for all tasks', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    captureStdout(function () { cmdTag(cfg, ['add', 't_002', 'release']); });
    const output = captureStdout(function () { cmdTag(cfg, ['list']); });
    assert.ok(output.indexOf('t_001') >= 0, 'should list t_001');
    assert.ok(output.indexOf('t_002') >= 0, 'should list t_002');
    assert.ok(output.indexOf('bugfix') >= 0, 'should show bugfix tag');
    assert.ok(output.indexOf('release') >= 0, 'should show release tag');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tag list <taskId> shows tags for specific task', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    captureStdout(function () { cmdTag(cfg, ['add', 't_002', 'release']); });
    const output = captureStdout(function () { cmdTag(cfg, ['list', 't_001']); });
    assert.ok(output.indexOf('bugfix') >= 0, 'should show bugfix for t_001');
    assert.ok(output.indexOf('t_002') < 0, 'should NOT show t_002');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tag list on empty tags shows no tags message', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    const output = captureStdout(function () { cmdTag(cfg, ['list']); });
    assert.ok(output.indexOf('No tags') >= 0, 'should show no-tags message');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 4. search
// ------------------------------------------------------------------
section('search');

test('tag search finds all tasks with a given tag', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    captureStdout(function () { cmdTag(cfg, ['add', 't_002', 'bugfix']); });
    captureStdout(function () { cmdTag(cfg, ['add', 't_003', 'release']); });
    const output = captureStdout(function () { cmdTag(cfg, ['search', 'bugfix']); });
    assert.ok(output.indexOf('t_001') >= 0, 'should find t_001');
    assert.ok(output.indexOf('t_002') >= 0, 'should find t_002');
    assert.ok(output.indexOf('t_003') < 0, 'should NOT find t_003');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tag search with no matches returns 0 count', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    const output = captureStdout(function () { cmdTag(cfg, ['search', 'nonexistent']); });
    assert.ok(output.indexOf('0') >= 0, 'should show 0 matches');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 5. Sanitization
// ------------------------------------------------------------------
section('sanitization');

test('tag with API key is sanitized before storing', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    const secretKey = ['sk', '1234567890abcdef'].join('-');
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', secretKey]); });
    const tags = readTags(dir);
    const storedTag = tags['t_001'][0];
    assert.ok(storedTag.indexOf(secretKey) < 0,
      'raw API key should NOT be stored in tag: got ' + storedTag);
    assert.ok(storedTag.indexOf('<REDACTED>') >= 0,
      'tag should contain REDACTED placeholder: got ' + storedTag);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tag with GitHub PAT is sanitized before storing', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    const pat = 'ghp_1234567890abcdefghijklmnopqrst';
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', pat]); });
    const tags = readTags(dir);
    const storedTag = tags['t_001'][0];
    assert.ok(storedTag.indexOf(pat) < 0,
      'raw GitHub PAT should NOT be stored in tag');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tag search sanitizes the search term', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    const secretKey = ['sk', '1234567890abcdef'].join('-');
    // Add with the secret key (will be sanitized to sk-<REDACTED>)
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', secretKey]); });
    // Search with the same secret key (should also be sanitized)
    const output = captureStdout(function () { cmdTag(cfg, ['search', secretKey]); });
    assert.ok(output.indexOf('t_001') >= 0,
      'should find t_001 when searching with sanitized key');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 6. Persistence
// ------------------------------------------------------------------
section('persistence');

test('tags persist across cmdTag calls (separate invocations)', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    // First "session": add tags
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'release']); });
    captureStdout(function () { cmdTag(cfg, ['add', 't_002', 'wip']); });

    // Second "session": verify tags are still there
    const tags = readTags(dir);
    assert.ok(tags['t_001'], 't_001 should persist');
    assert.strictEqual(tags['t_001'].length, 2, 't_001 should have 2 tags');
    assert.ok(tags['t_002'], 't_002 should persist');
    assert.ok(tags['t_002'].indexOf('wip') >= 0, 't_002 should have wip tag');

    // Add another tag in the second session
    captureStdout(function () { cmdTag(cfg, ['add', 't_003', 'review']); });
    const tags2 = readTags(dir);
    assert.ok(tags2['t_003'], 't_003 should be added');
    assert.ok(tags2['t_001'], 't_001 should still exist');
    assert.ok(tags2['t_002'], 't_002 should still exist');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tags.json has correct structure { taskId: [tags] }', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'bugfix']); });
    captureStdout(function () { cmdTag(cfg, ['add', 't_001', 'release']); });
    const tags = readTags(dir);
    assert.ok(typeof tags === 'object', 'tags should be an object');
    assert.ok(!Array.isArray(tags), 'tags should NOT be an array');
    assert.ok(Array.isArray(tags['t_001']), 'tags[t_001] should be an array');
    assert.strictEqual(tags['t_001'].length, 2, 'should have 2 tags');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tag add without taskId returns 1', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    const code = cmdTag(cfg, ['add']);
    assert.strictEqual(code, 1, 'should return 1 for missing args');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown subcommand returns 1', function () {
  const dir = setupWorkspace();
  try {
    const cfg = makeCfg(dir);
    const code = cmdTag(cfg, ['unknown']);
    assert.strictEqual(code, 1, 'should return 1 for unknown subcommand');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------
process.stdout.write('\n=== Tags Test Summary ===\n');
process.stdout.write('passed: ' + passed + '  failed: ' + failed + '\n');
if (failures.length) {
  process.stdout.write('\nFailures:\n');
  for (const f of failures) {
    process.stdout.write('  - ' + f.name + ': ' + f.message + '\n');
  }
}
process.exit(failed > 0 ? 1 : 0);
