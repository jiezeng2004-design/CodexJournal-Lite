'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const screenshotDir = path.join(root, 'docs', 'screenshots');
const manifestPath = path.join(screenshotDir, 'approved-manifest.json');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fail(message) {
  process.stderr.write(`[screenshot-privacy] FAIL: ${message}\n`);
  process.exitCode = 1;
}

if (!fs.existsSync(manifestPath)) {
  fail('missing docs/screenshots/approved-manifest.json');
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const approved = Array.isArray(manifest.screenshots) ? manifest.screenshots : [];
  if (manifest.source !== 'synthetic-public-demo' || manifest.manualReview !== true) {
    fail('manifest must record synthetic-public-demo provenance and manualReview=true');
  }
  const expectedNames = approved.map(item => item.file).sort();
  const actualNames = fs.readdirSync(screenshotDir).filter(name => name.toLowerCase().endsWith('.png')).sort();

  if (JSON.stringify(expectedNames) !== JSON.stringify(actualNames)) {
    fail(`screenshot set differs from approved manifest: expected=${expectedNames.join(',')} actual=${actualNames.join(',')}`);
  }

  for (const item of approved) {
    if (!/^[a-f0-9]{64}$/.test(item.sha256 || '')) {
      fail(`invalid approved SHA-256 for ${item.file}`);
      continue;
    }
    const filePath = path.join(screenshotDir, item.file);
    if (!fs.existsSync(filePath)) {
      fail(`missing approved screenshot: ${item.file}`);
      continue;
    }
    const actual = sha256(filePath);
    if (actual !== item.sha256) {
      fail(`${item.file} differs from the manually approved public-demo screenshot`);
    }
  }

  if (!process.exitCode) {
    process.stdout.write(`[screenshot-privacy] OK: ${approved.length} manually approved synthetic screenshots match SHA-256 manifest\n`);
  }
}
