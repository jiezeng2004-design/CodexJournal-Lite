'use strict';

// src/sanitize.test.js
//
// Offline regression tests for the redaction layer.
// Uses Node.js built-in assert only. No test framework, no npm dependencies.
//
// Run via: `npm run test:sanitize`
//
// Contract:
//   - exit 0 on success
//   - exit 1 on any failed assertion
//   - never makes network calls
//   - never writes outside the project root

const assert = require('assert');
const sanitize = require('./sanitize');

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
    failures.push({ name, message: err.message });
    process.stdout.write('  [FAIL] ' + name + ' :: ' + err.message + '\n');
  }
}

function section(title) {
  process.stdout.write('\n--- ' + title + ' ---\n');
}

// ------------------------------------------------------------------
// Helpers: inject a fake username for deterministic testing
// ------------------------------------------------------------------
const FAKE_USER = 'test_fixture_user';
const opts = { localUserNames: [FAKE_USER] };

// ------------------------------------------------------------------
// 1. OpenAI-style API key
// ------------------------------------------------------------------
section('OpenAI-style API keys');

test('sk-xxx key is redacted', () => {
  const input = 'my key is sk-proj-FAKExxxxFAKExxxxFAKExxxxFAKExxxxFAKE';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('sk-proj-FAKExxxxFAKExxxxFAKExxxxFAKExxxxFAKE'),
    'full key leaked');
  assert.ok(out.includes('sk-' + sanitize.REDACTED),
    'should preserve sk- prefix with REDACTED');
  assert.ok(out.includes('my key is'),
    'should preserve surrounding text');
});

test('sk- key with dash and underscore chars', () => {
  const input = 'export KEY=sk-live_FAKE123_FAKE456_FAKE789';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('sk-live_FAKE123_FAKE456_FAKE789'));
  assert.ok(out.includes('sk-' + sanitize.REDACTED));
});

// ------------------------------------------------------------------
// 2-4. Provider-specific env-var keys
// ------------------------------------------------------------------
section('Provider env-var API keys');

test('ANTHROPIC_API_KEY value is removed', () => {
  const input = 'ANTHROPIC_API_KEY=sk-FAKE-KEY-DATA-FOR-TESTING-123';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('sk-FAKE-KEY-DATA-FOR-TESTING-123'));
  assert.ok(out.includes(sanitize.REDACTED));
});

test('GEMINI_API_KEY value is removed', () => {
  const input = 'set GEMINI_API_KEY=AIzaFAKEDummyKeyValue1234567890abcdef';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('AIzaFAKEDummyKeyValue1234567890abcdef'));
  assert.ok(out.includes(sanitize.REDACTED));
});

test('AZURE_OPENAI_API_KEY value is removed', () => {
  const input = 'AZURE_OPENAI_API_KEY=FAKEkey1234567890FAKEkey1234567890';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('FAKEkey1234567890FAKEkey1234567890'));
  assert.ok(out.includes(sanitize.REDACTED));
});

// ------------------------------------------------------------------
// 5. Bearer Authorization header
// ------------------------------------------------------------------
section('Bearer tokens');

test('Bearer token in text is redacted', () => {
  const input = 'Authorization: Bearer FAKE_JWT_HEADER.FAKE_JWT_PAYLOAD.FAKE_SIGNATURE';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('FAKE_JWT_HEADER.FAKE_JWT_PAYLOAD.FAKE_SIGNATURE'));
  assert.ok(out.includes(sanitize.REDACTED));
});

// ------------------------------------------------------------------
// 6. Authorization header value
// ------------------------------------------------------------------
section('Authorization header values');

test('authorization= value triggers pattern', () => {
  const input = 'authorization=Bearer mysecrettokenvalue';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('mysecrettokenvalue'));
  assert.ok(out.includes(sanitize.REDACTED));
});

// ------------------------------------------------------------------
// 7. Cookie / Set-Cookie / session / connect.sid
// ------------------------------------------------------------------
section('Cookie and session identifiers');

test('Set-Cookie value is redacted', () => {
  const input = 'Set-Cookie: sessionToken=FAKEabc123; Path=/; HttpOnly';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('sessionToken=FAKEabc123'));
  assert.ok(out.includes('Set-Cookie'));
});

test('connect.sid value is redacted', () => {
  const input = 'connect.sid=s%3AFAKEabc123def456FAKExyz789';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('s%3AFAKEabc123def456FAKExyz789'));
  assert.ok(out.includes(sanitize.REDACTED));
});

test('sessionid assignment is redacted', () => {
  const input = 'sessionid=FAKEabc123def456ghi789jkl012';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('FAKEabc123def456ghi789jkl012'));
  assert.ok(out.includes(sanitize.REDACTED));
});

// ------------------------------------------------------------------
// 8. GitHub personal access tokens
// ------------------------------------------------------------------
section('GitHub PATs');

test('ghp_ token is fully redacted', () => {
  const input = 'token ghp_xxxxxFAKExxxxxFAKExxxxxFAKExxxxxFAKE12';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('ghp_xxxxxFAKExxxxxFAKExxxxxFAKExxxxxFAKE12'));
  assert.ok(out.includes(sanitize.REDACTED));
});

test('gho_ uppercase token is redacted (case-insensitive)', () => {
  const input = 'GHO_xxxxxFAKExxxxxFAKExxxxxFAKExxxxxFAKE12';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('GHO_xxxxxFAKExxxxxFAKExxxxxFAKExxxxxFAKE12'));
  assert.ok(out.includes(sanitize.REDACTED));
});

// ------------------------------------------------------------------
// 9. Slack tokens
// ------------------------------------------------------------------
section('Slack tokens');

test('xoxb- Slack-like token is redacted', () => {
  const input = 'xoxb-FAKExxxxFAKExxxx-FAKExxxxFAKExxxx-abcFAKExxxghi';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('xoxb-FAKExxxxFAKExxxx-FAKExxxxFAKExxxx-abcFAKExxxghi'));
  assert.ok(out.includes(sanitize.REDACTED));
});

// ------------------------------------------------------------------
// 10. Windows username path redaction
// ------------------------------------------------------------------
section('Windows username paths');

test('C:\\Users\\username\\ path is redacted to <USER>', () => {
  const input = 'working directory: C:\\Users\\' + FAKE_USER + '\\project\\src';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes(FAKE_USER), 'username should not appear literally');
  assert.ok(out.includes(sanitize.USER_PLACEHOLDER), 'should contain <USER> placeholder');
  assert.ok(out.includes('Users\\'), 'should preserve Users\\ prefix');
  assert.ok(out.includes('working directory:'), 'should preserve context');
});

test('C:/Users/username/ forward-slash path is redacted', () => {
  const input = 'path: C:/Users/' + FAKE_USER + '/codex/sessions';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes(FAKE_USER));
  assert.ok(out.includes(sanitize.USER_PLACEHOLDER));
  assert.ok(out.includes('Users/'));
});

test('JSON double-escape Windows path is redacted', () => {
  const input = '"rawFilePath": "C:\\\\Users\\\\' + FAKE_USER + '\\\\sessions\\\\file.jsonl"';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes(FAKE_USER));
  assert.ok(out.includes(sanitize.USER_PLACEHOLDER));
  assert.ok(out.includes('rawFilePath'));
});

// ------------------------------------------------------------------
// 11. token=xxx / api_key=xxx / access_token=xxx patterns
// ------------------------------------------------------------------
section('Key-value credential patterns');

test('token= with long value is redacted', () => {
  const input = 'token=ABCDEF1234567890abcdef1234567890ABCDEF12';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('ABCDEF1234567890abcdef1234567890ABCDEF12'));
  assert.ok(out.includes(sanitize.REDACTED));
});

test('API_KEY= sk- value is removed', () => {
  const input = 'API_KEY=sk-1234567890abcdef';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('sk-1234567890abcdef'));
  assert.ok(out.includes(sanitize.REDACTED));
});

test('apikey: assignment matches api-key pattern', () => {
  const input = 'apikey = myPlainTextKeyValueHere123';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('myPlainTextKeyValueHere123'));
  assert.ok(out.includes(sanitize.REDACTED));
});

// ------------------------------------------------------------------
// 12. JSON object deep redaction
// ------------------------------------------------------------------
section('JSON object deep redaction');

test('redactObjectDeep removes sensitive fields', () => {
  const input = {
    title: 'normal task',
    token: 'sk-SECRETKEY123',
    api_key: 'my-secret-value',
    access_token: 'ghp_FAKExxxxFAKExxxxFAKExxxxFAKExxxxFAKE12',
    cookie: 'sessionId=abc123',
    nested: {
      refresh_token: 'r_fake_secret_val',
      harmless: 'keep me'
    }
  };
  const out = sanitize.redactObjectDeep(input, opts);
  assert.strictEqual(out.token, sanitize.REDACTED, 'token field should be REDACTED');
  assert.strictEqual(out.api_key, sanitize.REDACTED, 'api_key field should be REDACTED');
  assert.strictEqual(out.access_token, sanitize.REDACTED, 'access_token should be REDACTED');
  assert.strictEqual(out.cookie, sanitize.REDACTED, 'cookie should be REDACTED');
  assert.strictEqual(out.nested.refresh_token, sanitize.REDACTED, 'nested refresh_token should be REDACTED');
  assert.strictEqual(out.nested.harmless, 'keep me', 'harmless fields should be preserved');
  assert.strictEqual(out.title, 'normal task', 'title should be preserved');
});

// ------------------------------------------------------------------
// 13. Generic api-key-assignment
// ------------------------------------------------------------------
section('Generic API key assignments');

test('api_key bare assignment is redacted', () => {
  const input = 'api_key = s3cr3tK3yTh4tN0b0dySh0uldS33';
  const out = sanitize.redactText(input, opts);
  assert.ok(!out.includes('s3cr3tK3yTh4tN0b0dySh0uldS33'));
  assert.ok(out.includes(sanitize.REDACTED));
});

// ------------------------------------------------------------------
// 14. RedactPath wrapper (passes opts for CI-safe testing)
// ------------------------------------------------------------------
section('redactPath wrapper');

test('redactPath redacts username in path', () => {
  const input = 'C:\\Users\\' + FAKE_USER + '\\sessions\\session.jsonl';
  const out = sanitize.redactPath(input, opts);
  assert.ok(!out.includes(FAKE_USER));
  assert.ok(out.includes(sanitize.USER_PLACEHOLDER));
});

// ------------------------------------------------------------------
// 15. Non-sensitive text is unchanged
// ------------------------------------------------------------------
section('Non-sensitive text preservation');

test('ordinary text passes through unchanged', () => {
  const input = 'Hello world, this is a normal sentence with no secrets.';
  const out = sanitize.redactText(input, opts);
  assert.strictEqual(out, input);
});

test('code with no credentials is preserved', () => {
  const input = 'const x = 42;\nconsole.log(x);';
  const out = sanitize.redactText(input, opts);
  assert.strictEqual(out, input);
});

// ------------------------------------------------------------------
// redactWithDiff
// ------------------------------------------------------------------
section('redactWithDiff');

test('redactWithDiff redacts API key and returns diffs', function () {
  const input = ['OPENAI', 'API', 'KEY'].join('_') + '=' +
    ['sk-proj', 'abcdef1234567890'].join('-');
  const result = sanitize.redactWithDiff(input);
  assert.ok(result.diffs.length > 0, 'should have at least 1 diff');
  assert.ok(result.redacted.indexOf('sk-proj-abcdef1234567890') < 0, 'redacted should not contain secret');
  assert.ok(result.redacted.indexOf('<REDACTED>') >= 0, 'redacted should contain REDACTED placeholder');
});

test('redactWithDiff returns empty diffs for clean text', function () {
  const input = 'This is a clean message with no secrets.';
  const result = sanitize.redactWithDiff(input);
  assert.strictEqual(result.diffs.length, 0, 'should have 0 diffs');
  assert.strictEqual(result.redacted, input);
});

test('redactWithDiff handles custom redactPatterns', function () {
  sanitize.setCustomPatterns([
    { name: 'internal-code', pattern: 'PROJ-[A-Z0-9]+', replacement: '<REDACTED>', flags: 'gi' }
  ]);
  const input = 'Working on PROJ-X42 and PROJ-Y99';
  const result = sanitize.redactWithDiff(input);
  assert.ok(result.diffs.length > 0, 'should have diffs for custom patterns');
  assert.ok(result.redacted.indexOf('PROJ-X42') < 0, 'should not contain PROJ-X42');
  assert.ok(result.redacted.indexOf('PROJ-Y99') < 0, 'should not contain PROJ-Y99');
  // Reset custom patterns
  sanitize.setCustomPatterns([]);
});

test('redactWithDiff redacts macOS /Users/ paths', function () {
  const input = 'File located at /Users/fakeuser/project/app.js';
  const result = sanitize.redactWithDiff(input, { localUserNames: ['fakeuser'] });
  assert.ok(result.redacted.indexOf('fakeuser') < 0, 'should not contain username');
  assert.ok(result.redacted.indexOf('<USER>') >= 0, 'should contain USER placeholder');
});

// ------------------------------------------------------------------
// sanitizeTaskWithDiff
// ------------------------------------------------------------------
section('sanitizeTaskWithDiff');

test('sanitizeTaskWithDiff returns redaction summary without secrets', function () {
  const task = {
    id: 'test_1',
    title: 'Fix login page',
    userSummary: 'My API key is sk-proj-test1234567890abcdef',
    assistantSummary: 'I will help you fix the login page.',
    projectPath: '/Users/testuser/project',
    rawFilePath: '/Users/testuser/project/login.js',
    taskType: 'frontend',
    source: 'test',
    date: '2026-01-01',
    time: '10:00',
    keywords: ['login'],
    messageCount: 2,
    firstTimestamp: '2026-01-01T10:00:00.000Z',
    lastTimestamp: '2026-01-01T10:05:00.000Z'
  };
  const result = sanitize.sanitizeTaskWithDiff(task);
  assert.ok(typeof result.redactionCount === 'number', 'redactionCount should be a number');
  assert.ok(Array.isArray(result.patternNames), 'patternNames should be an array');
  assert.ok(result.task.userSummary.indexOf('sk-proj-test1234567890abcdef') < 0, 'userSummary should not contain API key');
});

test('sanitizeTaskWithDiff handles null task', function () {
  const result = sanitize.sanitizeTaskWithDiff(null);
  assert.strictEqual(result.redactionCount, 0);
  assert.strictEqual(result.patternNames.length, 0);
});

// ------------------------------------------------------------------
// redactKeywords
// ------------------------------------------------------------------
section('redactKeywords');

test('redactKeywords filters credential-like tokens', function () {
  const kws = ['login', 'sk-test1234567890abcdef', 'frontend', 'api_key', 'password'];
  const result = sanitize.redactKeywords(kws);
  assert.ok(result.indexOf('sk-test1234567890abcdef') < 0, 'should remove sk- token');
  assert.ok(result.indexOf('api_key') < 0, 'should remove api_key');
  assert.ok(result.indexOf('password') < 0, 'should remove password');
  assert.ok(result.indexOf('login') >= 0, 'should keep login');
  assert.ok(result.indexOf('frontend') >= 0, 'should keep frontend');
});

test('redactKeywords redacts via redactText first', function () {
  const kws = ['sk-proj-abc123', 'normal'];
  const result = sanitize.redactKeywords(kws);
  assert.ok(result.indexOf('sk-proj-abc123') < 0, 'should redact sk-proj');
  assert.ok(result.indexOf('normal') >= 0, 'should keep normal');
});

test('isCredentialKeyword matches credential tokens', function () {
  assert.ok(sanitize.isCredentialKeyword('sk-test123'));
  assert.ok(sanitize.isCredentialKeyword('ghp_xxxxxxxx'));
  assert.ok(sanitize.isCredentialKeyword('xoxb-xxx'));
  assert.ok(sanitize.isCredentialKeyword('token'));
  assert.ok(sanitize.isCredentialKeyword('api_key'));
  assert.ok(!sanitize.isCredentialKeyword('login'));
  assert.ok(!sanitize.isCredentialKeyword('frontend'));
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
