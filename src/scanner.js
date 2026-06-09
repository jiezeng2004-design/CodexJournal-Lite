'use strict';

const fs = require('fs');
const path = require('path');

const SUPPORTED_EXTS = new Set(['.jsonl', '.transcript']);

function isSupportedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTS.has(ext);
}

function scanSessionsDir(sessionsDir, opts) {
  const maxFiles = (opts && opts.maxFiles) || 0;
  const results = [];
  const errors = [];
  if (!fs.existsSync(sessionsDir)) {
    return { files: results, errors, missing: true };
  }
  let stat;
  try {
    stat = fs.statSync(sessionsDir);
  } catch (err) {
    errors.push({ path: sessionsDir, err: err.message });
    return { files: results, errors, missing: true };
  }
  if (!stat.isDirectory()) {
    errors.push({ path: sessionsDir, err: 'not a directory' });
    return { files: results, errors, missing: false };
  }
  walk(sessionsDir, results, errors);
  // Sort: oldest mtime first for deterministic incremental processing.
  results.sort((a, b) => a.mtimeMs - b.mtimeMs);
  if (maxFiles > 0 && results.length > maxFiles) {
    return { files: results.slice(0, maxFiles), errors, missing: false, truncated: true };
  }
  return { files: results, errors, missing: false };
}

function walk(dir, out, errors) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    errors.push({ path: dir, err: err.message });
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, out, errors);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!isSupportedFile(full)) continue;
    try {
      const st = fs.statSync(full);
      out.push({
        path: full,
        size: st.size,
        mtimeMs: st.mtimeMs,
        mtimeIso: new Date(st.mtimeMs).toISOString(),
        ext: path.extname(full).toLowerCase()
      });
    } catch (err) {
      errors.push({ path: full, err: err.message });
    }
  }
}

module.exports = { scanSessionsDir, isSupportedFile, SUPPORTED_EXTS };
