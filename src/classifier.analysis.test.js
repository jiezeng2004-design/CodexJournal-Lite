'use strict';

const classifier = require('./classifier');
const analysis = require('./analysis');

let passed = 0;
let failed = 0;
const failures = [];

function check(label, cond, detail) {
  if (cond) {
    passed += 1;
    process.stdout.write('  [PASS] ' + label + '\n');
    return;
  }

  failed += 1;
  failures.push({ label, detail: detail || '(no detail)' });
  process.stdout.write(
    '  [FAIL] ' + label + (detail ? ' :: ' + detail : '') + '\n'
  );
}

function section(name) {
  process.stdout.write('\n--- ' + name + ' ---\n');
}

section('classifyText');
const classificationFixtures = [
  ['thesis', 'Need a thesis chapter on drought gene analysis.'],
  ['document', 'Please fix the .docx formatting and markdown export.'],
  ['zotero', 'Update Zotero citations and the BibTeX references.'],
  ['openclaw', 'OpenClaw dashboard on 127.0.0.1:1879 is broken.'],
  ['codex', 'Codex computer use setup refresh failed again.'],
  ['frontend', 'React page layout is broken on localhost:3000.'],
  ['environment', 'PowerShell port permission error in npm.'],
  ['code', 'Python class import function script.py needs a fix.']
];

for (const [expected, text] of classificationFixtures) {
  check(
    'classifyText identifies ' + expected,
    classifier.classifyText(text) === expected,
    'got ' + classifier.classifyText(text)
  );
}

check(
  'classifyText falls back to general for empty input',
  classifier.classifyText('') === 'general',
  'got ' + classifier.classifyText('')
);

section('tokenize and topKeywords');
const tokens = classifier.tokenize(
  'React react localhost:3000 file.js thesis thesis markdown .md'
);
check(
  'tokenize keeps deterministic English and extension tokens',
  JSON.stringify(tokens) ===
    JSON.stringify([
      'react',
      'react',
      'localhost',
      'file.js',
      'thesis',
      'thesis',
      'markdown',
      '.js',
      '.md'
    ]),
  JSON.stringify(tokens)
);

const topKeywords = classifier.topKeywords(
  'React react localhost:3000 file.js thesis thesis markdown .md',
  5
);
check(
  'topKeywords sorts by count then token string',
  JSON.stringify(topKeywords) ===
    JSON.stringify([
      { token: 'react', count: 2 },
      { token: 'thesis', count: 2 },
      { token: '.js', count: 1 },
      { token: '.md', count: 1 },
      { token: 'file.js', count: 1 }
    ]),
  JSON.stringify(topKeywords)
);

section('deriveTaskTypeAndKeywords');
const derivedFromUser = classifier.deriveTaskTypeAndKeywords(
  'React bug in localhost:3000 page',
  'Python fallback should not be used'
);
check(
  'deriveTaskTypeAndKeywords prefers user text for classification',
  derivedFromUser.taskType === 'frontend',
  JSON.stringify(derivedFromUser)
);
check(
  'deriveTaskTypeAndKeywords extracts stable top keywords from user text',
  JSON.stringify(derivedFromUser.keywords) ===
    JSON.stringify(['bug', 'localhost', 'page', 'react']),
  JSON.stringify(derivedFromUser.keywords)
);

const derivedFromAssistant = classifier.deriveTaskTypeAndKeywords(
  '',
  'Need thesis chapter edits and gene review'
);
check(
  'deriveTaskTypeAndKeywords falls back to assistant text when user text is empty',
  derivedFromAssistant.taskType === 'thesis',
  JSON.stringify(derivedFromAssistant)
);

section('buildPatterns');
const tasks = [
  {
    id: '1',
    date: '2026-06-01',
    time: '09:15',
    taskType: 'frontend',
    source: 'codex-sessions',
    projectPath: 'C:/Users/alice/app',
    keywords: ['react', 'vite'],
    messageCount: 5,
    title: 'Build UI',
    rawFilePath: 'C:/raw/1'
  },
  {
    id: '2',
    date: '2026-06-15',
    time: '20:40',
    taskType: 'frontend',
    source: 'codex-sessions',
    projectPath: 'https://example.com/project',
    keywords: ['react', 'css'],
    messageCount: 7,
    title: 'Fix CSS',
    rawFilePath: 'C:/raw/2'
  },
  {
    id: '3',
    date: '2026-07-04',
    time: '01:20',
    taskType: 'environment',
    source: 'idea',
    projectPath: 'app://codex',
    keywords: ['powershell'],
    messageCount: 2,
    title: 'Fix shell',
    rawFilePath: 'C:/raw/3'
  }
];

const patterns = analysis.buildPatterns(tasks);
check('buildPatterns counts totals.tasks', patterns.totals.tasks === 3, JSON.stringify(patterns.totals));
check('buildPatterns counts totals.messages', patterns.totals.messages === 14, JSON.stringify(patterns.totals));
check(
  'buildPatterns groups months deterministically',
  JSON.stringify(patterns.byMonth) === JSON.stringify({ '2026-06': 2, '2026-07': 1 }),
  JSON.stringify(patterns.byMonth)
);
check(
  'buildPatterns groups years deterministically',
  JSON.stringify(patterns.byYear) === JSON.stringify({ '2026': 3 }),
  JSON.stringify(patterns.byYear)
);
check(
  'buildPatterns counts task types',
  JSON.stringify(patterns.byTaskType) === JSON.stringify({ frontend: 2, environment: 1 }),
  JSON.stringify(patterns.byTaskType)
);
check(
  'buildPatterns filters non-local project paths from byProjectPath',
  JSON.stringify(patterns.byProjectPath) ===
    JSON.stringify({ 'C:/Users/alice/app': 1 }),
  JSON.stringify(patterns.byProjectPath)
);
check(
  'buildPatterns aggregates top keywords',
  JSON.stringify(patterns.topKeywords) ===
    JSON.stringify({ react: 2, css: 1, powershell: 1, vite: 1 }),
  JSON.stringify(patterns.topKeywords)
);
check(
  'buildPatterns buckets time of day',
  JSON.stringify(patterns.timeOfDay) ===
    JSON.stringify({
      morning: 1,
      afternoon: 0,
      evening: 1,
      lateNight: 1,
      unknown: 0
    }),
  JSON.stringify(patterns.timeOfDay)
);

section('groupByMonth and groupByYear');
const monthly = analysis.groupByMonth(tasks);
check('groupByMonth returns sorted month buckets', monthly[0].month === '2026-06' && monthly[1].month === '2026-07', JSON.stringify(monthly));
check('groupByMonth keeps both June tasks together', monthly[0].tasks.length === 2, JSON.stringify(monthly[0]));

const yearly = analysis.groupByYear(tasks);
check('groupByYear returns a single 2026 bucket', yearly.length === 1 && yearly[0].year === '2026', JSON.stringify(yearly));
check('groupByYear keeps all tasks in the year bucket', yearly[0].tasks.length === 3, JSON.stringify(yearly[0]));

section('result');
process.stdout.write('\n');
process.stdout.write('passed: ' + passed + '\n');
process.stdout.write('failed: ' + failed + '\n');

if (failed > 0) {
  process.stdout.write('\nFAILURES:\n');
  for (const failure of failures) {
    process.stdout.write(
      '  - ' + failure.label + ' :: ' + failure.detail + '\n'
    );
  }
  process.exit(1);
}

process.exit(0);
