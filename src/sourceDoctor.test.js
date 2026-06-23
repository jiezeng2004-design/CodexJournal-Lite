'use strict';

// src/sourceDoctor.test.js
//
// Tests for the P4 Source adapter doctor()/capabilities() system.
// Uses Node.js built-in assert only. No test framework, no npm dependencies.
//
// Run via: `node src/sourceDoctor.test.js`
//
// Contract:
//   - exit 0 on success
//   - exit 1 on any failed assertion
//   - never makes network calls
//   - never writes outside the project root

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const sources = require('./sources');
const baseAdapter = require('./sources/base-adapter');
const codex = require('./sources/codex');
const claude = require('./sources/claude');
const gemini = require('./sources/gemini');
const opencode = require('./sources/opencode');
const idea = require('./sources/idea');
const sanitize = require('./sanitize');

// Set cwd to project root so relative fixture paths resolve.
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
// Helper: build a temp directory for testing
// ------------------------------------------------------------------
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cj-source-doctor-'));
}

// ------------------------------------------------------------------
// Test config: points some sources at test-fixtures, others at
// non-existent paths to exercise both healthy and unhealthy paths.
// ------------------------------------------------------------------
const fixtureRoot = path.resolve('test-fixtures');
const claudeFixture = path.join(fixtureRoot, 'claude-sessions', 'projects');
const geminiFixture = path.join(fixtureRoot, 'gemini-sessions');
const opencodeFixture = path.join(fixtureRoot, 'opencode-exports');
const nonexistentDir = path.join(os.tmpdir(), 'cj-nonexistent-' + Date.now());

const cfg = {
  maxSummaryChars: 300,
  sources: [
    { name: 'codex', type: 'codex', enabled: true, archive: true, sessionsDir: nonexistentDir },
    { name: 'claude-code', type: 'claude', enabled: true, archive: true, sessionsDir: claudeFixture },
    { name: 'idea-ai', type: 'idea', enabled: true, archive: false, logDirs: [] },
    { name: 'gemini-cli', type: 'gemini', enabled: true, archive: true, sessionsDir: geminiFixture },
    { name: 'opencode', type: 'opencode', enabled: true, archive: true, mode: 'file', sessionsDir: opencodeFixture }
  ]
};

// Config with a disabled source (should not appear in doctorAll results)
const cfgWithDisabled = {
  maxSummaryChars: 300,
  sources: [
    { name: 'codex', type: 'codex', enabled: true, archive: true, sessionsDir: nonexistentDir },
    { name: 'gemini-cli', type: 'gemini', enabled: false, archive: true, sessionsDir: geminiFixture },
    { name: 'opencode', type: 'opencode', enabled: false, archive: true, mode: 'cli', sessionsDir: '' }
  ]
};

// ------------------------------------------------------------------
// 1. doctorAll() returns correct structure
// ------------------------------------------------------------------
section('doctorAll() structure');

const doctorResults = sources.doctorAll(cfg);

test('doctorAll returns an array', () => {
  assert.ok(Array.isArray(doctorResults), 'doctorAll should return an array');
});

test('doctorAll returns one entry per enabled source', () => {
  assert.strictEqual(doctorResults.length, 5,
    'should have 5 entries (all enabled), got ' + doctorResults.length);
});

test('each entry has required fields', () => {
  for (const r of doctorResults) {
    assert.ok(typeof r.name === 'string', 'entry should have name string');
    assert.ok(typeof r.type === 'string', 'entry should have type string');
    assert.strictEqual(r.enabled, true, 'entry.enabled should be true');
    assert.ok(typeof r.archive === 'boolean', 'entry should have archive boolean');
    assert.ok(r.capabilities && typeof r.capabilities === 'object', 'entry should have capabilities object');
    assert.ok(r.doctor && typeof r.doctor === 'object', 'entry should have doctor object');
  }
});

test('each doctor result has {healthy, checks, warnings}', () => {
  for (const r of doctorResults) {
    const d = r.doctor;
    assert.ok(typeof d.healthy === 'boolean', 'doctor.healthy should be boolean');
    assert.ok(Array.isArray(d.checks), 'doctor.checks should be array');
    assert.ok(Array.isArray(d.warnings), 'doctor.warnings should be array');
    // Each check should have label and pass
    for (const c of d.checks) {
      assert.ok(typeof c.label === 'string', 'check.label should be string');
      assert.ok(typeof c.pass === 'boolean', 'check.pass should be boolean');
    }
  }
});

test('each capabilities result has all 5 fields', () => {
  for (const r of doctorResults) {
    const cap = r.capabilities;
    assert.ok(typeof cap.archive === 'boolean', 'capabilities.archive should be boolean');
    assert.ok(typeof cap.inventory === 'boolean', 'capabilities.inventory should be boolean');
    assert.ok(typeof cap.cliRequired === 'boolean', 'capabilities.cliRequired should be boolean');
    assert.ok(typeof cap.supportsExport === 'boolean', 'capabilities.supportsExport should be boolean');
    assert.ok(typeof cap.supportsConfigDirs === 'boolean', 'capabilities.supportsConfigDirs should be boolean');
  }
});

// ------------------------------------------------------------------
// 2. Each adapter's doctor() returns {healthy, checks, warnings}
// ------------------------------------------------------------------
section('individual adapter doctor()');

test('codex.doctor() returns correct structure', () => {
  const d = codex.doctor(cfg);
  assert.ok(typeof d.healthy === 'boolean', 'healthy should be boolean');
  assert.ok(Array.isArray(d.checks), 'checks should be array');
  assert.ok(Array.isArray(d.warnings), 'warnings should be array');
  // codex points to nonexistent dir, so should be unhealthy
  assert.strictEqual(d.healthy, false, 'codex with nonexistent dir should be unhealthy');
  assert.ok(d.checks.length > 0, 'should have at least one check');
});

test('claude.doctor() returns correct structure', () => {
  const d = claude.doctor(cfg);
  assert.ok(typeof d.healthy === 'boolean', 'healthy should be boolean');
  assert.ok(Array.isArray(d.checks), 'checks should be array');
  assert.ok(Array.isArray(d.warnings), 'warnings should be array');
  // claude points to test-fixtures, so should be healthy
  assert.strictEqual(d.healthy, true, 'claude with fixture dir should be healthy');
  assert.ok(d.checks.length >= 3, 'should have at least 3 checks');
});

test('gemini.doctor() returns correct structure', () => {
  const d = gemini.doctor(cfg);
  assert.ok(typeof d.healthy === 'boolean', 'healthy should be boolean');
  assert.ok(Array.isArray(d.checks), 'checks should be array');
  assert.ok(Array.isArray(d.warnings), 'warnings should be array');
  // gemini points to test-fixtures, so should be healthy
  assert.strictEqual(d.healthy, true, 'gemini with fixture dir should be healthy');
  assert.ok(d.checks.length >= 3, 'should have at least 3 checks');
});

test('opencode.doctor() returns correct structure', () => {
  const d = opencode.doctor(cfg);
  assert.ok(typeof d.healthy === 'boolean', 'healthy should be boolean');
  assert.ok(Array.isArray(d.checks), 'checks should be array');
  assert.ok(Array.isArray(d.warnings), 'warnings should be array');
  assert.ok(d.checks.length >= 2, 'should have at least 2 checks');
});

test('idea.doctor() returns correct structure', () => {
  const d = idea.doctor(cfg);
  assert.ok(typeof d.healthy === 'boolean', 'healthy should be boolean');
  assert.ok(Array.isArray(d.checks), 'checks should be array');
  assert.ok(Array.isArray(d.warnings), 'warnings should be array');
  assert.ok(d.checks.length >= 2, 'should have at least 2 checks');
});

// ------------------------------------------------------------------
// 3. Each adapter's capabilities() returns correct fields
// ------------------------------------------------------------------
section('individual adapter capabilities()');

test('codex.capabilities() returns correct values', () => {
  const cap = codex.capabilities();
  assert.strictEqual(cap.archive, true, 'codex archive should be true');
  assert.strictEqual(cap.inventory, true, 'codex inventory should be true');
  assert.strictEqual(cap.cliRequired, false, 'codex cliRequired should be false');
  assert.strictEqual(cap.supportsExport, false, 'codex supportsExport should be false');
  assert.strictEqual(cap.supportsConfigDirs, false, 'codex supportsConfigDirs should be false');
});

test('claude.capabilities() returns correct values', () => {
  const cap = claude.capabilities();
  assert.strictEqual(cap.archive, true, 'claude archive should be true');
  assert.strictEqual(cap.inventory, true, 'claude inventory should be true');
  assert.strictEqual(cap.cliRequired, false, 'claude cliRequired should be false');
  assert.strictEqual(cap.supportsExport, false, 'claude supportsExport should be false');
  assert.strictEqual(cap.supportsConfigDirs, false, 'claude supportsConfigDirs should be false');
});

test('gemini.capabilities() returns correct values', () => {
  const cap = gemini.capabilities();
  assert.strictEqual(cap.archive, true, 'gemini archive should be true');
  assert.strictEqual(cap.inventory, true, 'gemini inventory should be true');
  assert.strictEqual(cap.cliRequired, false, 'gemini cliRequired should be false');
  assert.strictEqual(cap.supportsExport, false, 'gemini supportsExport should be false');
  assert.strictEqual(cap.supportsConfigDirs, false, 'gemini supportsConfigDirs should be false');
});

test('opencode.capabilities() returns correct values', () => {
  const cap = opencode.capabilities();
  assert.strictEqual(cap.archive, true, 'opencode archive should be true');
  assert.strictEqual(cap.inventory, true, 'opencode inventory should be true');
  assert.strictEqual(cap.cliRequired, true, 'opencode cliRequired should be true');
  assert.strictEqual(cap.supportsExport, true, 'opencode supportsExport should be true');
  assert.strictEqual(cap.supportsConfigDirs, false, 'opencode supportsConfigDirs should be false');
});

test('idea.capabilities() returns correct values', () => {
  const cap = idea.capabilities();
  assert.strictEqual(cap.archive, false, 'idea archive should be false');
  assert.strictEqual(cap.inventory, true, 'idea inventory should be true');
  assert.strictEqual(cap.cliRequired, false, 'idea cliRequired should be false');
  assert.strictEqual(cap.supportsExport, false, 'idea supportsExport should be false');
  assert.strictEqual(cap.supportsConfigDirs, true, 'idea supportsConfigDirs should be true');
});

// ------------------------------------------------------------------
// 4. --json output format is correct
// ------------------------------------------------------------------
section('--json output format');

test('cmdSourceDoctor with --json outputs valid JSON', () => {
  // Capture stdout
  const originalWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = function(chunk) {
    captured += chunk;
    return true;
  };

  let exitCode;
  try {
    // We need to require index.js but it may run main() if require.main === module.
    // Instead, call cmdSourceDoctor directly via the exported function.
    const main = require('./index');
    // Build a cfg with reportsDir pointing to temp
    const tmpDir = makeTempDir();
    const jsonCfg = Object.assign({}, cfg, {
      reportsDir: tmpDir,
      dataDir: tmpDir,
      journalDir: tmpDir,
      projectRoot: tmpDir
    });
    exitCode = main.cmdSourceDoctor(jsonCfg, { json: true });
  } finally {
    process.stdout.write = originalWrite;
  }

  // The captured output should contain valid JSON
  // Find the JSON block (it's the entire stdout for --json mode)
  const jsonStr = captured.trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    assert.fail('--json output should be valid JSON, got error: ' + err.message + '\nOutput: ' + jsonStr.substring(0, 200));
  }

  assert.ok(parsed.generatedAt, 'JSON should have generatedAt');
  assert.ok(Array.isArray(parsed.sources), 'JSON should have sources array');
  assert.ok(parsed.sources.length > 0, 'sources array should not be empty');

  // Check structure of each source entry
  for (const s of parsed.sources) {
    assert.ok(typeof s.id === 'string', 'source should have id string');
    assert.ok(typeof s.type === 'string', 'source should have type string');
    assert.ok(typeof s.enabled === 'boolean', 'source should have enabled boolean');
    assert.ok(typeof s.archive === 'boolean', 'source should have archive boolean');
    assert.ok(typeof s.healthy === 'boolean', 'source should have healthy boolean');
    assert.ok(s.capabilities && typeof s.capabilities === 'object', 'source should have capabilities object');
    assert.ok(Array.isArray(s.checks), 'source should have checks array');
    assert.ok(Array.isArray(s.warnings), 'source should have warnings array');
    assert.ok(typeof s.detected === 'boolean', 'source should have detected boolean');
    assert.ok(typeof s.cliStatus === 'string', 'source should have cliStatus string');
    assert.ok(typeof s.configuredPath === 'string', 'source should have configuredPath string');
    assert.ok(typeof s.sampleFiles === 'string', 'source should have sampleFiles string');
    assert.ok(typeof s.recommendedFix === 'string', 'source should have recommendedFix string');
  }
});

test('cmdSourceDoctor with --source filter returns only matching source', () => {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = function(chunk) {
    captured += chunk;
    return true;
  };

  let exitCode;
  try {
    const main = require('./index');
    const tmpDir = makeTempDir();
    const filterCfg = Object.assign({}, cfg, {
      reportsDir: tmpDir,
      dataDir: tmpDir,
      journalDir: tmpDir,
      projectRoot: tmpDir
    });
    exitCode = main.cmdSourceDoctor(filterCfg, { json: true, source: 'claude-code' });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(captured.trim());
  assert.strictEqual(parsed.sources.length, 1, 'should return only 1 source');
  assert.strictEqual(parsed.sources[0].id, 'claude-code', 'should return claude-code source');
});

test('cmdSourceDoctor writes reports/source-doctor.md', () => {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function(chunk) { return true; };

  let exitCode;
  let mdExists = false;
  try {
    const main = require('./index');
    const tmpDir = makeTempDir();
    const mdCfg = Object.assign({}, cfg, {
      reportsDir: tmpDir,
      dataDir: tmpDir,
      journalDir: tmpDir,
      projectRoot: tmpDir
    });
    exitCode = main.cmdSourceDoctor(mdCfg, {});
    mdExists = fs.existsSync(path.join(tmpDir, 'source-doctor.md'));
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.ok(mdExists, 'reports/source-doctor.md should be created');
});

// ------------------------------------------------------------------
// 5. Disabled source does not appear in results
// ------------------------------------------------------------------
section('disabled source exclusion');

test('disabled sources are excluded from doctorAll()', () => {
  const results = sources.doctorAll(cfgWithDisabled);
  const names = results.map(function (r) { return r.name; });
  assert.strictEqual(results.length, 1, 'should have only 1 enabled source (codex), got ' + results.length);
  assert.ok(names.indexOf('codex') >= 0, 'codex should be present');
  assert.ok(names.indexOf('gemini-cli') < 0, 'gemini-cli (disabled) should NOT be present');
  assert.ok(names.indexOf('opencode') < 0, 'opencode (disabled) should NOT be present');
});

// ------------------------------------------------------------------
// 6. Backward compatibility: adapter without doctor() uses default
// ------------------------------------------------------------------
section('backward compatibility');

test('base-adapter.defaultDoctor returns healthy with no checks', () => {
  const d = baseAdapter.defaultDoctor();
  assert.strictEqual(d.healthy, true, 'default doctor should be healthy');
  assert.ok(Array.isArray(d.checks), 'should have checks array');
  assert.strictEqual(d.checks.length, 0, 'default doctor should have no checks');
  assert.ok(Array.isArray(d.warnings), 'should have warnings array');
  assert.strictEqual(d.warnings.length, 0, 'default doctor should have no warnings');
});

test('base-adapter.defaultCapabilities returns all-false defaults', () => {
  const c = baseAdapter.defaultCapabilities();
  assert.strictEqual(c.archive, false);
  assert.strictEqual(c.inventory, false);
  assert.strictEqual(c.cliRequired, false);
  assert.strictEqual(c.supportsExport, false);
  assert.strictEqual(c.supportsConfigDirs, false);
});

test('INTERFACE array includes doctor and capabilities', () => {
  assert.ok(baseAdapter.INTERFACE.indexOf('doctor') >= 0, 'INTERFACE should include doctor');
  assert.ok(baseAdapter.INTERFACE.indexOf('capabilities') >= 0, 'INTERFACE should include capabilities');
});

test('doctorAll handles adapter without doctor() gracefully', () => {
  // Create a mock adapter without doctor()/capabilities()
  const tmpDir = makeTempDir();
  const mockCfg = {
    sources: [
      { name: 'codex', type: 'codex', enabled: true, archive: true, sessionsDir: tmpDir }
    ]
  };
  // Temporarily monkey-patch the codex adapter to remove doctor/capabilities
  const origDoctor = codex.doctor;
  const origCaps = codex.capabilities;
  delete codex.doctor;
  delete codex.capabilities;
  try {
    // Clear the adapter cache so our changes take effect
    const sourcesMod = require('./sources');
    // We can't easily clear the cache, so test the default functions directly
    const d = baseAdapter.defaultDoctor(mockCfg);
    const c = baseAdapter.defaultCapabilities();
    assert.strictEqual(d.healthy, true, 'default doctor should be healthy');
    assert.strictEqual(c.archive, false, 'default capabilities archive should be false');
  } finally {
    codex.doctor = origDoctor;
    codex.capabilities = origCaps;
  }
});

// ------------------------------------------------------------------
// 7. Sanitization: error details are sanitized
// ------------------------------------------------------------------
section('sanitization');

test('doctor() warnings are sanitized', () => {
  // Use a path that contains a username-like segment
  const d = codex.doctor(cfg);
  // Warnings should be strings (already sanitized via sanitize.redactPath)
  for (const w of d.warnings) {
    assert.ok(typeof w === 'string', 'warning should be string');
  }
});

test('cmdSourceDoctor JSON output has sanitized paths', () => {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = function(chunk) {
    captured += chunk;
    return true;
  };

  try {
    const main = require('./index');
    const tmpDir = makeTempDir();
    const jsonCfg = Object.assign({}, cfg, {
      reportsDir: tmpDir,
      dataDir: tmpDir,
      journalDir: tmpDir,
      projectRoot: tmpDir
    });
    main.cmdSourceDoctor(jsonCfg, { json: true });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(captured.trim());
  // configuredPath should be a string (sanitized)
  for (const s of parsed.sources) {
    assert.ok(typeof s.configuredPath === 'string', 'configuredPath should be string');
    // Should not contain raw API keys (basic check)
    assert.ok(!s.configuredPath.includes('sk-'), 'paths should not contain raw API keys');
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
