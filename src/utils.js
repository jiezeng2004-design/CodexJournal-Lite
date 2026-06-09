'use strict';

const path = require('path');
const fs = require('fs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function writeJsonSafe(filePath, obj) {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + '.tmp';
  const content = JSON.stringify(obj, null, 2);
  fs.writeFileSync(tmp, content, 'utf8');
  writeRenameSafe(tmp, filePath);
}

function writeTextSafe(filePath, text) {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  writeRenameSafe(tmp, filePath);
}

function writeRenameSafe(tmpPath, targetPath) {
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Remove the target first if it exists; rename on the same volume
      // should be near-atomic, but some anti-virus locks the target.
      try { fs.unlinkSync(targetPath); } catch (_) { /* ignore */ }
      fs.renameSync(tmpPath, targetPath);
      return;
    } catch (err) {
      if (attempt >= maxAttempts - 1) throw err;
      // Exponential backoff: 250ms, 500ms, 1s, 2s, 4s, 8s, 16s...
      const delay = 250 * Math.pow(2, attempt);
      const deadline = Date.now() + delay;
      while (Date.now() < deadline) { /* spin */ }
    }
  }
}

function appendTextSafe(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, text, 'utf8');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatLocalDate(d) {
  if (!d || isNaN(d.getTime())) return null;
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function formatLocalTime(d) {
  if (!d || isNaN(d.getTime())) return null;
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function safeIso(d) {
  if (!d || isNaN(d.getTime())) return null;
  return d.toISOString();
}

function shortHash(input) {
  // FNV-1a 32-bit, deterministic, no native deps
  let h = 0x811c9dc5;
  const str = String(input == null ? '' : input);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function fileFingerprint(absPath, stat) {
  const st = stat || fs.statSync(absPath);
  return shortHash(absPath + '|' + st.size + '|' + st.mtimeMs);
}

function uniqueSorted(arr) {
  const set = new Set();
  for (const v of arr) {
    if (v == null) continue;
    set.add(v);
  }
  return Array.from(set).sort();
}

function nowMs() {
  return Date.now();
}

module.exports = {
  ensureDir,
  exists,
  readJsonSafe,
  writeJsonSafe,
  writeTextSafe,
  appendTextSafe,
  formatLocalDate,
  formatLocalTime,
  safeIso,
  shortHash,
  fileFingerprint,
  uniqueSorted,
  nowMs,
  pad2
};
