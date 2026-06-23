'use strict';

// src/console.smoke.test.js
//
// UI regression smoke test for CodexJournal-Lite console.
// Verifies static files and API structure without starting a server.
// Uses Node.js built-in assert only. No external dependencies.
//
// Run via: `node src/console.smoke.test.js`

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'console', 'public');
const SERVER_FILE = path.join(PROJECT_ROOT, 'console', 'server.js');

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

// ------------------------------------------------------------------
// 1. index.html: no hardcoded old version
// ------------------------------------------------------------------
section('index.html version check');

const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

test('index.html does not hardcode v1.1.x', () => {
  assert.ok(!/v1\.1\.\d/.test(indexHtml),
    'index.html should not contain hardcoded v1.1.x version');
});

// ------------------------------------------------------------------
// 2. CSS: light theme input not dark
// ------------------------------------------------------------------
section('CSS light theme input background');

const styleCss = fs.readFileSync(path.join(PUBLIC_DIR, 'style.css'), 'utf8');

test('light theme defines --input-bg variable', () => {
  var lightSection = styleCss.match(/\[data-theme="light"\]\s*\{([^}]+)\}/);
  assert.ok(lightSection, 'light theme section should exist');
  assert.ok(lightSection[1].includes('--input-bg'),
    'light theme should define --input-bg variable');
});

test('input[type=search] does not use --code as background', () => {
  var inputRule = styleCss.match(/input\[type=search\]\s*\{([^}]+)\}/);
  assert.ok(inputRule, 'input[type=search] rule should exist');
  assert.ok(!inputRule[1].includes('background: var(--code)'),
    'input[type=search] should not use var(--code) as background');
});

test('input[type=search] uses --input-bg', () => {
  var inputRule = styleCss.match(/input\[type=search\]\s*\{([^}]+)\}/);
  assert.ok(inputRule, 'input[type=search] rule should exist');
  assert.ok(inputRule[1].includes('var(--input-bg)'),
    'input[type=search] should use var(--input-bg) as background');
});

// ------------------------------------------------------------------
// 3. server.js: /api/dashboard structure
// ------------------------------------------------------------------
section('server.js dashboard structure');

const serverSrc = fs.readFileSync(SERVER_FILE, 'utf8');

test('server.js returns project version in dashboard', () => {
  assert.ok(serverSrc.includes('version') && serverSrc.includes('pkg'),
    'dashboard should return project version from package.json');
});

test('server.js returns byDay in dashboard', () => {
  assert.ok(serverSrc.includes('byDay'),
    'dashboard should return byDay data');
});

test('server.js returns topKw in dashboard', () => {
  assert.ok(serverSrc.includes('topKw'),
    'dashboard should return topKw (top keywords)');
});

// ------------------------------------------------------------------
// 4. server.js: search field support
// ------------------------------------------------------------------
section('server.js search field support');

test('server.js imports searchQuery module', () => {
  assert.ok(serverSrc.includes('searchQuery'),
    'server.js should reference searchQuery module');
});

test('server.js has /api/search endpoint', () => {
  assert.ok(serverSrc.includes('/api/search'),
    'server.js should have /api/search endpoint');
});

test('server.js has /api/v1/search endpoint', () => {
  assert.ok(serverSrc.includes('/api/v1/search'),
    'server.js should have /api/v1/search endpoint');
});

// ------------------------------------------------------------------
// 5. server.js: journal API error handling
// ------------------------------------------------------------------
section('server.js journal API error handling');

test('journal API validates date format', () => {
  assert.ok(serverSrc.includes('\\d{4}-\\d{2}-\\d{2}'),
    'journal API should validate YYYY-MM-DD date format');
});

test('journal API returns error for missing file', () => {
  assert.ok(serverSrc.includes('no such journal file') || serverSrc.includes('404'),
    'journal API should return error for missing file');
});

// ------------------------------------------------------------------
// 6. app.js: journal empty/error states
// ------------------------------------------------------------------
section('app.js journal states');

const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');

test('app.js has journal empty state', () => {
  assert.ok(appJs.includes('No journal entries') || appJs.includes('md-empty'),
    'app.js should handle empty journal state');
});

test('app.js has journal error state', () => {
  assert.ok(appJs.includes('Failed to load journal') || appJs.includes('md-error'),
    'app.js should handle journal load error');
});

// ------------------------------------------------------------------
// 7. app.js: heatmap adaptive cell size
// ------------------------------------------------------------------
section('app.js heatmap variables');

test('app.js uses adaptive cell size based on weeks', () => {
  assert.ok(appJs.includes('weeks <= 12'),
    'app.js should have adaptive cell size for 12 weeks');
  assert.ok(appJs.includes('weeks <= 26'),
    'app.js should have adaptive cell size for 26 weeks');
});

test('app.js heatmap cols = weeks + 1 (not weeks * 7)', () => {
  assert.ok(appJs.includes('var cols = weeks + 1'),
    'app.js should have cols = weeks + 1 (fixed heatmap bug)');
  assert.ok(!appJs.includes('var cols = weeks * 7'),
    'app.js should NOT have cols = weeks * 7 (old bug)');
});

// ------------------------------------------------------------------
// 8. CSS: heatmap tooltip and dashboard variables
// ------------------------------------------------------------------
section('CSS dashboard variables');

test('CSS defines --heatmap-cell-size', () => {
  assert.ok(styleCss.includes('--heatmap-cell-size'),
    'CSS should define --heatmap-cell-size variable');
});

test('CSS defines --dashboard-max-width', () => {
  assert.ok(styleCss.includes('--dashboard-max-width'),
    'CSS should define --dashboard-max-width variable');
});

test('CSS has heatmap tooltip style', () => {
  assert.ok(styleCss.includes('.heatmap-tooltip'),
    'CSS should have .heatmap-tooltip style');
});

// ------------------------------------------------------------------
// 9. app.js: renderKeywords function
// ------------------------------------------------------------------
section('app.js keywords rendering');

test('app.js has renderKeywords function', () => {
  assert.ok(appJs.includes('function renderKeywords'),
    'app.js should have renderKeywords function for Top Keywords');
});

// ------------------------------------------------------------------
// 10. server.js: dashboard API enhancements
// ------------------------------------------------------------------
section('server.js dashboard API');

test('server.js buildDashboard returns weekStats', () => {
  assert.ok(serverSrc.includes('weekStats'),
    'server.js should return weekStats in dashboard');
});

test('server.js buildDashboard returns streak', () => {
  assert.ok(serverSrc.includes('streak'),
    'server.js should return streak in dashboard');
});

test('server.js buildDashboard returns sourceDistribution', () => {
  assert.ok(serverSrc.includes('sourceDistribution'),
    'server.js should return sourceDistribution in dashboard');
});

test('server.js buildDashboard returns topProjects', () => {
  assert.ok(serverSrc.includes('topProjects'),
    'server.js should return topProjects in dashboard');
});

test('server.js has /api/v1/source-doctor endpoint', () => {
  assert.ok(serverSrc.includes('/api/v1/source-doctor'),
    'server.js should have /api/v1/source-doctor endpoint');
});

// ------------------------------------------------------------------
// 11. server.js: security headers
// ------------------------------------------------------------------
section('server.js security headers');

test('server.js has setSecurityHeaders function', () => {
  assert.ok(serverSrc.includes('setSecurityHeaders'),
    'server.js should have setSecurityHeaders function');
  assert.ok(!serverSrc.includes('function setCors('),
    'server.js should not have old setCors function');
});

test('server.js sets Content-Security-Policy header', () => {
  assert.ok(serverSrc.includes('Content-Security-Policy'),
    'server.js should set Content-Security-Policy header');
});

test('server.js sets Referrer-Policy header', () => {
  assert.ok(serverSrc.includes('Referrer-Policy'),
    'server.js should set Referrer-Policy header');
});

test('server.js sets X-Frame-Options header', () => {
  assert.ok(serverSrc.includes('X-Frame-Options'),
    'server.js should set X-Frame-Options header');
});

// ------------------------------------------------------------------
// 12. app.js: search UX enhancements
// ------------------------------------------------------------------
section('app.js search UX');

test('app.js has search help toggle', () => {
  assert.ok(appJs.includes('search-help') || appJs.includes('searchHelp'),
    'app.js should have search help panel');
});

test('app.js has search chips', () => {
  assert.ok(appJs.includes('search-chips') || appJs.includes('searchChips') || appJs.includes('quick-filter'),
    'app.js should have search filter chips');
});

test('app.js has saved searches (localStorage)', () => {
  assert.ok(appJs.includes('cjl-saved-searches') || appJs.includes('savedSearch'),
    'app.js should have saved searches with localStorage');
});

test('app.js has project activity rendering', () => {
  assert.ok(appJs.includes('renderProjectActivity') || appJs.includes('project-activity'),
    'app.js should have project activity rendering');
});

test('app.js has enhanced highlight function', () => {
  assert.ok(appJs.includes('function highlight'),
    'app.js should have highlight function');
});

// ------------------------------------------------------------------
// 13. index.html: new UI elements
// ------------------------------------------------------------------
section('index.html UI elements');

const htmlSrc = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

test('index.html has project activity panel', () => {
  assert.ok(htmlSrc.includes('project-activity') || htmlSrc.includes('projectActivity'),
    'index.html should have project activity panel');
});

test('index.html has search help button', () => {
  assert.ok(htmlSrc.includes('search-help') || htmlSrc.includes('searchHelp'),
    'index.html should have search help button');
});

test('index.html has no hardcoded old version', () => {
  assert.ok(!htmlSrc.includes('v1.1.2'),
    'index.html should not contain v1.1.2');
  assert.ok(!htmlSrc.includes('v0.5.2'),
    'index.html should not contain v0.5.2');
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
