'use strict';

// src/analysis.js
//
// Rule-based analysis of Codex journal tasks. No AI, no network.
// Reads data/tasks.json; writes patterns, monthly/yearly summaries,
// and work-patterns report.

const sanitize = require('./sanitize');
const utils = require('./utils');

function parseTimeStr(s) {
  if (!s || typeof s !== 'string') return null;
  if (!/^\d{2}:\d{2}$/.test(s.trim())) return null;
  const parts = s.trim().split(':');
  const h = parseInt(parts[0], 10);
  if (isNaN(h) || h < 0 || h > 23) return null;
  return h;
}

function classifyTimeOfDay(time) {
  const h = parseTimeStr(time);
  if (h === null) return 'unknown';
  if (h >= 0 && h <= 5) return 'lateNight';
  if (h >= 6 && h <= 11) return 'morning';
  if (h >= 12 && h <= 17) return 'afternoon';
  return 'evening'; // 18-23
}

function classifyWeekday(dateStr) {
  if (!dateStr) return -1;
  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d.getTime())) return -1;
  return d.getDay();
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n) { return String(n).padStart(2, '0'); }

function monthKey(d) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  return y + '-' + m;
}

function monthKeyFromDateStr(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})/);
  return m ? m[1] + '-' + m[2] : null;
}

function yearKeyFromDateStr(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-/);
  return m ? m[1] : null;
}

// -------- helpers (v0.5.1) -------------------------------------------

function cleanTitle(s, maxLen) {
  if (!s) return '';
  let c = String(s)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (c.length <= (maxLen || 60)) return c;
  return c.slice(0, (maxLen || 60) - 1) + '\u2026';
}

// Known non-local path schemes to exclude from project-path analysis.
const URLISH_RE = /^(https?|s|ftp|file):\/\//i;
const PLUGIN_APP_RE = /^(plugin|app|n\/\/|n):\/\//i;

function isLocalProjectPath(p) {
  if (!p || typeof p !== 'string') return false;
  return !URLISH_RE.test(p) && !PLUGIN_APP_RE.test(p);
}

// -------- patterns --------------------------------------------------

function buildPatterns(tasks) {
  if (!Array.isArray(tasks)) tasks = [];

  const byMonth = {};
  const byYear = {};
  const byTaskType = {};
  const bySource = {};
  const byProjectPath = {};
  const topKeywords = {};
  const timeOfDay = { morning: 0, afternoon: 0, evening: 0, lateNight: 0, unknown: 0 };
  const weekdayDist = {};
  const activeDays = {};
  const daySet = new Set();

  let totalMessages = 0;

  for (const t of tasks) {
    totalMessages += t.messageCount || 0;

    // Month / year
    const mk = monthKeyFromDateStr(t.date);
    if (mk) {
      byMonth[mk] = (byMonth[mk] || 0) + 1;
      const yk = yearKeyFromDateStr(t.date);
      if (yk) byYear[yk] = (byYear[yk] || 0) + 1;
    }

    // Task type
    const tt = t.taskType || 'general';
    byTaskType[tt] = (byTaskType[tt] || 0) + 1;

    // Source
    const src = t.source || 'unknown';
    bySource[src] = (bySource[src] || 0) + 1;

    // Project path (filter out URLs and plugin/app URIs)
    if (t.projectPath) {
      const pp = t.projectPath.trim();
      if (pp && isLocalProjectPath(pp)) byProjectPath[pp] = (byProjectPath[pp] || 0) + 1;
    }

    // Keywords
    if (Array.isArray(t.keywords)) {
      for (const k of t.keywords) {
        if (k) topKeywords[k] = (topKeywords[k] || 0) + 1;
      }
    }

    // Time of day
    timeOfDay[classifyTimeOfDay(t.time)] += 1;

    // Weekday
    const wd = classifyWeekday(t.date);
    if (wd >= 0) weekdayDist[wd] = (weekdayDist[wd] || 0) + 1;

    // Active days
    if (t.date) {
      activeDays[t.date] = (activeDays[t.date] || 0) + 1;
      daySet.add(t.date);
    }
  }

  const monthCount = Object.keys(byMonth).length;
  const yearCount = Object.keys(byYear).length;

  // Long tasks: top 10 by messageCount
  const longTasks = tasks.slice().sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0)).slice(0, 10).map(sanitizeTaskInfo);
  // Recent tasks: top 15 by date desc, then time desc
  const recentTasks = tasks.slice().sort(taskDateSorter).slice(0, 15).map(sanitizeTaskInfo);

  // Insights
  const insights = generateInsights(tasks, byTaskType, timeOfDay, byProjectPath, daySet.size);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      tasks: tasks.length,
      messages: totalMessages,
      activeDays: daySet.size,
      months: monthCount,
      years: yearCount
    },
    byMonth: sortObjAsc(byMonth),
    byYear: sortObjAsc(byYear),
    byTaskType: sortObjDesc(byTaskType),
    bySource: sortObjDesc(bySource),
    byProjectPath: sortObjDesc(byProjectPath),
    topKeywords: sortObjLimit(topKeywords, 50), // top 50
    timeOfDay,
    weekday: sortObjAsc(weekdayDist),
    longTasks,
    recentTasks,
    insights
  };
}

function sanitizeTaskInfo(t) {
  return {
    id: t.id,
    date: t.date,
    time: t.time,
    title: cleanTitle(sanitize.redactText(t.title || ''), 60),
    taskType: t.taskType || 'general',
    messageCount: t.messageCount || 0,
    projectPath: t.projectPath ? sanitize.redactPath(t.projectPath) : null,
    rawFilePath: t.rawFilePath ? sanitize.redactPath(t.rawFilePath) : null
  };
}

function taskDateSorter(a, b) {
  const ad = (a.date || '') + 'T' + (a.time || '00:00');
  const bd = (b.date || '') + 'T' + (b.time || '00:00');
  return ad < bd ? 1 : ad > bd ? -1 : 0;
}

function generateInsights(tasks, byTaskType, timeOfDay, byProjectPath, activeDayCount) {
  const out = [];
  // Highest task type
  const typeEntries = Object.entries(byTaskType).sort((a, b) => b[1] - a[1]);
  if (typeEntries.length) {
    const [topType, topCount] = typeEntries[0];
    const pct = Math.round((topCount / (tasks.length || 1)) * 100);
    out.push('Most common task type: `' + topType + '` (' + topCount + ' tasks, ' + pct + '%).');
  }
  // Time of day
  const todEntries = Object.entries(timeOfDay).sort((a, b) => b[1] - a[1]);
  if (todEntries.length && todEntries[0][1] > 0) {
    out.push('Most active time of day: ' + todEntries[0][0] + ' (' + todEntries[0][1] + ' tasks).');
  }
  // Project path
  const projEntries = Object.entries(byProjectPath).sort((a, b) => b[1] - a[1]);
  if (projEntries.length) {
    const [topProj, topProjCount] = projEntries[0];
    const pct2 = Math.round((topProjCount / (tasks.length || 1)) * 100);
    out.push('Most frequent project path: `' + sanitize.redactPath(topProj) + '` (' + topProjCount + ' tasks, ' + pct2 + '%).');
  }
  // Coverage continuity
  if (activeDayCount >= 20) {
    out.push('Active days: ' + activeDayCount + '. The log coverage is relatively continuous.');
  }
  // Tool config / env / codex / openclaw combination
  const toolTypes = ['environment', 'openclaw', 'codex'];
  let toolCount = 0;
  for (const tt of toolTypes) {
    toolCount += byTaskType[tt] || 0;
  }
  if (toolCount > 0) {
    const pct3 = Math.round((toolCount / (tasks.length || 1)) * 100);
    out.push('Tool / configuration / debugging tasks (environment + openclaw + codex): ' + toolCount + ' tasks (' + pct3 + '%).');
  }
  // thesis / document
  const writingTypes = ['thesis', 'document', 'zotero'];
  let writingCount = 0;
  for (const tt of writingTypes) {
    writingCount += byTaskType[tt] || 0;
  }
  if (writingCount > 0) {
    const pct4 = Math.round((writingCount / (tasks.length || 1)) * 100);
    out.push('Writing / research tasks (thesis + document + zotero): ' + writingCount + ' tasks (' + pct4 + '%).');
  }
  return out;
}

function sortObjDesc(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  );
}

function sortObjAsc(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  );
}

function sortObjLimit(obj, max) {
  return Object.fromEntries(
    Object.entries(obj).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, max)
  );
}

// -------- groupers --------------------------------------------------

function groupByMonth(tasks) {
  const map = {};
  for (const t of tasks || []) {
    const mk = monthKeyFromDateStr(t.date);
    if (!mk) continue;
    if (!map[mk]) map[mk] = [];
    map[mk].push(t);
  }
  // Sort keys
  const sorted = Object.keys(map).sort();
  return sorted.map((k) => ({ month: k, tasks: map[k] }));
}

function groupByYear(tasks) {
  const map = {};
  for (const t of tasks || []) {
    const yk = yearKeyFromDateStr(t.date);
    if (!yk) continue;
    if (!map[yk]) map[yk] = [];
    map[yk].push(t);
  }
  const sorted = Object.keys(map).sort();
  return sorted.map((k) => ({ year: k, tasks: map[k] }));
}

// -------- markdown renderers ----------------------------------------

function mdEscape(s) {
  if (s == null) return '';
  return String(s).replace(/\|/g, '\\|');
}

function renderMonthlyReport(month, tasks, patterns) {
  const lines = [];
  lines.push('# Monthly Summary: ' + month);
  lines.push('');
  lines.push('- generatedAt: ' + patterns.generatedAt);
  lines.push('- tasks: ' + tasks.length);
  const msgs = tasks.reduce((a, t) => a + (t.messageCount || 0), 0);
  lines.push('- messages: ' + msgs);
  const days = new Set(tasks.map((t) => t.date).filter(Boolean));
  lines.push('- active days: ' + days.size);
  lines.push('');

  lines.push('## Task types');
  lines.push('');
  const types = {};
  for (const t of tasks) {
    const k = t.taskType || 'general';
    types[k] = (types[k] || 0) + 1;
  }
  const sortedTypes = Object.entries(types).sort((a, b) => b[1] - a[1]);
  lines.push('| type | count |');
  lines.push('| --- | --- |');
  for (const [k, v] of sortedTypes) lines.push('| `' + k + '` | ' + v + ' |');
  lines.push('');

  lines.push('## Top keywords');
  lines.push('');
  const kws = {};
  for (const t of tasks) {
    if (Array.isArray(t.keywords)) {
      for (const k of t.keywords) kws[k] = (kws[k] || 0) + 1;
    }
  }
  const sortedKws = Object.entries(kws).sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (sortedKws.length) {
    lines.push('| keyword | count |');
    lines.push('| --- | --- |');
    for (const [k, v] of sortedKws) lines.push('| `' + k + '` | ' + v + ' |');
  } else {
    lines.push('_(none)_');
  }
  lines.push('');

  lines.push('## Top project paths');
  lines.push('');
  const projs = {};
  for (const t of tasks) {
    if (t.projectPath) {
      const p = sanitize.redactPath(t.projectPath);
      projs[p] = (projs[p] || 0) + 1;
    }
  }
  const sortedProjs = Object.entries(projs).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (sortedProjs.length) {
    lines.push('| project | count |');
    lines.push('| --- | --- |');
    for (const [k, v] of sortedProjs) lines.push('| `' + mdEscape(k) + '` | ' + v + ' |');
  } else {
    lines.push('_(none)_');
  }
  lines.push('');

  lines.push('## Time of day');
  lines.push('');
  const tod = { morning: 0, afternoon: 0, evening: 0, lateNight: 0, unknown: 0 };
  for (const t of tasks) {
    tod[classifyTimeOfDay(t.time)] += 1;
  }
  lines.push('| period | count |');
  lines.push('| --- | --- |');
  for (const [k, v] of Object.entries(tod)) lines.push('| ' + k + ' | ' + v + ' |');
  lines.push('');

  lines.push('## Long tasks (top 10 by message count)');
  lines.push('');
  lines.push('| date | time | type | msgs | title |');
  lines.push('| --- | --- | --- | --- | --- |');
  const monthlyLong = tasks.slice().sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0)).slice(0, 10);
  for (const t of monthlyLong) {
    lines.push('| ' + (t.date || '') + ' | ' + (t.time || '') + ' | `' + (t.taskType || 'general') + '` | ' + (t.messageCount || 0) + ' | ' + cleanTitle(sanitize.redactText(t.title || ''), 50) + ' |');
  }
  lines.push('');

  lines.push('## Recent tasks (top 10 by date)');
  lines.push('');
  lines.push('| date | time | type | msgs | title |');
  lines.push('| --- | --- | --- | --- | --- |');
  const monthlyRecent = tasks.slice().sort(taskDateSorter).slice(0, 10);
  for (const t of monthlyRecent) {
    lines.push('| ' + (t.date || '') + ' | ' + (t.time || '') + ' | `' + (t.taskType || 'general') + '` | ' + (t.messageCount || 0) + ' | ' + cleanTitle(sanitize.redactText(t.title || ''), 50) + ' |');
  }
  lines.push('');

  lines.push('## Notes / Insights');
  lines.push('');
  const monthlyInsights = generateInsights(tasks, types, tod, projs, days.size);
  if (monthlyInsights.length) {
    for (const ins of monthlyInsights) lines.push('- ' + ins);
  } else {
    lines.push('_(none)_');
  }
  return lines.join('\n') + '\n';
}

function renderYearlyReport(year, tasks, patterns) {
  const lines = [];
  lines.push('# Yearly Summary: ' + year);
  lines.push('');
  lines.push('- generatedAt: ' + patterns.generatedAt);
  lines.push('- tasks: ' + tasks.length);
  const msgs = tasks.reduce((a, t) => a + (t.messageCount || 0), 0);
  lines.push('- messages: ' + msgs);
  const days = new Set(tasks.map((t) => t.date).filter(Boolean));
  lines.push('- active days: ' + days.size);
  const monthsSet = new Set(tasks.map((t) => monthKeyFromDateStr(t.date)).filter(Boolean));
  lines.push('- active months: ' + monthsSet.size);
  lines.push('');

  // Monthly trend table
  lines.push('## Monthly trend');
  lines.push('');
  const monthCounts = {};
  for (const t of tasks) {
    const mk = monthKeyFromDateStr(t.date);
    if (mk) monthCounts[mk] = (monthCounts[mk] || 0) + 1;
  }
  const sortedMonths = Object.keys(monthCounts).sort();
  lines.push('| month | tasks |');
  lines.push('| --- | --- |');
  for (const mk of sortedMonths) lines.push('| ' + mk + ' | ' + monthCounts[mk] + ' |');
  lines.push('');

  lines.push('## Task types');
  lines.push('');
  const types = {};
  for (const t of tasks) {
    const k = t.taskType || 'general';
    types[k] = (types[k] || 0) + 1;
  }
  const sortedTypes = Object.entries(types).sort((a, b) => b[1] - a[1]);
  lines.push('| type | count |');
  lines.push('| --- | --- |');
  for (const [k, v] of sortedTypes) lines.push('| `' + k + '` | ' + v + ' |');
  lines.push('');

  lines.push('## Top keywords');
  lines.push('');
  const kws = {};
  for (const t of tasks) {
    if (Array.isArray(t.keywords)) {
      for (const k of t.keywords) kws[k] = (kws[k] || 0) + 1;
    }
  }
  const sortedKws = Object.entries(kws).sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (sortedKws.length) {
    lines.push('| keyword | count |');
    lines.push('| --- | --- |');
    for (const [k, v] of sortedKws) lines.push('| `' + k + '` | ' + v + ' |');
  } else {
    lines.push('_(none)_');
  }
  lines.push('');

  lines.push('## Top project paths');
  lines.push('');
  const projs = {};
  for (const t of tasks) {
    if (t.projectPath) {
      const p = sanitize.redactPath(t.projectPath);
      projs[p] = (projs[p] || 0) + 1;
    }
  }
  const sortedProjs = Object.entries(projs).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (sortedProjs.length) {
    lines.push('| project | count |');
    lines.push('| --- | --- |');
    for (const [k, v] of sortedProjs) lines.push('| `' + mdEscape(k) + '` | ' + v + ' |');
  } else {
    lines.push('_(none)_');
  }
  lines.push('');

  lines.push('## Time of day');
  lines.push('');
  const tod = { morning: 0, afternoon: 0, evening: 0, lateNight: 0, unknown: 0 };
  for (const t of tasks) {
    tod[classifyTimeOfDay(t.time)] += 1;
  }
  lines.push('| period | count |');
  lines.push('| --- | --- |');
  for (const [k, v] of Object.entries(tod)) lines.push('| ' + k + ' | ' + v + ' |');
  lines.push('');

  lines.push('## Long tasks (top 10 by message count)');
  lines.push('');
  lines.push('| date | time | type | msgs | title |');
  lines.push('| --- | --- | --- | --- | --- |');
  const yearlyLong = tasks.slice().sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0)).slice(0, 10);
  for (const t of yearlyLong) {
    lines.push('| ' + (t.date || '') + ' | ' + (t.time || '') + ' | `' + (t.taskType || 'general') + '` | ' + (t.messageCount || 0) + ' | ' + cleanTitle(sanitize.redactText(t.title || ''), 50) + ' |');
  }
  lines.push('');

  lines.push('## Notes / Insights');
  lines.push('');
  const yeatInsights = generateInsights(tasks, types, tod, projs, days.size);
  if (yeatInsights.length) {
    for (const ins of yeatInsights) lines.push('- ' + ins);
  } else {
    lines.push('_(none)_');
  }
  return lines.join('\n') + '\n';
}

function renderWorkPatternsReport(patterns, cfg) {
  const lines = [];
  lines.push('# Work Patterns');
  lines.push('');
  lines.push('> Generated by `npm run summarize` (CodexJournal-Lite v0.5.0).');
  lines.push('');
  lines.push('- generatedAt: ' + patterns.generatedAt);
  lines.push('- total tasks: ' + patterns.totals.tasks);
  lines.push('- total messages: ' + patterns.totals.messages);
  lines.push('- active days: ' + patterns.totals.activeDays);
  lines.push('- active months: ' + patterns.totals.months);
  lines.push('- active years: ' + patterns.totals.years);
  lines.push('');

  lines.push('## Task type distribution');
  lines.push('');
  lines.push('| type | count |');
  lines.push('| --- | --- |');
  const types = Object.entries(patterns.byTaskType);
  for (const [k, v] of types) lines.push('| `' + k + '` | ' + v + ' |');
  lines.push('');

  lines.push('## Source distribution');
  lines.push('');
  lines.push('| source | count |');
  lines.push('| --- | --- |');
  const srcs = Object.entries(patterns.bySource);
  for (const [k, v] of srcs) lines.push('| `' + k + '` | ' + v + ' |');
  lines.push('');

  lines.push('## Project path distribution');
  lines.push('');
  const projs = Object.entries(patterns.byProjectPath);
  if (projs.length) {
    lines.push('| project | count |');
    lines.push('| --- | --- |');
    for (const [k, v] of projs.slice(0, 20)) lines.push('| `' + mdEscape(k) + '` | ' + v + ' |');
  } else {
    lines.push('_(none)_');
  }
  lines.push('');

  lines.push('## Top keywords');
  lines.push('');
  const kws = Object.entries(patterns.topKeywords);
  if (kws.length) {
    lines.push('| keyword | count |');
    lines.push('| --- | --- |');
    for (const [k, v] of kws.slice(0, 30)) lines.push('| `' + k + '` | ' + v + ' |');
  } else {
    lines.push('_(none)_');
  }
  lines.push('');

  lines.push('## Weekday distribution');
  lines.push('');
  lines.push('| day | count |');
  lines.push('| --- | --- |');
  for (const [wd, cnt] of Object.entries(patterns.weekday)) {
    lines.push('| ' + (WEEKDAY_NAMES[parseInt(wd, 10)] || wd) + ' | ' + cnt + ' |');
  }
  lines.push('');

  lines.push('## Time of day distribution');
  lines.push('');
  lines.push('| period | count |');
  lines.push('| --- | --- |');
  for (const [k, v] of Object.entries(patterns.timeOfDay)) lines.push('| ' + k + ' | ' + v + ' |');
  lines.push('');

  lines.push('## Longest tasks (top 10 by message count)');
  lines.push('');
  lines.push('| date | time | type | msgs | title |');
  lines.push('| --- | --- | --- | --- | --- |');
  if (patterns.longTasks.length) {
    for (const t of patterns.longTasks) {
      lines.push('| ' + (t.date || '') + ' | ' + (t.time || '') + ' | `' + t.taskType + '` | ' + t.messageCount + ' | ' + cleanTitle(t.title || '', 50) + ' |');
    }
  } else {
    lines.push('_(none)_');
  }
  lines.push('');

  lines.push('## Recent tasks (top 15 by date)');
  lines.push('');
  lines.push('| date | time | type | msgs | title |');
  lines.push('| --- | --- | --- | --- | --- |');
  if (patterns.recentTasks.length) {
    for (const t of patterns.recentTasks) {
      lines.push('| ' + (t.date || '') + ' | ' + (t.time || '') + ' | `' + t.taskType + '` | ' + t.messageCount + ' | ' + cleanTitle(t.title || '', 50) + ' |');
    }
  } else {
    lines.push('_(none)_');
  }
  lines.push('');

  lines.push('## Rule-based insights');
  lines.push('');
  if (patterns.insights.length) {
    for (const ins of patterns.insights) lines.push('- ' + ins);
  } else {
    lines.push('_(none)_');
  }
  lines.push('');

  lines.push('## Data Quality Notes');
  lines.push('');
  lines.push('- **Classification is heuristic.** The `taskType` and `keywords` are');
  lines.push('  derived from rule-based keyword matching on user and assistant');
  lines.push('  message text, not from ground-truth labels. Some tasks may be');
  lines.push('  miscategorised.');
  lines.push('- **Project path confidence.** `projectPath` is read from the Codex');
  lines.push('  session meta (the IDE working directory at session start) or');
  lines.push('  detected from message text. It is not guaranteed to be accurate');
  lines.push('  for every task.');
  lines.push('- **IDEA / JetBrains logs are NOT analysed.** The analysis covers only');
  lines.push('  Codex sessions (`data/tasks.json`). The IDEA log inventory is');
  lines.push('  available at `reports/idea-log-inventory.md`, but its content');
  lines.push('  is not parsed into this report. Non-local URL and plugin/app URI');
  lines.push('  paths are excluded from the project-path distribution.');
  lines.push('');
  lines.push('## Privacy');
  lines.push('');
  lines.push('- This report is generated from `data/tasks.json` without any network');
  lines.push('  calls, telemetry, or external AI. All task titles, project paths,');
  lines.push('  and raw file paths are passed through `src/sanitize.js` before');
  lines.push('  being written. If a path or title still looks like a credential');
  lines.push('  or a real Windows username, that is a bug in the redaction layer');
  lines.push('  and should be reported.');
  return lines.join('\n') + '\n';
}

module.exports = {
  buildPatterns,
  groupByMonth,
  groupByYear,
  renderMonthlyReport,
  renderYearlyReport,
  renderWorkPatternsReport
};
