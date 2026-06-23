'use strict';

// src/searchQuery.js
//
// Structured search query parser and matcher for CodexJournal-Lite.
// Supports field-specific search: source:codex type:codex date:2026-06
// Supports quoted phrases: "REST API"
// Supports negative filters: -source:codex
// Zero dependencies, Node.js built-ins only.

// Supported field names and their aliases (mapped to task field names)
var FIELD_ALIASES = {
  source: 'source',
  type: 'taskType',      // type maps to taskType
  date: 'date',
  from: 'dateFrom',      // from/to are date range filters
  to: 'dateTo',
  title: 'title',
  keyword: 'keywords',
  path: 'projectPath'    // path matches projectPath + rawFilePath
};

function parseSearchQuery(query) {
  query = (query || '').trim();
  var result = {
    textTerms: [],       // free-text terms (non-field)
    phrases: [],         // quoted phrases
    filters: {},         // field -> [values]
    excludeFilters: {}   // field -> [values] (negative)
  };
  if (!query) return result;

  var i = 0;
  while (i < query.length) {
    // Skip whitespace
    while (i < query.length && /\s/.test(query[i])) i++;
    if (i >= query.length) break;

    // Check for negative prefix
    var negative = false;
    if (query[i] === '-' && i + 1 < query.length && query[i + 1] !== ' ') {
      negative = true;
      i++;
    }

    // Check for field:value pattern
    var fieldMatch = '';
    var j = i;
    while (j < query.length && /[a-zA-Z]/.test(query[j])) j++;
    if (j > i && j < query.length && query[j] === ':') {
      fieldMatch = query.slice(i, j).toLowerCase();
      i = j + 1; // skip the ':'
    }

    // Read the value (quoted or unquoted)
    var value = '';
    if (i < query.length && query[i] === '"') {
      i++; // skip opening quote
      var start = i;
      while (i < query.length && query[i] !== '"') i++;
      value = query.slice(start, i);
      if (i < query.length) i++; // skip closing quote
      if (fieldMatch) {
        addFilter(result, fieldMatch, value, negative);
      } else {
        result.phrases.push(value);
      }
    } else {
      var start2 = i;
      while (i < query.length && !/\s/.test(query[i])) i++;
      value = query.slice(start2, i);
      if (fieldMatch) {
        addFilter(result, fieldMatch, value, negative);
      } else if (value) {
        result.textTerms.push(value);
      }
    }
  }
  return result;
}

function addFilter(result, field, value, negative) {
  var realField = FIELD_ALIASES[field] || field;
  var bucket = negative ? result.excludeFilters : result.filters;
  if (!bucket[realField]) bucket[realField] = [];
  bucket[realField].push(value.toLowerCase());
}

function matchTask(task, parsed) {
  if (!task) return false;

  // Check field filters (inclusive — at least one value must match per field)
  for (var field in parsed.filters) {
    if (!parsed.filters.hasOwnProperty(field)) continue;
    var values = parsed.filters[field];
    var matched = false;
    for (var i = 0; i < values.length; i++) {
      if (matchField(task, field, values[i])) { matched = true; break; }
    }
    if (!matched) return false;
  }

  // Check exclude filters (exclusive — any match means reject)
  for (var field2 in parsed.excludeFilters) {
    if (!parsed.excludeFilters.hasOwnProperty(field2)) continue;
    var exValues = parsed.excludeFilters[field2];
    for (var k = 0; k < exValues.length; k++) {
      if (matchField(task, field2, exValues[k])) return false;
    }
  }

  // Check free-text terms (search across all text fields)
  var allText = getAllSearchableText(task).toLowerCase();
  for (var t = 0; t < parsed.textTerms.length; t++) {
    if (allText.indexOf(parsed.textTerms[t].toLowerCase()) === -1) return false;
  }

  // Check quoted phrases
  for (var p = 0; p < parsed.phrases.length; p++) {
    if (allText.indexOf(parsed.phrases[p].toLowerCase()) === -1) return false;
  }

  return true;
}

function matchField(task, field, value) {
  switch (field) {
    case 'source':
      return String(task.source || '').toLowerCase().indexOf(value) !== -1;
    case 'taskType':
      return String(task.taskType || '').toLowerCase().indexOf(value) !== -1;
    case 'date':
      return String(task.date || '').indexOf(value) !== -1;
    case 'dateFrom':
      return task.date && task.date !== 'unknown' && task.date >= value;
    case 'dateTo':
      return task.date && task.date !== 'unknown' && task.date <= value;
    case 'title':
      return String(task.title || '').toLowerCase().indexOf(value) !== -1;
    case 'keywords':
      var kws = task.keywords;
      if (!Array.isArray(kws)) return false;
      for (var i = 0; i < kws.length; i++) {
        if (String(kws[i]).toLowerCase().indexOf(value) !== -1) return true;
      }
      return false;
    case 'projectPath':
      return (String(task.projectPath || '').toLowerCase().indexOf(value) !== -1) ||
             (String(task.rawFilePath || '').toLowerCase().indexOf(value) !== -1);
    default:
      return false;
  }
}

function getAllSearchableText(task) {
  var parts = [
    task.title, task.userSummary, task.assistantSummary,
    task.taskType, task.date, task.source,
    Array.isArray(task.keywords) ? task.keywords.join(' ') : ''
  ];
  return parts.filter(Boolean).join(' ');
}

module.exports = {
  parseSearchQuery: parseSearchQuery,
  matchTask: matchTask,
  matchField: matchField,
  getAllSearchableText: getAllSearchableText,
  FIELD_ALIASES: FIELD_ALIASES
};
