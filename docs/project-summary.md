# Project Summary

CodexJournal-Lite is a privacy-first developer utility for turning local Codex
session files into a searchable work journal and lightweight dashboard.

## Problem

AI-assisted development can produce valuable context: project decisions,
debugging steps, generated files, terminal commands, and follow-up tasks.
However, this context is often scattered across local session logs and is hard
to review without uploading private data to another service.

## Approach

CodexJournal-Lite keeps the workflow local:

- Reads local Codex session files.
- Sanitizes sensitive paths and credential-like strings before writing outputs.
- Generates Markdown and JSON artifacts under the project directory.
- Serves a localhost-only dashboard with no external dependencies.
- Keeps personal generated artifacts out of Git through strict ignore rules.

## What Is Included

- Node.js CLI implementation in `src/`.
- PowerShell helper and verification scripts in `scripts/`.
- Localhost dashboard in `console/`.
- Privacy, source, analysis, and usage documentation in `docs/`.
- Offline fixture tests in `test-fixtures/`.
- Public release hygiene files: `LICENSE`, `SECURITY.md`,
  `CONTRIBUTING.md`, `.gitignore`, and `.gitattributes`.

## Verification

The project includes two verification modes:

- `npm.cmd run verify:fresh` for a clean clone without personal archive data.
- `npm.cmd run verify` for a full local run with archive generation,
  fixture tests, privacy checks, report generation, and ZIP packaging checks.

`npm.cmd pack --dry-run` is also used before release to confirm that the npm
package includes the full implementation, not only metadata files.

## Privacy Boundary

The public repository contains source code, docs, fixtures, screenshots, and
placeholder files. Personal generated outputs such as `data/tasks.json`,
`journal/YYYY-MM-DD.md`, `reports/*.md`, `reports/*.json`, and `dist/*.zip`
are ignored and should not be committed.
