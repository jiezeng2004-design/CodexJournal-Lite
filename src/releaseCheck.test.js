'use strict';

// src/releaseCheck.test.js
//
// Tests for the P5 release-check command (runReleaseChecks / cmdReleaseCheck).
// Uses Node.js built-in assert only. No test framework, no npm dependencies.
//
// Run via: `node src/releaseCheck.test.js`
//
// Contract:
//   - exit 0 on success
//   - exit 1 on any failed assertion
//   - never makes network calls
//   - never writes outside temp dirs or the project reports/ dir

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const indexMod = require('./index');
const runReleaseChecks = indexMod.runReleaseChecks;
const cmdReleaseCheck = indexMod.cmdReleaseCheck;

// Set cwd to project root so relative paths resolve.
process.chdir(path.join(__dirname, '..'));

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cj-release-'));
}

function writeFixture(dir, relPath, content) {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function findCheck(results, partialName) {
  return results.find(function (r) { return r.name.indexOf(partialName) >= 0; });
}

// Create a valid fixture that passes all 19 checks (0 blockers).
function createValidFixture(dir) {
  writeFixture(dir, 'package.json', JSON.stringify({
    name: 'codexjournal-lite',
    version: '1.4.0',
    bin: { 'codexjournal-lite': 'src/index.js' },
    scripts: {
      'test': 'npm run test:privacy && npm run test:console',
      'test:sources': 'node src/test.js',
      'test:privacy': 'node src/privacy.js',
      'test:console': 'node src/console.js',
      'verify:fresh': 'node src/verify.js',
      'package:public': 'powershell -File scripts/package.ps1',
      'verify:public-zip': 'powershell -File scripts/verify.ps1'
    },
    files: ['src/', 'README.md']
  }));
  writeFixture(dir, 'CHANGELOG.md', '# Changelog\n\n## [1.4.0]\n\n- Release\n');
  writeFixture(dir, 'README.md',
    '# CodexJournal-Lite\n\n## Quick Start\n\nnpm run archive\n\n' +
    '## Privacy Model\n\nNo upload.\n\n## Supported Sources\n\ncodex, claude\n');
  writeFixture(dir, '.npmignore',
    'data/*\n!data/.gitkeep\njournal/*\n!journal/.gitkeep\n' +
    'reports/*\n!reports/.gitkeep\ndist/*\n!dist/.gitkeep\n');
  writeFixture(dir, 'src/index.js',
    '#!/usr/bin/env node\n// Commands: archive check preview changelog doctor source-doctor release-check export tag cluster migrate\n');
  writeFixture(dir, 'SECURITY.md', '# Security\n');
  writeFixture(dir, 'CONTRIBUTING.md', '# Contributing\n');
  writeFixture(dir, 'LICENSE', 'MIT License\n');
  writeFixture(dir, '.github/workflows/ci.yml',
    'name: CI\nsteps:\n  - run: npm test\n');
  writeFixture(dir, 'docs/screenshots/01-dashboard.png', 'fake-png');
}

// ------------------------------------------------------------------
// 1. version missing in changelog -> blocker
// ------------------------------------------------------------------
section('version missing in changelog');

test('missing 1.4.0 in CHANGELOG is a blocker', function () {
  const dir = mkTempDir();
  try {
    createValidFixture(dir);
    // Overwrite CHANGELOG without 1.4.0
    writeFixture(dir, 'CHANGELOG.md', '# Changelog\n\n## [1.3.0]\n\n- Old release\n');
    const results = runReleaseChecks({ appRoot: dir });
    const check = findCheck(results, 'CHANGELOG');
    assert.ok(check, 'CHANGELOG check should exist');
    assert.strictEqual(check.status, 'blocker',
      'CHANGELOG check should be blocker when 1.4.0 missing, got: ' + check.status);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 2. stale current-version docs -> blocker/warning
// ------------------------------------------------------------------
section('stale current-version docs');

test('stale version reference in docs is flagged', function () {
  const dir = mkTempDir();
  try {
    createValidFixture(dir);
    // Add a docs file with a stale version reference in regular text
    writeFixture(dir, 'docs/guide.md', '# Guide\n\nThis feature was added in v1.1.2.\n');
    const results = runReleaseChecks({ appRoot: dir });
    const check = findCheck(results, 'docs/');
    assert.ok(check, 'docs check should exist');
    assert.ok(check.status === 'warning' || check.status === 'blocker',
      'docs check should be warning or blocker, got: ' + check.status);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stale version in table row is NOT flagged (Release History)', function () {
  const dir = mkTempDir();
  try {
    createValidFixture(dir);
    // Add a docs file with stale version in a table row (should be skipped)
    writeFixture(dir, 'docs/history.md',
      '# Release History\n\n| Version | Focus |\n| --- | --- |\n| v1.1.2 | bugfix |\n');
    const results = runReleaseChecks({ appRoot: dir });
    const check = findCheck(results, 'docs/');
    assert.ok(check, 'docs check should exist');
    assert.strictEqual(check.status, 'pass',
      'docs check should pass when stale versions only in table rows, got: ' + check.status);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 3. package includes forbidden outputs -> blocker
// ------------------------------------------------------------------
section('package includes forbidden outputs');

test('files field with data/ directory is a blocker', function () {
  const dir = mkTempDir();
  try {
    createValidFixture(dir);
    // Overwrite package.json with forbidden dirs in files field
    writeFixture(dir, 'package.json', JSON.stringify({
      name: 'codexjournal-lite',
      version: '1.4.0',
      bin: { 'codexjournal-lite': 'src/index.js' },
      scripts: {
        'test:sources': 'node src/test.js',
        'test:privacy': 'node src/privacy.js',
        'verify:fresh': 'node src/verify.js',
        'package:public': 'powershell -File scripts/package.ps1',
        'verify:public-zip': 'powershell -File scripts/verify.ps1'
      },
      files: ['src/', 'data/', 'journal/', 'README.md']
    }));
    const results = runReleaseChecks({ appRoot: dir });
    const check = findCheck(results, 'files field');
    assert.ok(check, 'files field check should exist');
    assert.strictEqual(check.status, 'blocker',
      'files field with data/ should be blocker, got: ' + check.status);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('npm pack check fails without .npmignore and with forbidden files', function () {
  const dir = mkTempDir();
  try {
    createValidFixture(dir);
    // Remove .npmignore and add forbidden dirs in files
    fs.unlinkSync(path.join(dir, '.npmignore'));
    writeFixture(dir, 'package.json', JSON.stringify({
      name: 'codexjournal-lite',
      version: '1.4.0',
      bin: { 'codexjournal-lite': 'src/index.js' },
      scripts: {
        'test:sources': 'node src/test.js',
        'test:privacy': 'node src/privacy.js',
        'verify:fresh': 'node src/verify.js',
        'package:public': 'powershell -File scripts/package.ps1',
        'verify:public-zip': 'powershell -File scripts/verify.ps1'
      },
      files: ['src/', 'data/', 'reports/', 'README.md']
    }));
    const results = runReleaseChecks({ appRoot: dir });
    const check = findCheck(results, 'npm pack');
    assert.ok(check, 'npm pack check should exist');
    assert.strictEqual(check.status, 'blocker',
      'npm pack check should be blocker without .npmignore and forbidden files, got: ' + check.status);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 4. missing test script -> blocker
// ------------------------------------------------------------------
section('missing test script');

test('missing test:sources script is a blocker', function () {
  const dir = mkTempDir();
  try {
    createValidFixture(dir);
    // Overwrite package.json without test:sources
    writeFixture(dir, 'package.json', JSON.stringify({
      name: 'codexjournal-lite',
      version: '1.4.0',
      bin: { 'codexjournal-lite': 'src/index.js' },
      scripts: {
        'test:privacy': 'node src/privacy.js',
        'verify:fresh': 'node src/verify.js',
        'package:public': 'powershell -File scripts/package.ps1',
        'verify:public-zip': 'powershell -File scripts/verify.ps1'
      },
      files: ['src/', 'README.md']
    }));
    const results = runReleaseChecks({ appRoot: dir });
    const check = findCheck(results, 'test:sources');
    assert.ok(check, 'test:sources check should exist');
    assert.strictEqual(check.status, 'blocker',
      'missing test:sources should be blocker, got: ' + check.status);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 5. valid fixture project -> pass
// ------------------------------------------------------------------
section('valid fixture project');

test('valid fixture has 0 blockers', function () {
  const dir = mkTempDir();
  try {
    createValidFixture(dir);
    const results = runReleaseChecks({ appRoot: dir });
    const blockers = results.filter(function (r) { return r.status === 'blocker'; });
    assert.strictEqual(blockers.length, 0,
      'valid fixture should have 0 blockers, got: ' +
      blockers.map(function (b) { return '#' + b.id + ' ' + b.name + ': ' + b.detail; }).join(', '));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('valid fixture has 19 checks', function () {
  const dir = mkTempDir();
  try {
    createValidFixture(dir);
    const results = runReleaseChecks({ appRoot: dir });
    assert.strictEqual(results.length, 19,
      'should have exactly 19 checks, got: ' + results.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 6. cmdReleaseCheck writes reports and returns correct exit code
// ------------------------------------------------------------------
section('cmdReleaseCheck output');

test('cmdReleaseCheck writes release-readiness.md and .json', function () {
  const dir = mkTempDir();
  try {
    createValidFixture(dir);
    const reportsDir = path.join(dir, 'reports');

    // Capture stdout
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = function (chunk) { return true; };

    let exitCode;
    try {
      exitCode = cmdReleaseCheck({ appRoot: dir, reportsDir: reportsDir });
    } finally {
      process.stdout.write = originalWrite;
    }

    assert.strictEqual(exitCode, 0, 'valid fixture should exit 0');
    assert.ok(fs.existsSync(path.join(reportsDir, 'release-readiness.md')),
      'release-readiness.md should exist');
    assert.ok(fs.existsSync(path.join(reportsDir, 'release-readiness.json')),
      'release-readiness.json should exist');

    // Verify JSON is valid and has expected structure
    const json = JSON.parse(fs.readFileSync(
      path.join(reportsDir, 'release-readiness.json'), 'utf8'));
    assert.ok(json.generatedAt, 'JSON should have generatedAt');
    assert.ok(json.result, 'JSON should have result');
    assert.strictEqual(json.result, 'READY', 'valid fixture result should be READY');
    assert.ok(Array.isArray(json.checks), 'JSON should have checks array');
    assert.strictEqual(json.checks.length, 19, 'should have 19 checks');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cmdReleaseCheck returns 1 when blockers exist', function () {
  const dir = mkTempDir();
  try {
    createValidFixture(dir);
    // Break the changelog check
    writeFixture(dir, 'CHANGELOG.md', '# Changelog\n\n## [1.0.0]\n\n- Old\n');
    const reportsDir = path.join(dir, 'reports');

    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = function (chunk) { return true; };

    let exitCode;
    try {
      exitCode = cmdReleaseCheck({ appRoot: dir, reportsDir: reportsDir });
    } finally {
      process.stdout.write = originalWrite;
    }

    assert.strictEqual(exitCode, 1, 'broken fixture should exit 1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// 7. Real project passes release check (no blockers)
// ------------------------------------------------------------------
section('real project');

test('real project has 0 blockers', function () {
  const realRoot = path.resolve(__dirname, '..');
  const results = runReleaseChecks({ appRoot: realRoot });
  const blockers = results.filter(function (r) { return r.status === 'blocker'; });
  assert.strictEqual(blockers.length, 0,
    'real project should have 0 blockers, got: ' +
    blockers.map(function (b) { return '#' + b.id + ' ' + b.name + ': ' + b.detail; }).join(', '));
});

test('real project has 19 checks', function () {
  const realRoot = path.resolve(__dirname, '..');
  const results = runReleaseChecks({ appRoot: realRoot });
  assert.strictEqual(results.length, 19,
    'real project should have 19 checks, got: ' + results.length);
});

// ------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------
process.stdout.write('\n=== Release Check Test Summary ===\n');
process.stdout.write('passed: ' + passed + '  failed: ' + failed + '\n');
if (failures.length) {
  process.stdout.write('\nFailures:\n');
  for (const f of failures) {
    process.stdout.write('  - ' + f.name + ': ' + f.message + '\n');
  }
}
process.exit(failed > 0 ? 1 : 0);
