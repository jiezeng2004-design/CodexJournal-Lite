# Open Source Application Evidence - CodexJournal-Lite

This page is a reviewer-friendly evidence summary for open-source maintainer
support programs, including ChatGPT Pro / Codex-style open-source support
applications when such programs are available.

It does not claim eligibility. It lists public, verifiable project evidence.

## Project Summary

CodexJournal-Lite is a zero-dependency Node.js CLI and localhost dashboard that
turns local Codex session logs into a searchable private work journal.

Repository: https://github.com/jiezeng2004-design/CodexJournal-Lite

npm package: https://www.npmjs.com/package/codexjournal-lite

Current package version: `0.6.5`

Latest GitHub Release: https://github.com/jiezeng2004-design/CodexJournal-Lite/releases/tag/v0.6.5

License: MIT

## Maintainer Role

The maintainer is responsible for the project architecture, CLI and dashboard
implementation, privacy model, documentation, release packaging, GitHub Actions
workflows, npm package publication, and regression verification.

## Problem It Solves

AI-assisted development creates useful context: debugging traces, release
decisions, PR review notes, project paths, generated files, and follow-up
tasks. That context is often scattered across local session logs and becomes
hard to search after the conversation ends.

CodexJournal-Lite keeps that knowledge local and searchable without requiring a
remote database, telemetry service, or third-party npm dependency.

## Public Evidence

- Public GitHub repository with MIT license.
- Published npm package: `codexjournal-lite`.
- Zero runtime npm dependencies.
- GitHub Actions CI for fresh-clone verification.
- Public release packaging workflow for version tags.
- Latest public release includes `CodexJournal-Lite-v0.6.5-public.zip` and
  `CodexJournal-Lite-v0.6.5-public.zip.sha256`.
- Screenshot-backed README showing the local dashboard.
- Dedicated privacy documentation in `docs/privacy.md`.
- Maintainer workflow guide in `docs/maintainer-workflows.md`.
- Contributor and security documentation.
- Regression tests for sanitizer behavior and source parsing fixtures.

## Privacy and Safety Boundary

The project is designed for local AI-work journaling, so its public evidence is
intentionally scoped:

- No telemetry.
- No upload.
- No external service call for archive, analysis, verification, or dashboard
  rendering.
- Personal generated outputs are ignored by default.
- Public release ZIPs exclude generated journals, task records, local reports,
  nested ZIP files, `.env`, `.git`, and `node_modules`.
- Sanitizer tests cover common token, cookie, authorization header, GitHub PAT,
  Slack token, JSON field, and local path patterns.

## Reviewer Verification Commands

From a fresh clone:

```powershell
# Windows PowerShell
git clone https://github.com/jiezeng2004-design/CodexJournal-Lite.git
cd CodexJournal-Lite
npm.cmd run verify:fresh
npm.cmd run package:public
npm.cmd run verify:public-zip
```

The project uses Node.js built-ins only, so there is no dependency install step
for the core verification path.

## Why Support Would Help

ChatGPT Pro / Codex-style access would directly support maintenance work:

- improving cross-platform verification and first-run experience;
- expanding privacy and sanitizer regression tests;
- documenting real maintainer workflows for AI-assisted coding;
- preparing safer public release packages;
- reviewing issues and PRs without uploading private session data.

## Current Gaps

The project is early-stage. The strongest next evidence would be:

- more external users trying the npm package;
- merged external PRs or issues from other maintainers;
- a short demo video or reproducible demo fixture;
- clearer comparison against generic note-taking or log-processing tools.
