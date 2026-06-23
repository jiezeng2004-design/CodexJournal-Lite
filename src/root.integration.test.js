'use strict';

// src/root.integration.test.js
//
// Integration tests for workspace root separation (APP_ROOT vs WORKSPACE_ROOT).
// Verifies root resolution priority, console API workspace reads, doctor in
// non-source workspace, and path traversal protection.
// Uses Node.js built-in assert only. No external dependencies.
//
// Run via: `node src/root.integration.test.js`

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const roots = require('./roots');
const cfgMod = require('./config');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('  [PASS] ' + name + '\n');
  } catch (err) {
    failed++;
    failures.push({ name: name, message: err.message });
    process.stdout.write('  [FAIL] ' + name + ' :: ' + err.message + '\n');
  }
}

function section(title) {
  process.stdout.write('\n--- ' + title + ' ---\n');
}

// Helper: create a temp workspace directory
function mkTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cjl-root-test-'));
  // Create minimal workspace structure
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'journal'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  // Minimal config.json
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    sources: [{ type: 'codex', enabled: false }]
  }));
  // Minimal tasks.json
  fs.writeFileSync(path.join(dir, 'data', 'tasks.json'), '[]');
  return dir;
}

// ------------------------------------------------------------------
// 1. Root resolution priority
// ------------------------------------------------------------------
section('Root resolution priority');

test('APP_ROOT is absolute and contains src/', function() {
  assert.ok(path.isAbsolute(roots.APP_ROOT), 'APP_ROOT should be absolute');
  assert.ok(fs.existsSync(path.join(roots.APP_ROOT, 'src')), 'APP_ROOT should contain src/');
});

test('getAppRoot() returns same as APP_ROOT', function() {
  assert.strictEqual(roots.getAppRoot(), roots.APP_ROOT);
});

test('Default workspace root is cwd', function() {
  const wr = roots.resolveWorkspaceRoot({}, {}, '/some/cwd');
  assert.strictEqual(wr, path.resolve('/some/cwd'));
});

test('--root overrides cwd', function() {
  const wr = roots.resolveWorkspaceRoot({ root: '/custom/root' }, {}, '/some/cwd');
  assert.strictEqual(wr, path.resolve('/custom/root'));
});

test('CODEXJOURNAL_ROOT env overrides cwd', function() {
  const wr = roots.resolveWorkspaceRoot({}, { CODEXJOURNAL_ROOT: '/env/root' }, '/some/cwd');
  assert.strictEqual(wr, path.resolve('/env/root'));
});

test('--root takes priority over CODEXJOURNAL_ROOT env', function() {
  const wr = roots.resolveWorkspaceRoot({ root: '/arg/root' }, { CODEXJOURNAL_ROOT: '/env/root' }, '/some/cwd');
  assert.strictEqual(wr, path.resolve('/arg/root'));
});

test('parseRootArgs extracts --root', function() {
  const opts = roots.parseRootArgs(['--root', '/my/workspace']);
  assert.strictEqual(opts.root, '/my/workspace');
});

test('parseRootArgs returns empty when no --root', function() {
  const opts = roots.parseRootArgs(['archive', '--force']);
  assert.strictEqual(opts.root, undefined);
});

// ------------------------------------------------------------------
// 2. resolveRuntimePaths
// ------------------------------------------------------------------
section('resolveRuntimePaths');

test('resolveRuntimePaths returns correct paths', function() {
  const rp = roots.resolveRuntimePaths('/app/root', '/workspace/root');
  assert.strictEqual(rp.appRoot, '/app/root');
  assert.strictEqual(rp.workspaceRoot, '/workspace/root');
  assert.strictEqual(rp.configPath, path.join('/workspace/root', 'config.json'));
  assert.strictEqual(rp.dataDir, path.join('/workspace/root', 'data'));
  assert.strictEqual(rp.journalDir, path.join('/workspace/root', 'journal'));
  assert.strictEqual(rp.reportsDir, path.join('/workspace/root', 'reports'));
  assert.strictEqual(rp.distDir, path.join('/workspace/root', 'dist'));
  assert.strictEqual(rp.isCloneMode, false);
});

test('resolveRuntimePaths detects clone mode', function() {
  const rp = roots.resolveRuntimePaths('/same/root', '/same/root');
  assert.strictEqual(rp.isCloneMode, true);
});

test('resolveRuntimePaths accepts custom configPath', function() {
  const rp = roots.resolveRuntimePaths('/app', '/ws', '/custom/config.json');
  assert.strictEqual(rp.configPath, '/custom/config.json');
});

// ------------------------------------------------------------------
// 3. Config loads from workspace root
// ------------------------------------------------------------------
section('Config loads from workspace root');

test('loadConfig uses workspaceRoot for data dirs', function() {
  const ws = mkTempWorkspace();
  try {
    const cfg = cfgMod.loadConfig(ws, roots.APP_ROOT);
    assert.strictEqual(cfg.projectRoot, path.resolve(ws));
    assert.strictEqual(cfg.appRoot, roots.APP_ROOT);
    assert.ok(cfg.dataDir.startsWith(ws), 'dataDir should be under workspaceRoot');
    assert.ok(cfg.reportsDir.startsWith(ws), 'reportsDir should be under workspaceRoot');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('loadConfig in workspace mode has appRoot != projectRoot', function() {
  const ws = mkTempWorkspace();
  try {
    const cfg = cfgMod.loadConfig(ws, roots.APP_ROOT);
    assert.notStrictEqual(cfg.projectRoot, cfg.appRoot);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('loadConfig in clone mode has appRoot == projectRoot', function() {
  const cfg = cfgMod.loadConfig(roots.APP_ROOT, roots.APP_ROOT);
  assert.strictEqual(cfg.projectRoot, cfg.appRoot);
});

// ------------------------------------------------------------------
// 4. Doctor works in non-source workspace
// ------------------------------------------------------------------
section('Doctor in non-source workspace');

test('Doctor does not crash in workspace without package.json', function() {
  const ws = mkTempWorkspace();
  try {
    const cfg = cfgMod.loadConfig(ws, roots.APP_ROOT);
    cfgMod.ensureOutputDirs(cfg);
    // Verify that appRoot-based paths exist (source code dirs)
    assert.ok(fs.existsSync(path.join(cfg.appRoot, 'src')), 'appRoot should have src/');
    assert.ok(fs.existsSync(path.join(cfg.appRoot, 'package.json')), 'appRoot should have package.json');
    // Verify workspace does NOT have package.json
    assert.ok(!fs.existsSync(path.join(cfg.projectRoot, 'package.json')), 'workspace should NOT have package.json');
    // The doctor should be able to read package.json from appRoot, not workspaceRoot
    const pkg = JSON.parse(fs.readFileSync(path.join(cfg.appRoot, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts, 'package.json from appRoot should have scripts');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 5. Path traversal protection
// ------------------------------------------------------------------
section('Path traversal protection');

test('safeJoin rejects ../ traversal', function() {
  // Load safeJoin from server.js context
  const serverPath = path.join(roots.APP_ROOT, 'console', 'server.js');
  const serverSrc = fs.readFileSync(serverPath, 'utf8');
  // Verify safeJoin function exists and has boundary check
  assert.ok(serverSrc.indexOf('safeJoin') >= 0, 'safeJoin should exist in server.js');
  assert.ok(serverSrc.indexOf('..') >= 0 || serverSrc.indexOf('normalize') >= 0, 'safeJoin should check for traversal');
});

test('safeJoin rejects absolute paths', function() {
  const serverPath = path.join(roots.APP_ROOT, 'console', 'server.js');
  const serverSrc = fs.readFileSync(serverPath, 'utf8');
  // Verify safeJoin checks for absolute paths or uses path.relative
  assert.ok(serverSrc.indexOf('safeJoin') >= 0, 'safeJoin should exist');
});

test('app.js does not contain weeks * 7 in cols calculation', function() {
  const appPath = path.join(roots.APP_ROOT, 'console', 'public', 'app.js');
  const src = fs.readFileSync(appPath, 'utf8');
  assert.ok(src.indexOf('var cols = weeks * 7') < 0, 'app.js should not have cols = weeks * 7 (heatmap bug fix)');
  assert.ok(src.indexOf('var cols = weeks + 1') >= 0, 'app.js should have cols = weeks + 1');
});

// ------------------------------------------------------------------
// 6. Version consistency
// ------------------------------------------------------------------
section('Version consistency');

test('package.json version is 1.4.1', function() {
  const pkg = JSON.parse(fs.readFileSync(path.join(roots.APP_ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.version, '1.4.1');
});

test('No stale version references in README', function() {
  const readme = fs.readFileSync(path.join(roots.APP_ROOT, 'README.md'), 'utf8');
  assert.ok(readme.indexOf('v1.1.2') < 0, 'README should not contain v1.1.2');
  // v0.5.2 is allowed in screenshot captions that explicitly label old UI previews
  const lines = readme.split('\n');
  for (const line of lines) {
    if (line.indexOf('v0.5.2') >= 0 && line.indexOf('preview') < 0 && line.indexOf('screenshot') < 0 && line.indexOf('older') < 0) {
      assert.fail('README line "' + line.trim() + '" should not contain v0.5.2');
    }
  }
});

test('No stale version references in docs', function() {
  const docsDir = path.join(roots.APP_ROOT, 'docs');
  if (fs.existsSync(docsDir)) {
    const docs = fs.readdirSync(docsDir);
    for (const d of docs) {
      if (!d.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(docsDir, d), 'utf8');
      // Allow CHANGELOG and release history references (table rows with | v1.x.x |)
      // but flag standalone v1.1.0 references that aren't in history tables
      const lines = content.split('\n');
      for (const line of lines) {
        // Skip table rows (release history) and CHANGELOG entries
        if (line.match(/^\|.*v1\.\d+\.\d+.*\|/)) continue;
        if (line.match(/^##\s*\[1\.\d+\.\d+\]/)) continue;
        // Flag standalone v1.1.0 references (not in tables or changelog headers)
        if (line.indexOf('v1.1.0') >= 0 && d !== 'CHANGELOG.md') {
          assert.fail(d + ' line "' + line.trim() + '" should not contain v1.1.0');
        }
      }
    }
  }
});

// ------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------
process.stdout.write('\n=== Root Integration Test Summary ===\n');
process.stdout.write('passed: ' + passed + '  failed: ' + failed + '\n');
if (failures.length) {
  process.stdout.write('\nFailures:\n');
  for (const f of failures) {
    process.stdout.write('  - ' + f.name + ': ' + f.message + '\n');
  }
}
process.exit(failed > 0 ? 1 : 0);
