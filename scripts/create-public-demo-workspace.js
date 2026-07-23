'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const index = argv.indexOf('--out');
  if (index < 0 || !argv[index + 1]) {
    throw new Error('Usage: node scripts/create-public-demo-workspace.js --out <empty-directory>');
  }
  return { outDir: path.resolve(argv[index + 1]) };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value.replace(/\r?\n/g, '\n'), 'utf8');
}

function makeTask(spec, index) {
  const day = String(spec.day).padStart(2, '0');
  const id = `demo_task_${String(index + 1).padStart(3, '0')}`;
  return {
    id,
    date: `2026-07-${day}`,
    time: spec.time,
    source: spec.source,
    projectPath: `C:\\Demo\\${spec.project}`,
    title: spec.title,
    taskType: spec.type,
    keywords: spec.keywords,
    userSummary: spec.user,
    assistantSummary: spec.assistant,
    rawFilePath: `C:\\Demo\\Sessions\\${id}.jsonl`,
    messageCount: spec.messages,
    firstTimestamp: `2026-07-${day}T${spec.time}:00.000Z`,
    lastTimestamp: `2026-07-${day}T${spec.time}:45.000Z`
  };
}

const taskSpecs = [
  { day: 2, time: '09:15', source: 'codex-sessions', project: 'Project-Atlas', title: 'Add accessible navigation states', type: 'feature', keywords: ['accessibility', 'navigation', 'ui'], user: 'Add clear keyboard focus states to the demo navigation.', assistant: 'Implemented focus states and added synthetic UI checks.', messages: 18 },
  { day: 3, time: '14:20', source: 'claude-code', project: 'Project-Borealis', title: 'Review API error boundaries', type: 'review', keywords: ['api', 'errors', 'review'], user: 'Review error responses for consistency using demo fixtures.', assistant: 'Documented inconsistencies and proposed bounded error categories.', messages: 24 },
  { day: 4, time: '10:05', source: 'codex-sessions', project: 'Project-Atlas', title: 'Create dashboard metric cards', type: 'feature', keywords: ['dashboard', 'metrics', 'css'], user: 'Create four metric cards using synthetic counts.', assistant: 'Added responsive cards and visual regression assertions.', messages: 31 },
  { day: 5, time: '16:40', source: 'idea-ai', project: 'Project-Cascade', title: 'Explain the indexing pipeline', type: 'explain', keywords: ['index', 'pipeline', 'docs'], user: 'Explain the sample indexing pipeline for new contributors.', assistant: 'Produced an architecture note with a deterministic example.', messages: 12 },
  { day: 7, time: '11:10', source: 'codex-sessions', project: 'Project-Atlas', title: 'Fix date filter edge case', type: 'debug', keywords: ['date', 'filter', 'test'], user: 'Fix the inclusive end-date behavior in the demo search.', assistant: 'Corrected the boundary and added regression coverage.', messages: 22 },
  { day: 8, time: '13:30', source: 'gemini-cli', project: 'Project-Delta', title: 'Draft onboarding checklist', type: 'document', keywords: ['onboarding', 'checklist', 'docs'], user: 'Draft a concise onboarding checklist with no environment-specific paths.', assistant: 'Created a platform-neutral onboarding checklist.', messages: 16 },
  { day: 9, time: '15:25', source: 'claude-code', project: 'Project-Borealis', title: 'Refactor result pagination', type: 'refactor', keywords: ['pagination', 'api', 'refactor'], user: 'Refactor pagination while preserving the public response shape.', assistant: 'Extracted pagination helpers and kept compatibility tests green.', messages: 28 },
  { day: 10, time: '09:50', source: 'codex-sessions', project: 'Project-Atlas', title: 'Add saved search examples', type: 'feature', keywords: ['search', 'filters', 'examples'], user: 'Add synthetic saved-search examples for documentation.', assistant: 'Added examples for source, type and date filters.', messages: 20 },
  { day: 11, time: '17:05', source: 'opencode', project: 'Project-Echo', title: 'Check cross-platform paths', type: 'test', keywords: ['windows', 'linux', 'paths'], user: 'Check path normalization with synthetic Windows and Linux fixtures.', assistant: 'Verified normalization without using real user directories.', messages: 19 },
  { day: 12, time: '10:35', source: 'idea-ai', project: 'Project-Cascade', title: 'Document source adapters', type: 'document', keywords: ['sources', 'adapters', 'privacy'], user: 'Document adapter boundaries and privacy expectations.', assistant: 'Added a source matrix and explicit local-only guarantees.', messages: 14 },
  { day: 14, time: '14:15', source: 'codex-sessions', project: 'Project-Atlas', title: 'Improve empty states', type: 'feature', keywords: ['empty-state', 'ui', 'copy'], user: 'Improve empty-state copy for the demo dashboard.', assistant: 'Added concise bilingual empty states and tests.', messages: 17 },
  { day: 15, time: '16:00', source: 'claude-code', project: 'Project-Borealis', title: 'Audit public package contents', type: 'review', keywords: ['package', 'privacy', 'audit'], user: 'Audit a synthetic public package for forbidden files.', assistant: 'Confirmed the fixture package contains only public demo material.', messages: 26 },
  { day: 16, time: '11:45', source: 'gemini-cli', project: 'Project-Delta', title: 'Summarize weekly progress', type: 'general', keywords: ['summary', 'weekly', 'progress'], user: 'Summarize the synthetic weekly activity.', assistant: 'Prepared a short summary using only demo metrics.', messages: 11 },
  { day: 17, time: '13:10', source: 'codex-sessions', project: 'Project-Atlas', title: 'Verify keyboard shortcuts', type: 'test', keywords: ['keyboard', 'shortcuts', 'accessibility'], user: 'Verify documented keyboard shortcuts in the local dashboard.', assistant: 'Validated shortcut behavior with browser automation.', messages: 21 },
  { day: 18, time: '09:30', source: 'opencode', project: 'Project-Echo', title: 'Add deterministic export fixture', type: 'feature', keywords: ['export', 'fixture', 'deterministic'], user: 'Add a deterministic export example without personal data.', assistant: 'Created a stable fixture and hash-based assertions.', messages: 23 },
  { day: 20, time: '15:50', source: 'claude-code', project: 'Project-Borealis', title: 'Review release checklist', type: 'review', keywords: ['release', 'checklist', 'security'], user: 'Review the release checklist for missing privacy checks.', assistant: 'Added screenshot review and package boundary checks.', messages: 18 },
  { day: 21, time: '10:20', source: 'codex-sessions', project: 'Project-Atlas', title: 'Polish sources status cards', type: 'feature', keywords: ['sources', 'status', 'ui'], user: 'Polish source status cards using placeholder directories.', assistant: 'Improved card hierarchy without exposing local paths.', messages: 25 },
  { day: 22, time: '14:40', source: 'idea-ai', project: 'Project-Cascade', title: 'Prepare public demo screenshots', type: 'document', keywords: ['screenshots', 'demo', 'privacy'], user: 'Prepare screenshots from a fully synthetic workspace.', assistant: 'Generated a synthetic workspace and completed visual privacy review.', messages: 20 }
];

function main() {
  const { outDir } = parseArgs(process.argv.slice(2));
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    throw new Error(`Refusing to overwrite non-empty output directory: ${outDir}`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const tasks = taskSpecs.map(makeTask);
  const byDay = {};
  const byType = {};
  const topKeywords = {};
  let messages = 0;
  for (const task of tasks) {
    byDay[task.date] = (byDay[task.date] || 0) + 1;
    byType[task.taskType] = (byType[task.taskType] || 0) + 1;
    messages += task.messageCount;
    for (const keyword of task.keywords) topKeywords[keyword] = (topKeywords[keyword] || 0) + 1;
  }

  writeJson(path.join(outDir, 'package.json'), { name: 'codexjournal-lite-public-demo', version: '1.4.2' });
  writeJson(path.join(outDir, 'config.json'), {
    sessionsDir: 'C:\\Public\\CodexJournalDemo\\codex-sessions',
    journalDir: 'journal',
    dataDir: 'data',
    reportsDir: 'reports',
    timezone: 'UTC',
    sources: [
      { name: 'codex', type: 'codex', enabled: true, archive: true, sessionsDir: 'C:\\Public\\CodexJournalDemo\\codex-sessions' },
      { name: 'claude-code', type: 'claude', enabled: true, archive: true, sessionsDir: 'C:\\Public\\CodexJournalDemo\\claude-projects' },
      { name: 'idea-ai', type: 'idea', enabled: true, archive: false, logDirs: ['C:\\Public\\CodexJournalDemo\\idea-logs'] }
    ],
    redactPatterns: [],
    plugins: []
  });
  writeJson(path.join(outDir, 'data', 'tasks.json'), {
    generatedAt: '2026-07-22T15:00:00.000Z',
    sessionsDir: 'C:\\Public\\CodexJournalDemo\\codex-sessions',
    tasks
  });
  writeJson(path.join(outDir, 'data', 'stats.json'), {
    generatedAt: '2026-07-22T15:00:00.000Z',
    totals: { tasks: tasks.length, messages, days: Object.keys(byDay).length },
    byDay,
    byType,
    topKeywords
  });
  writeJson(path.join(outDir, 'data', 'patterns.json'), {
    generatedAt: '2026-07-22T15:00:00.000Z',
    note: 'Synthetic public demo data only.'
  });
  writeText(path.join(outDir, 'data', 'search.md'), '# Public demo search index\n\nSynthetic content only.\n');

  const journalGroups = new Map();
  for (const task of tasks) {
    if (!journalGroups.has(task.date)) journalGroups.set(task.date, []);
    journalGroups.get(task.date).push(task);
  }
  for (const [date, items] of journalGroups) {
    const sections = items.map(task => [
      `## ${task.time} · ${task.title}`,
      '',
      `- type: ${task.taskType}`,
      `- source: ${task.source}`,
      `- project: ${task.projectPath}`,
      `- messages: ${task.messageCount}`,
      '',
      `**User**: ${task.userSummary}`,
      '',
      `**Assistant**: ${task.assistantSummary}`
    ].join('\n'));
    writeText(path.join(outDir, 'journal', `${date}.md`), `# ${date}\n\n> Synthetic public demo journal.\n\n${sections.join('\n\n')}\n`);
  }

  writeText(path.join(outDir, 'reports', 'doctor.md'), '# Doctor\n\n| status | count |\n| --- | ---: |\n| pass | 12 |\n| fail | 0 |\n');
  writeText(path.join(outDir, 'reports', 'verify-full.log'), 'passed: 12\nfailed: 0\n');
  writeText(path.join(outDir, 'reports', 'README.md'), '# Public demo reports\n\nSynthetic content only.\n');
  writeText(path.join(outDir, 'dist', 'public-demo.txt'), 'Synthetic artifact placeholder.\n');

  process.stdout.write(JSON.stringify({ ok: true, outDir, tasks: tasks.length, days: Object.keys(byDay).length }) + '\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(String(error && error.message ? error.message : error) + '\n');
  process.exitCode = 1;
}
