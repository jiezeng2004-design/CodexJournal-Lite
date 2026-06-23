# Open Source Application Evidence - CodexJournal-Lite

This page is a reviewer-friendly evidence summary for open-source maintainer
support programs, including ChatGPT Pro / Codex-style open-source support
applications when such programs are available.

It does not claim eligibility. It lists public, verifiable project evidence.

## Project Summary

CodexJournal-Lite is a zero-dependency Node.js CLI and localhost dashboard that
turns local AI coding session logs from multiple sources into a searchable
private work journal. It is local-first by design: no upload, no telemetry, no
external service calls, and no third-party npm dependencies.

Repository: https://github.com/jiezeng2004-design/CodexJournal-Lite

npm package: https://www.npmjs.com/package/codexjournal-lite

Current package version: `1.4.1`

Package status: published on npm registry

Latest GitHub Release: https://github.com/jiezeng2004-design/CodexJournal-Lite/releases/tag/v1.4.1

License: MIT

## Local-First Design

The project is built around a strict local-first principle:

- All archive, analysis, verification, and dashboard rendering happens locally.
- No network calls are made for any core operation.
- No telemetry or usage data is collected or transmitted.
- No external npm dependencies are required at runtime.
- Generated personal outputs (`data/`, `journal/`, `reports/`, `dist/`) are
  gitignored by default and excluded from npm packages and public release ZIPs.
- A built-in sanitizer (`src/sanitize.js`) redacts API keys, tokens, cookies,
  authorization headers, GitHub PATs, Slack tokens, local username paths, and
  custom user-defined patterns before any output is written.

## Supported Sources

| Source | Type | Default Location | Status |
| --- | --- | --- | --- |
| Codex | `codex` | `~/.codex/sessions` | Enabled (full archive) |
| Claude Code | `claude` | `~/.claude/projects` | Enabled (full archive) |
| Gemini CLI | `gemini` | `~/.gemini/tmp` | Disabled by default (full archive) |
| OpenCode | `opencode` | `~/.local/share/opencode` (Unix) / `%LOCALAPPDATA%\opencode` (Windows) | Disabled by default (CLI / file mode) |
| JetBrains (IDEA) | `idea` | `~/.config/JetBrains` (Unix) / `%APPDATA%\JetBrains` (Windows) | Enabled (inventory probe only) |

Sources can be enabled, disabled, or reconfigured in `config.json -> sources[]`.
See [docs/sources.md](sources.md) for per-source details.

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

## Test Suite

The project includes offline fixture tests with zero external dependencies.
All tests use Node.js built-in `assert` module only.

| Script | What it tests |
| --- | --- |
| `npm run test:sources` | Source adapter fixture tests (IDEA, Claude, Gemini, OpenCode, search query) |
| `npm run test:sanitize` | Sanitizer regression tests (API keys, tokens, paths, cookies) |
| `npm run test:archive` | Multi-source archive integration tests |
| `npm run test:privacy` | Privacy acceptance test (verifies no credential leakage in outputs) |
| `npm run test:console` | Dashboard UI smoke test (HTML, CSS, API structure) |
| `npm run test:release` | Release readiness check tests |

## Privacy Posture

- **Local-first**: all processing happens on the user's machine.
- **No upload**: no data is transmitted to any external service.
- **Sanitizer**: a built-in redaction layer strips API keys, tokens, cookies,
  authorization headers, GitHub PATs, Slack tokens, local username paths, and
  custom patterns from all outputs.
- **Gitignored outputs**: personal archive data is never committed or published.
- **Public ZIP verification**: `npm run verify:public-zip` rejects generated
  journals, task records, local reports, `.git/`, `.env`, `node_modules/`, and
  nested ZIP files from public release packages.

See [docs/privacy.md](privacy.md) for the detailed privacy contract.

## Public Evidence

- Public GitHub repository with MIT license.
- Published npm package: `codexjournal-lite` (status: published).
- Zero runtime npm dependencies.
- GitHub Actions CI for fresh-clone verification on ubuntu, macOS, and Windows.
- Public release packaging workflow for version tags.
- Latest public release includes `CodexJournal-Lite-v1.4.1-public.zip` and
  `CodexJournal-Lite-v1.4.1-public.zip.sha256`.
- Public ZIP verification via `npm run verify:public-zip`.
- Screenshot-backed README showing the local dashboard.
- Dedicated privacy documentation in `docs/privacy.md`.
- Maintainer workflow guide in `docs/maintainer-workflows.md`.
- Release checklist in `docs/release-checklist.md`.
- Contributor and security documentation (`CONTRIBUTING.md`, `SECURITY.md`).
- Regression tests for sanitizer behavior, source parsing fixtures, archive
  integration, privacy acceptance, console UI, and release readiness.

## Release History

| Version | Focus |
| --- | --- |
| v1.0.0 | Stable local dashboard and API |
| v1.1.0 | Multi-source adapter architecture (Claude, Gemini, OpenCode) |
| v1.1.1 | Archive contract and workspace root hardening |
| v1.1.2 | Keyword privacy and preview hardening |
| v1.2.0 | Dashboard UX, field search, OpenCode adapter compatibility |
| v1.4.0 | Workspace console, dashboard intelligence, source doctor, release readiness |

See [CHANGELOG.md](../CHANGELOG.md) for the full release history.

## Roadmap

The development trajectory is documented in [ROADMAP.md](../ROADMAP.md),
covering completed milestones (v0.7 through v1.1) and future considerations
including multi-agent session support, timeline views, i18n, and
community report templates.

## Reviewer Verification Commands

From a fresh clone:

```bash
# Cross-platform (Windows / macOS / Linux)
git clone https://github.com/jiezeng2004-design/CodexJournal-Lite.git
cd CodexJournal-Lite
npm run verify:fresh
npm run test:sources
npm run test:privacy
npm run release:check
```

On Windows, public release packaging can also be verified:

```powershell
npm run package:public
npm run verify:public-zip
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
