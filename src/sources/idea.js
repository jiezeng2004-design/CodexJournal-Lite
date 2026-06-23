'use strict';

// src/sources/idea.js
//
// Read-only probe for IDEA / JetBrains AI-related log files.
//
// Contract (inventory-only):
//   - We DO NOT parse log content into tasks / journal / search.
//   - We DO walk candidate JetBrains directories more thoroughly:
//       1. The two top-level roots: %APPDATA%\JetBrains and
//          %LOCALAPPDATA%\JetBrains.
//       2. The product-specific sub-directories that live directly under
//          them: %APPDATA%\JetBrains\<Product><Version> and
//          %LOCALAPPDATA%\JetBrains\<Product><Version>.
//       3. The user-configured overrides in
//          config.json -> sources[].logDirs.
//   - For each "root" we then enumerate the canonical JetBrains log
//     sub-directories: `log`, `logs`, `system/log`, `system/logs`.
//   - We DO read at most the first 50 KB of any candidate file.
//   - We DO flag files whose path or first-50-KB content matches
//     any of the heuristic AI-related keywords.
//   - We DO skip any file larger than 20 MB without reading it.
//   - We DO return a structured result (root-level + logDir-level +
//     file-level metadata) so the CLI can render both a Markdown
//     inventory and a machine-readable JSON summary.
//
// Hard rules:
//   - No file is ever opened in write / append mode.
//   - No symlink / junction is followed.
//   - Recursion depth is bounded (default 4 levels under a root).
//   - All paths and preview lines are passed through sanitize.redactText
//     before being placed into the report payload.

const fs = require('fs');
const path = require('path');
const sanitize = require('../sanitize');
const paths = require('../paths');
const ideaParser = require('./idea-parser');

const MAX_FILE_BYTES       = 20 * 1024 * 1024;   // 20 MB: skip, do not read
const MAX_PREVIEW_BYTES     = 50 * 1024;          // 50 KB: read at most this many bytes per file
const MAX_PREVIEW_LINES     = 20;                 // keep at most this many lines in the report
const MAX_WALK_DEPTH        = 4;                  // bounded walk for fallback log discovery

const SUPPORTED_EXTS = new Set(['.log', '.txt', '.json', '.jsonl']);

const AI_KEYWORDS = [
  'AI Assistant',
  'JetBrains AI',
  'AIAssistant',
  'LLM',
  'Chat',
  'OpenAI',
  'Anthropic',
  'Copilot',
  'completion',
  'prompt',
  'model',
  'assistant',
  'ai-assistant'
];

// A "JetBrains-style" IDE config root. We only ever feed these as
// directory names into the lookup; never as full paths.
const IDE_PRODUCT_DIR_NAMES = [
  'IntelliJIdea',
  'IdeaIC',
  'WebStorm',
  'PyCharm',
  'PyCharmCE',
  'GoLand',
  'RubyMine',
  'CLion',
  'PhpStorm',
  'AppCode',
  'Rider',
  'DataGrip',
  'Aqua',
  'Gateway',
  'RustRover',
  'Writerside'
];

// Canonical JetBrains log sub-directories (case-insensitive).
const LOG_SUBDIR_BASENAMES = new Set(['log', 'logs']);

// -------- env expansion -------------------------------------------------

function expandEnv(value) {
  return paths.expandEnv(value);
}

// -------- roots discovery ------------------------------------------------

function userProfileProductDirs() {
  // %USERPROFILE%\.IntelliJIdea*, .WebStorm*, etc. (user-level config)
  const home = process.env.USERPROFILE || '';
  if (!home) return [];
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(home); } catch (_) { return []; }
  for (const e of entries) {
    if (typeof e !== 'string') continue;
    for (const prod of IDE_PRODUCT_DIR_NAMES) {
      const re = new RegExp('^\\.' + prod + '(\\\\d.*)?$', 'i');
      if (re.test(e)) {
        out.push(path.join(home, e));
        break;
      }
    }
  }
  return out;
}

function topLevelJetBrainsRoots() {
  // %APPDATA%\JetBrains and %LOCALAPPDATA%\JetBrains (the per-product
  // sub-directories live *inside* these two roots).
  const out = [];
  const app = expandEnv('%APPDATA%/JetBrains');
  const loc = expandEnv('%LOCALAPPDATA%/JetBrains');
  if (app) out.push(app);
  if (loc && loc !== app) out.push(loc);
  return out;
}

function productSubdirsUnderRoot(root) {
  // If <root>/<Product><Version> exists and is a directory, return it.
  // Returned paths are *real* (only added when fs.statSync confirms).
  const out = [];
  let st;
  try { st = fs.statSync(root); } catch (_) { return out; }
  if (!st.isDirectory()) return out;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return out; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    for (const prod of IDE_PRODUCT_DIR_NAMES) {
      const re = new RegExp('^' + prod + '(\\\\d.*)?$', 'i');
      if (re.test(ent.name)) {
        out.push(path.join(root, ent.name));
        break;
      }
    }
  }
  return out;
}

// Combine the configured logDirs (from config.json) with the auto-
// discovered candidates. The result is the master list of "searched
// roots" we will probe.
function resolveSourceRoots(cfg) {
  const out = [];
  const seen = new Set();
  function push(p) {
    if (!p) return;
    const norm = path.resolve(String(p));
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push(norm);
  }

  // 1. User-configured overrides.
  if (cfg && cfg.sources) {
    for (const s of cfg.sources) {
      if (!s || s.type !== 'idea' || s.enabled === false) continue;
      if (Array.isArray(s.logDirs)) {
        for (const d of s.logDirs) push(expandEnv(d));
      }
    }
  }

  // 2. The two top-level JetBrains roots.
  for (const r of topLevelJetBrainsRoots()) push(r);

  // 3. %USERPROFILE%\.IntelliJIdea*, .WebStorm*, etc.
  for (const r of userProfileProductDirs()) push(r);

  return out;
}

// For one given root, decide what product sub-dirs to probe. If `root`
// itself looks like a product sub-dir (e.g. it sits *inside*
// %APPDATA%\JetBrains and matches a product name), we probe it
// directly. Otherwise we enumerate its product sub-dirs.
function expandRootToProductSubdirs(root) {
  // Treat the root itself as a candidate product sub-dir.
  const out = [root];
  for (const sub of productSubdirsUnderRoot(root)) {
    out.push(sub);
  }
  return out;
}

// Decide which "log sub-dirs" exist under a given product sub-dir.
// Looks for the canonical names `log`, `logs`, `system/log`,
// `system/logs` directly. Also performs a bounded recursive walk as
// a safety net (in case the IDE version uses a different layout).
function discoverLogDirsUnderProduct(productDir) {
  const out = [];
  const seen = new Set();
  function push(abs) {
    const norm = path.resolve(abs);
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push(norm);
  }

  // Direct (deterministic) check.
  for (const base of ['log', 'logs', path.join('system', 'log'), path.join('system', 'logs')]) {
    const abs = path.join(productDir, base);
    let st;
    try { st = fs.statSync(abs); } catch (_) { continue; }
    if (st.isDirectory() && !st.isSymbolicLink()) push(abs);
  }

  // Bounded walk as a safety net.
  for (const abs of walkForLogSubDirs(productDir, MAX_WALK_DEPTH - 1)) push(abs);

  return out;
}

function walkForLogSubDirs(root, depthBudget) {
  if (depthBudget <= 0) return [];
  const out = [];
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return out; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const full = path.join(root, ent.name);
    const lname = ent.name.toLowerCase();
    if (LOG_SUBDIR_BASENAMES.has(lname)) {
      out.push(full);
      // do not recurse into a log sub-dir
    } else if (lname === 'system') {
      // One level deeper: look for system/log and system/logs
      for (const sub of ['log', 'logs']) {
        const abs = path.join(full, sub);
        let st;
        try { st = fs.statSync(abs); } catch (_) { continue; }
        if (st.isDirectory() && !st.isSymbolicLink()) out.push(abs);
      }
    } else if (depthBudget > 1) {
      try {
        const st = fs.lstatSync(full);
        if (st.isDirectory() && !st.isSymbolicLink()) {
          for (const sub of walkForLogSubDirs(full, depthBudget - 1)) out.push(sub);
        }
      } catch (_) {}
    }
  }
  return out;
}

// -------- per-file scan -------------------------------------------------

function readPreview(absPath) {
  let st;
  try { st = fs.statSync(absPath); } catch (err) {
    return { wasSkipped: true, reason: 'stat-failed: ' + err.message };
  }
  if (!st.isFile()) {
    return { wasSkipped: true, reason: 'not-a-regular-file' };
  }
  if (st.size > MAX_FILE_BYTES) {
    return {
      wasSkipped: true,
      reason: 'skipped-large-file (size ' + st.size + ' > ' + MAX_FILE_BYTES + ' bytes)',
      size: st.size
    };
  }
  let buf;
  try {
    const fd = fs.openSync(absPath, 'r');
    try {
      const len = Math.min(MAX_PREVIEW_BYTES, st.size);
      buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return { wasSkipped: true, reason: 'read-failed: ' + err.message };
  }
  const previewText = buf.toString('utf8');
  const allLines = previewText.split(/\r?\n/);
  const keptLines = allLines.slice(0, MAX_PREVIEW_LINES);
  return {
    previewText: keptLines.join('\n'),
    lines: keptLines.length,
    totalLinesInPreview: allLines.length,
    wasTruncated: allLines.length > keptLines.length,
    size: st.size
  };
}

function matchKeywords(haystack) {
  if (!haystack) return [];
  const hits = [];
  for (const k of AI_KEYWORDS) {
    const idx = haystack.toLowerCase().indexOf(k.toLowerCase());
    if (idx >= 0) hits.push({ keyword: k, offset: idx });
  }
  return hits;
}

// -------- main scan ----------------------------------------------------

function scan(cfg) {
  const searchedRoots = resolveSourceRoots(cfg).map((p) => sanitize.redactText(p));

  const result = {
    source: 'idea-ai',
    scannedAt: new Date().toISOString(),
    thresholds: {
      maxFileBytes: MAX_FILE_BYTES,
      maxPreviewBytes: MAX_PREVIEW_BYTES,
      maxPreviewLines: MAX_PREVIEW_LINES,
      maxWalkDepth: MAX_WALK_DEPTH,
      supportedExts: Array.from(SUPPORTED_EXTS)
    },
    // split: roots vs log-dirs vs files.
    searchedRoots: searchedRoots,
    existingRoots: [],
    discoveredLogDirs: [],
    existingRootsWithoutLogDirs: [],
    // Back-compat aliases (v0.4.0 callers).
    searchedDirs: searchedRoots,
    existingDirs: [],
    // Per-file results.
    candidateFiles: [],
    likelyAiFiles: [],
    skippedLargeFiles: [],
    parseErrors: [],
    // also exposes `errors` as a unified error list with
    // `kind` to make JSON output self-describing.
    errors: [],
    summary: {
      rootsExisting: 0,
      logDirsDiscovered: 0,
      rootsWithoutLogDirs: 0,
      dirsScanned: 0,
      filesScanned: 0,
      filesLikelyAi: 0,
      filesSkippedLarge: 0
    }
  };

  for (const rootStr of resolveSourceRoots(cfg)) {
    let st;
    try { st = fs.statSync(rootStr); } catch (_) { continue; }
    if (!st.isDirectory()) continue;
    const rootRedacted = sanitize.redactText(rootStr);
    result.existingRoots.push(rootRedacted);
    result.summary.rootsExisting += 1;

    // Expand to one or more candidate product sub-dirs.
    const productDirs = expandRootToProductSubdirs(rootStr);
    const foundLogDirsThisRoot = new Set();

    for (const productDir of productDirs) {
      // Only treat it as a "product sub-dir" worth reporting if it
      // actually exists on disk and is a directory.
      let pst;
      try { pst = fs.statSync(productDir); } catch (_) { continue; }
      if (!pst.isDirectory()) continue;
      const productDirAbs = path.resolve(productDir);
      const productDirRedacted = sanitize.redactText(productDirAbs);

      for (const logDirAbs of discoverLogDirsUnderProduct(productDirAbs)) {
        const logDirRedacted = sanitize.redactText(logDirAbs);
        result.discoveredLogDirs.push(logDirRedacted);
        result.summary.logDirsDiscovered += 1;
        foundLogDirsThisRoot.add(logDirRedacted);

        result.summary.dirsScanned += 1;
        let entries;
        try { entries = fs.readdirSync(logDirAbs, { withFileTypes: true }); }
        catch (err) {
          const errRec = { kind: 'readdir', dir: logDirRedacted, err: err.message };
          result.parseErrors.push(errRec);
          result.errors.push(errRec);
          continue;
        }
        for (const ent of entries) {
          if (!ent.isFile()) continue;
          const ext = path.extname(ent.name).toLowerCase();
          if (!SUPPORTED_EXTS.has(ext)) continue;
          const abs = path.join(logDirAbs, ent.name);
          result.summary.filesScanned += 1;
          let stFile;
          try { stFile = fs.statSync(abs); } catch (err) {
            const errRec = { kind: 'stat', path: sanitize.redactText(abs), err: err.message };
            result.parseErrors.push(errRec);
            result.errors.push(errRec);
            continue;
          }
          if (stFile.size > MAX_FILE_BYTES) {
            result.summary.filesSkippedLarge += 1;
            const skipRec = {
              path: sanitize.redactText(abs),
              size: stFile.size,
              reason: 'size ' + stFile.size + ' > limit ' + MAX_FILE_BYTES
            };
            result.skippedLargeFiles.push(skipRec);
            continue;
          }
          const pathHits = matchKeywords(abs);
          const prev = readPreview(abs);
          if (prev.wasSkipped) {
            const errRec = { kind: 'read', path: sanitize.redactText(abs), err: prev.reason || 'read-failed' };
            result.parseErrors.push(errRec);
            result.errors.push(errRec);
            continue;
          }
          const contentHits = matchKeywords(prev.previewText);
          const dedup = new Map();
          for (const h of pathHits.concat(contentHits)) {
            if (!dedup.has(h.keyword)) dedup.set(h.keyword, true);
          }
          const matched = Array.from(dedup.keys());
          const pathRecord = {
            path: sanitize.redactText(abs),
            size: stFile.size,
            mtime: new Date(stFile.mtimeMs).toISOString(),
            ext,
            pathKeywordHits: pathHits.map((h) => h.keyword),
            contentKeywordHits: contentHits.map((h) => h.keyword),
            matchedKeywords: matched,
            previewLines: sanitize.redactText(prev.previewText),
            previewLineCount: prev.lines,
            wasPreviewTruncated: !!prev.wasTruncated
          };
          result.candidateFiles.push(pathRecord);
          if (matched.length > 0) {
            result.summary.filesLikelyAi += 1;
            result.likelyAiFiles.push(pathRecord);
          }
        }
      }
    }

    if (foundLogDirsThisRoot.size === 0) {
      result.existingRootsWithoutLogDirs.push(rootRedacted);
      result.summary.rootsWithoutLogDirs += 1;
    }
  }

  return result;
}

// -------- markdown renderer --------------------------------------------

function mdEscape(s) {
  if (s == null) return '';
  return String(s).replace(/\|/g, '\\|');
}

function renderMarkdown(result) {
  const lines = [];
  lines.push('# IDEA / JetBrains AI Log Inventory');
  lines.push('');
  lines.push('> Generated by `npm run scan:sources` (CodexJournal-Lite).');
  lines.push('> Read-only probe. Files were never opened in write mode.');
  lines.push('');
  lines.push('- Source: `' + result.source + '`');
  lines.push('- Scanned at: ' + result.scannedAt);
  lines.push('- Thresholds:');
  lines.push('  - skip files larger than: ' + result.thresholds.maxFileBytes + ' bytes');
  lines.push('  - read at most: ' + result.thresholds.maxPreviewBytes + ' bytes per file');
  lines.push('  - keep at most: ' + result.thresholds.maxPreviewLines + ' preview lines');
  lines.push('  - max walk depth: ' + result.thresholds.maxWalkDepth);
  lines.push('  - scan extensions: ' + result.thresholds.supportedExts.join(', '));
  lines.push('');

  lines.push('## Searched roots');
  lines.push('');
  if (!result.searchedRoots.length) {
    lines.push('_(none configured or auto-detected)_');
  } else {
    for (const d of result.searchedRoots) lines.push('- ' + d);
  }
  lines.push('');

  lines.push('## Existing roots');
  lines.push('');
  if (!result.existingRoots.length) {
    lines.push('_(none of the searched roots exist on this machine)_');
  } else {
    for (const d of result.existingRoots) lines.push('- ' + d);
  }
  lines.push('');

  lines.push('## Discovered log directories');
  lines.push('');
  if (!result.discoveredLogDirs.length) {
    lines.push('_(none)_');
  } else {
    for (const d of result.discoveredLogDirs) lines.push('- ' + d);
  }
  lines.push('');

  lines.push('## Existing roots without log directories');
  lines.push('');
  if (!result.existingRootsWithoutLogDirs.length) {
    lines.push('_(none)_');
  } else {
    lines.push('These roots exist on disk but no `log` / `logs` / `system/log` / `system/logs` was found underneath:');
    for (const d of result.existingRootsWithoutLogDirs) lines.push('- ' + d);
  }
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| metric | value |');
  lines.push('| --- | --- |');
  lines.push('| searched roots | ' + result.searchedRoots.length + ' |');
  lines.push('| existing roots | ' + result.summary.rootsExisting + ' |');
  lines.push('| log dirs discovered | ' + result.summary.logDirsDiscovered + ' |');
  lines.push('| existing roots without log dirs | ' + result.summary.rootsWithoutLogDirs + ' |');
  lines.push('| candidate files | ' + result.candidateFiles.length + ' |');
  lines.push('| likely AI-related files | ' + result.summary.filesLikelyAi + ' |');
  lines.push('| files skipped (too large) | ' + result.summary.filesSkippedLarge + ' |');
  lines.push('| errors | ' + result.errors.length + ' |');
  lines.push('');

  lines.push('## Likely AI-related files');
  lines.push('');
  if (!result.likelyAiFiles.length) {
    lines.push('_(none matched the heuristic keywords)_');
  } else {
    for (const f of result.likelyAiFiles) {
      lines.push('### ' + mdEscape(f.path));
      lines.push('');
      lines.push('- size: ' + f.size + ' bytes');
      lines.push('- mtime: ' + f.mtime);
      lines.push('- ext: `' + f.ext + '`');
      lines.push('- matched keywords: ' + (f.matchedKeywords.length ? f.matchedKeywords.map((k) => '`' + k + '`').join(', ') : '_(none)_'));
      lines.push('- path matched: ' + (f.pathKeywordHits.length ? f.pathKeywordHits.map((k) => '`' + k + '`').join(', ') : '_(no)_'));
      lines.push('- content matched: ' + (f.contentKeywordHits.length ? f.contentKeywordHits.map((k) => '`' + k + '`').join(', ') : '_(no)_'));
      lines.push('- preview lines kept: ' + f.previewLineCount + (f.wasPreviewTruncated ? ' (truncated from larger preview)' : ''));
      lines.push('');
      lines.push('```');
      lines.push(f.previewLines);
      lines.push('```');
      lines.push('');
    }
  }
  lines.push('');

  lines.push('## Skipped large files');
  lines.push('');
  if (!result.skippedLargeFiles.length) {
    lines.push('_(none)_');
  } else {
    lines.push('| path | size | reason |');
    lines.push('| --- | --- | --- |');
    for (const f of result.skippedLargeFiles) {
      lines.push('| ' + mdEscape(f.path) + ' | ' + f.size + ' | ' + mdEscape(f.reason) + ' |');
    }
  }
  lines.push('');

  lines.push('## Parse / read errors');
  lines.push('');
  if (!result.parseErrors.length) {
    lines.push('_(none)_');
  } else {
    lines.push('| kind | path / dir | error |');
    lines.push('| --- | --- | --- |');
    for (const e of result.parseErrors) {
      const key = e.path || e.dir || '?';
      lines.push('| ' + mdEscape(e.kind || '?') + ' | ' + mdEscape(key) + ' | ' + mdEscape(e.err) + ' |');
    }
  }
  lines.push('');

  lines.push('## Notes');
  lines.push('');
  lines.push('- This is a **read-only probe**. Nothing under any JetBrains directory');
  lines.push('  was created, modified, renamed, or deleted by this run.');
  lines.push('- All paths and preview text were passed through `src/sanitize.js`');
  lines.push('  before being written to this report.');
  lines.push('- Per the inventory-only contract, no IDEA log content is parsed into');
  lines.push('  `journal/`, `data/tasks.json`, `data/stats.json`, `data/search.md`,');
  lines.push('  or `data/index.json`. Only this Markdown inventory and the');
  lines.push('  `reports/source-scan-summary.json` summary are written.');
  lines.push('- An IDE parser is a candidate for a later release (v0.4.2+).');
  return lines.join('\n');
}

// -------- JSON summary renderer ---------------------------------------

function renderSummaryJson(result) {
  // All paths that appear in the JSON go through sanitize.redactText,
  // same as the Markdown report.
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: '1.1.2',
    sources: {
      'idea-ai': {
        scannedAt: result.scannedAt,
        thresholds: result.thresholds,
        searchedRoots: result.searchedRoots.map((p) => sanitize.redactText(p)),
        existingRoots: result.existingRoots.map((p) => sanitize.redactText(p)),
        discoveredLogDirs: result.discoveredLogDirs.map((p) => sanitize.redactText(p)),
        existingRootsWithoutLogDirs: (result.existingRootsWithoutLogDirs || []).map((p) => sanitize.redactText(p)),
        candidateFiles: result.candidateFiles.length,
        likelyAiFiles: result.likelyAiFiles.length,
        skippedLargeFiles: result.skippedLargeFiles.length,
        errors: result.errors.length,
        summary: result.summary,
        // Sample (truncated) of likely-AI paths so the JSON stays small
        // but still actionable. Truncated to first 20.
        likelyAiFileSample: result.likelyAiFiles.slice(0, 20).map((f) => ({
          path: f.path,
          ext: f.ext,
          size: f.size,
          matchedKeywords: f.matchedKeywords
        }))
      }
    }
  };
}

// -------- collect: parse AI log files into tasks -------------------------

function collect(cfg) {
  const tasks = [];
  const errors = [];
  let fileCount = 0;
  let dirCount = 0;

  try {
    const scanResult = scan(cfg);
    const dirs = scanResult.discoveredLogDirs || [];
    dirCount = dirs.length;
    for (const dir of dirs) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const lower = ent.name.toLowerCase();
        if (!lower.includes('ai') && !lower.includes('assistant')) continue;
        const fp = path.join(dir, ent.name);
        try {
          const result = ideaParser.parseLogFile(fp);
          fileCount++;
          for (const t of result.tasks) {
            tasks.push(t);
          }
          if (result.errors.length > 0) {
            for (const e of result.errors) errors.push({ path: e.path || fp, err: e.err || '' });
          }
        } catch (err) {
          errors.push({ path: fp, err: err.message || String(err) });
        }
      }
    }
  } catch (err) {
    errors.push({ path: '', err: 'idea-ai scan: ' + (err.message || String(err)) });
  }

  return { tasks, errors, fileCount, dirCount };
}

// Health check for the IDEA / JetBrains source adapter.
// Checks:
//   1. logDirs configuration present
//   2. JetBrains directories existence
function doctor(cfg) {
  const checks = [];
  const warnings = [];

  // Check 1: logDirs configuration
  let logDirsConfigured = [];
  if (cfg && cfg.sources) {
    for (const s of cfg.sources) {
      if (!s || s.type !== 'idea') continue;
      if (Array.isArray(s.logDirs)) {
        logDirsConfigured = s.logDirs.map(function (d) { return expandEnv(d); });
      }
    }
  }
  if (logDirsConfigured.length > 0) {
    checks.push({ label: 'logDirs configured', pass: true, detail: logDirsConfigured.length + ' dir(s) configured' });
  } else {
    checks.push({ label: 'logDirs configured', pass: true, detail: 'none configured (will auto-discover)' });
    warnings.push('No logDirs configured for idea-ai source. Will rely on auto-discovery of JetBrains directories.');
  }

  // Check 2: JetBrains directories existence
  const roots = resolveSourceRoots(cfg);
  let existingRoots = 0;
  for (const r of roots) {
    try {
      const st = fs.statSync(r);
      if (st.isDirectory()) existingRoots++;
    } catch (_) {}
  }
  if (roots.length > 0) {
    checks.push({
      label: 'JetBrains dirs exist',
      pass: existingRoots > 0,
      detail: existingRoots + '/' + roots.length + ' root(s) exist'
    });
    if (existingRoots === 0) {
      warnings.push('No JetBrains directories found. Install a JetBrains IDE or configure logDirs manually.');
    }
  } else {
    checks.push({ label: 'JetBrains dirs exist', pass: false, detail: 'no roots to search' });
    warnings.push('No JetBrains roots discovered and no logDirs configured.');
  }

  const healthy = checks.every(function (c) { return c.pass; });
  return { healthy: healthy, checks: checks, warnings: warnings };
}

function capabilities() {
  return {
    archive: false,
    inventory: true,
    cliRequired: false,
    supportsExport: false,
    supportsConfigDirs: true
  };
}

module.exports = {
  name: 'idea-ai',
  type: 'idea',
  getDefaultDir: function() { return paths.defaultSessionsDir('idea'); },
  describe: function(cfg) { return { name: 'idea-ai', type: 'idea', enabled: true, notes: 'JetBrains AI Assistant log scanner' }; },
  probe: function(cfg) { return scan(cfg); },
  scan,
  renderMarkdown,
  renderSummaryJson,
  collect,
  doctor,
  capabilities,
  _internal: {
    expandEnv,
    resolveSourceRoots,
    expandRootToProductSubdirs,
    discoverLogDirsUnderProduct,
    productSubdirsUnderRoot,
    walkForLogSubDirs,
    matchKeywords,
    readPreview,
    AI_KEYWORDS,
    MAX_FILE_BYTES,
    MAX_PREVIEW_BYTES,
    MAX_PREVIEW_LINES,
    MAX_WALK_DEPTH,
    SUPPORTED_EXTS,
    IDE_PRODUCT_DIR_NAMES
  }
};
