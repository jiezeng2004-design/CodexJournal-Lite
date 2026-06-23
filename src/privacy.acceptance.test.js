'use strict';

// src/privacy.acceptance.test.js
//
// Privacy acceptance test: archives Claude/Gemini/OpenCode fixtures and
// verifies that no API key tokens leak into any output file.
//
// Run: node src/privacy.acceptance.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

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

function mkTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-privacy-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'journal'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function readDirRecursive(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      readDirRecursive(full, out);
    } else {
      out.push(full);
    }
  }
}

function grepFiles(files, pattern) {
  const matches = [];
  for (const f of files) {
    try {
      const content = fs.readFileSync(f, 'utf8');
      if (pattern.test(content)) {
        matches.push(f);
      }
    } catch (_) {}
  }
  return matches;
}

console.log('=== Privacy Acceptance Test ===\n');

const ws = mkTempWorkspace();
try {
  // Build a config that enables all fixture sources
  const config = {
    sessionsDir: '/nonexistent/codex/sessions',
    journalDir: 'journal',
    dataDir: 'data',
    reportsDir: 'reports',
    timezone: 'local',
    maxSummaryChars: 300,
    maxKeywordCount: 12,
    sources: [
      { name: 'codex', type: 'codex', enabled: false, archive: true, sessionsDir: '/nonexistent/codex' },
      { name: 'claude-code', type: 'claude', enabled: true, archive: true, sessionsDir: path.join(FIXTURES, 'claude-sessions', 'projects') },
      { name: 'gemini-cli', type: 'gemini', enabled: true, archive: true, sessionsDir: path.join(FIXTURES, 'gemini-sessions') },
      { name: 'opencode', type: 'opencode', enabled: true, archive: true, mode: 'file', sessionsDir: path.join(FIXTURES, 'opencode-exports') }
    ],
    redactPatterns: [],
    plugins: []
  };

  const configPath = path.join(ws, 'my-custom-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Run archive with custom config
  const result = spawnSync(process.execPath, [
    path.join(APP_ROOT, 'src', 'index.js'),
    'archive', '--force',
    '--root', ws,
    '--config', configPath
  ], {
    cwd: ws,
    encoding: 'utf8',
    timeout: 60000
  });

  test('archive exits with code 0', function () {
    assert.strictEqual(result.status, 0, 'Expected exit 0, got ' + result.status + ': ' + result.stderr);
  });

  // Collect all output files
  const outputFiles = [];
  readDirRecursive(path.join(ws, 'data'), outputFiles);
  readDirRecursive(path.join(ws, 'journal'), outputFiles);
  readDirRecursive(path.join(ws, 'reports'), outputFiles);

  test('output files were generated', function () {
    assert.ok(outputFiles.length > 0, 'Expected some output files, got 0');
  });

  // The Claude fixture contains: sk-test1234567890abcdef
  const secretPattern = /sk-test1234567890abcdef/;
  const matches = grepFiles(outputFiles, secretPattern);

  test('sk-test1234567890abcdef must NOT leak into any output', function () {
    assert.strictEqual(matches.length, 0,
      'Secret leaked into: ' + matches.map(function (m) { return path.relative(ws, m); }).join(', '));
  });

  // Verify configPath is the custom name
  const tasksFile = path.join(ws, 'data', 'tasks.json');
  if (fs.existsSync(tasksFile)) {
    const tasksData = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
    test('tasks.json exists with tasks array', function () {
      assert.ok(Array.isArray(tasksData.tasks), 'tasks should be an array');
      assert.ok(tasksData.tasks.length >= 3, 'Expected >= 3 tasks from fixtures');
    });
  }

  // Verify stats.json does not contain the secret in topKeywords
  const statsFile = path.join(ws, 'data', 'stats.json');
  if (fs.existsSync(statsFile)) {
    const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    test('stats.topKeywords must not contain API key', function () {
      const kws = Object.keys(stats.topKeywords || {});
      for (const k of kws) {
        assert.ok(!secretPattern.test(k), 'API key leaked into topKeywords: ' + k);
      }
    });
  }

  // Verify search.md does not contain the secret
  const searchFile = path.join(ws, 'data', 'search.md');
  if (fs.existsSync(searchFile)) {
    const searchContent = fs.readFileSync(searchFile, 'utf8');
    test('search.md must not contain API key', function () {
      assert.ok(!secretPattern.test(searchContent), 'API key leaked into search.md');
    });
  }

} finally {
  cleanup(ws);
}

console.log('\n=== Summary ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  process.exit(1);
}
console.log('All privacy acceptance tests passed.');
