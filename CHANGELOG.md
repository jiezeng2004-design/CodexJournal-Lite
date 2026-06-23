# Changelog

All notable changes to **CodexJournal-Lite** are documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

## [1.4.1] - 2026-06-23

### Fixed
- Fixed issue template version placeholder.
- Strengthened release-check stale-version coverage (ISSUE_TEMPLATE + screenshot refs).
- Made doctor output distinguish required failures from optional missing user data (WARN in default mode, --strict for full check).
- Added a complete `npm test` entry point and included tag, cluster, and migration tests in the full verification gate.
- Corrected the release checklist to use the protected-branch PR workflow and all 19 release checks.
- Replaced stale, hard-coded GitHub Release notes with the matching CHANGELOG section.

### Changed
- Clarified that bundled dashboard screenshots are legacy previews rather than current v1.4.x captures.
- Updated release-facing version references to v1.4.1.

## [1.4.0] - workspace console, dashboard intelligence, source doctor, and release readiness

- Fixed Dashboard heatmap week scaling.
- Removed stale release references.
- Added workspace-root support for console and doctor.
- Added Dashboard project activity, task detail, improved summaries.
- Added Search UX help, filter chips, saved searches, and result highlighting.
- Added source-doctor and richer source adapter diagnostics.
- Added release readiness report.
- Added root/source/release tests.
- Added long-term ROADMAP.

## [1.2.0] - Dashboard UX, field search, and OpenCode adapter compatibility

### Fixed
- OpenCode adapter: export command updated from the non-existent
  `opencode session export --session <id> --format json` to the correct
  top-level `opencode export <sessionID>` command. Legacy command is tried
  as a fallback for older OpenCode versions.
- OpenCode adapter: CLI mode error messages are now sanitized via
  `sanitize.redactText()` before being written to `reports/errors.log`,
  preventing sensitive paths or credentials from leaking via stderr.
- Console light theme: `input[type=search]` background no longer uses
  `var(--code)` (which was dark `#0f172a` in both themes). A new
  `--input-bg` CSS variable provides `#ffffff` in light theme and
  `#1a212c` in dark theme.
- Journal content area: empty state (`No journal entries for this date.`)
  and error state (`Failed to load journal/YYYY-MM-DD.md`) now display
  styled messages instead of raw text or blank space.

### Added
- Structured search with field syntax: `source:`, `type:`, `date:`,
  `from:`, `to:`, `title:`, `keyword:`, `path:`. Supports quoted phrases
  (`"REST API"`) and negative filters (`-source:codex`).
- New `src/searchQuery.js` module with `parseSearchQuery()` and
  `matchTask()` functions — zero dependencies, Node.js built-ins only.
- New `src/searchQuery.test.js` with 46 tests covering parsing, field
  matching, date ranges, phrases, and negative filters.
- New `src/console.smoke.test.js` UI regression smoke test (20 checks)
  covering index.html version, CSS light theme inputs, dashboard API
  structure, search field support, journal error handling, and heatmap
  CSS variables.
- New `npm run test:console` script.
- Dashboard heatmap: CSS variables `--heatmap-cell-size` (14px) and
  `--heatmap-cell-gap` (4px) for configurable sizing. Cell size increased
  from 12px to 14px.
- Dashboard heatmap: custom hover tooltip showing date and task count,
  replacing the native SVG `<title>` element.
- Dashboard: `--dashboard-max-width` (1480px) for better wide-screen
  utilization (was 1380px).
- Top Keywords: dedicated `renderKeywords()` function with optimized
  layout (keyword + bar + count per row).
- Search UI: updated placeholder with field syntax examples and added
  syntax hint text in search footer.

### Changed
- `test:sources` script now includes `searchQuery.test.js`.
- `smoke` script now includes `console.smoke.test.js`.
- `verify.js` Section B2 now runs `test:console`.
- OpenCode adapter uses `cp.spawnSync` instead of destructured `spawnSync`
  to allow CLI mode testing via mock.
- Recent Activity layout adjusted to `72px 60px 1fr` grid with title
  truncation via `text-overflow: ellipsis`.

### Documentation
- Updated `docs/sources.md`: OpenCode adapter command reference (`opencode
  export <sessionID>`), fallback behavior, and known limitations.
- Updated `docs/usage.md`: Added Search Syntax section with field, phrase,
  and negative filter examples.
- Updated `README.md`: OpenCode source config, search syntax examples,
  troubleshooting notes.

## [1.1.2] - keyword privacy and preview hardening

### Fixed
- `keywords` field is now sanitized in `sanitizeTaskForExport()`, preventing
  API keys and tokens from leaking into `data/tasks.json`.
- `writer.buildJournal()`, `writer.buildSearch()`, `writer.buildStats()`, and
  `writer.buildDashboard()` now use `sanitize.redactKeywords()` for all
  keyword output, so `journal/*.md`, `data/search.md`, `data/stats.json`, and
  `reports/dashboard.md` no longer contain credential-like tokens.
- `classifier.tokenize()` now filters credential-like tokens (`sk-`, `ghp_`,
  `xoxb-`, `token`, `api_key`, `password`, `secret`, etc.) so they are never
  promoted to keywords in the first place.
- `preview` command now probes all enabled + archive-enabled sources by
  default, not just Codex. Missing Codex sessionsDir only produces a warning
  and does not block Claude/Gemini/OpenCode preview.
- `cfg.configPath` now correctly reflects the actual config file path when
  `--config` is passed (e.g. `/tmp/custom-name.json`).
- `archive.integration.test.js` cleanup now uses `fs.rmSync()` for cross-
  platform compatibility instead of Windows-only `rmdir`.
- `console/public/index.html` no longer hard-codes `v1.1.1`; version is now
  rendered dynamically from `/api/dashboard`.

### Added
- `sanitize.redactKeywords()` and `sanitize.isCredentialKeyword()` helpers.
- Privacy acceptance test: after archiving Claude/Gemini/OpenCode fixtures,
  grep all outputs to verify `sk-test1234567890abcdef` does not leak.
- `npm run test:privacy` script and verification coverage in `verify.js`
  Section B2 and GitHub Actions CI.

## [1.1.1] - archive contract and workspace root hardening

### Fixed
- Multi-source archive no longer aborts when Codex sessions dir is missing;
  other enabled sources (Claude, Gemini, OpenCode) still collect and write tasks.
- IDEA/JetBrains is now explicitly `archive: false` (inventory-only) in
  `config.json` and `DEFAULT_CONFIG`, matching the documented contract.
  `idea.collect()` is retained as experimental but not called by default archive.
- `writeEmptyOutputs()` now sanitizes `sessionsDir` in output metadata.
- `console/server.js` `--skip-archive` parameter casing fixed (was `--SkipArchive`).
- Stale `0.6.x` and `0.4.1` version references removed from docs, UI, issue
  templates, and generated report text.
- `changelog` command output renamed from `reports/changelog.md` to
  `reports/fingerprint-changes.md` to prevent npm from auto-including the
  generated file in the published tarball (npm treats `changelog.md` as a
  always-include CHANGELOG variant).
- Added `.npmignore` to explicitly exclude generated data/journal/reports/dist
  files from the npm tarball.

### Added
- `--root <path>` CLI parameter and `CODEXJOURNAL_ROOT` env var for npx/global
  workspace root override. Output dirs (data/journal/reports) now write to
  `WORKSPACE_ROOT` (defaults to `process.cwd()`), not the npm package directory.
- `APP_ROOT` / `WORKSPACE_ROOT` split in `src/index.js` and `src/config.js`.
- `src/archive.integration.test.js` with 6 test scenarios (16 assertions)
  covering multi-source dispatch, missing dirs, IDEA exclusion, and workspace
  isolation.
- `npm run test:archive` script.
- `sanitize.sanitizeTaskWithDiff()` — returns redaction count and pattern names
  without exposing original secrets.
- Preview command now shows `redactions: N (pattern1, pattern2)` per task.
- Sanitizer tests for `redactWithDiff` and `sanitizeTaskWithDiff`.
- `verify.js` Section B2: runs `test:sanitize`, `test:sources`, `test:archive`.
- Smoke test now covers multi-source fixture archive.

### Changed
- `verify:fresh` fresh-mode items changed from WARN to INFO (expected-empty
  in fresh clone, not user-actionable warnings).
- `config.js` `loadConfig()` now accepts `(workspaceRoot, appRoot, overrides)`.
  Relative `sessionsDir`/`logDirs` resolve against config file directory;
  `dataDir`/`journalDir`/`reportsDir` resolve against `WORKSPACE_ROOT`.
- `sources/index.js` `collectAll()` now supports `archiveOnly` option and
  `shouldArchiveSource()` / `isSourceArchiveEnabled()` helpers.
- `package.json` version bumped to `1.1.1`.

## [1.1.0] - multi-source adapter architecture

### Added
- Multi-source adapter architecture: Claude Code, Gemini CLI, and OpenCode
  source adapters (`src/sources/claude.js`, `src/sources/gemini.js`,
  `src/sources/opencode.js`) that produce the same 14-field task records as
  Codex. All enabled sources are collected in a single `archive` run.
- Plugin auto-discovery: `src/sources/index.js` scans the `src/sources/`
  directory for adapter modules at runtime. External plugins can also be
  loaded from `config.json -> plugins[]` (array of file paths).
- `src/sources/base-adapter.js` defining the standard adapter interface
  contract (`name`, `type`, `getDefaultDir`, `describe`, `probe`, `collect`).
- Stable API v1 for the dashboard: `GET /api/v1/tasks/:id` (single task full
  detail), `GET /api/v1/sources` (all registered source statuses via
  `probeAll`), `GET /api/v1/search` (global search with `type`, `source`,
  `dateFrom`, `dateTo` filters). Old routes kept as backward-compatible
  aliases.
- Dashboard enhancements: search filters (type, source, date range), task
  detail overlay, heatmap week-count selector, and a source status panel
  that probes all registered sources.
- `--sessions-dir`, `--config`, and `--source` CLI parameters for overriding
  the sessions directory, config file path, and source filter (preview only)
  without editing `config.json`.
- `CODEXJOURNAL_SESSIONS_DIR` environment variable as an alternative to
  `--sessions-dir`.
- First-run detection and guided onboarding: when no archived data is found,
  the CLI prints default session directory locations for all supported
  sources.
- `codexjournal` shorthand command registered alongside `codexjournal-lite`
  in `package.json -> bin`.
- `npm run smoke` zero-dependency smoke test (`scripts/smoke-test.js`) that
  verifies the CLI end-to-end: help, check, preview, archive, npm pack, and
  adapter auto-discovery.
- `scripts/verify.sh` POSIX shell wrapper for the cross-platform Node.js
  verify script.
- `scripts/archive.sh` POSIX shell wrapper for the archive command.
- macOS home path redaction (`/Users/<name>/`) in `src/sanitize.js`.
- Custom `redactPatterns` config hook with `flags` field support: users can
  define additional redaction rules in `config.json -> redactPatterns[]` with
  `pattern`, `replacement`, `flags`, and optional `name` fields.
- `redactWithDiff()` in `src/sanitize.js` that returns both the redacted
  result and a list of individual redactions applied, enabling the preview
  command to show a redaction diff view.
- `--source` flag for `preview` command to probe and preview a specific
  source adapter.
- Offline fixture tests for Claude Code, Gemini CLI, and OpenCode adapters
  (`src/sources/claude.test.js`, `src/sources/gemini.test.js`,
  `src/sources/opencode.test.js`).
- Test fixtures for Claude Code sessions, Gemini CLI checkpoints, and
  OpenCode exports under `test-fixtures/`.

### Changed
- Cross-platform CI matrix: GitHub Actions now runs on `ubuntu-latest`,
  `macos-latest`, and `windows-latest` with Node 20 and 22.
- `package.json` version bumped to `1.1.0`; description updated to reflect
  multi-source support.
- `config.json -> sources[]` now includes `claude-code` (enabled),
  `gemini-cli` (disabled by default), and `opencode` (disabled by default,
  `mode: cli`).
- The `archive` command now collects tasks from all enabled sources, not
  just Codex. Source-level stats are printed during the run.
- `src/paths.js` is now the single source of truth for cross-platform path
  expansion and default session directories, used by all adapters.

### Fixed
- `console/server.js` `--skip-archive` flag was not passed correctly to the
  verify command in the dashboard job runner. The flag is now forwarded
  through the command allowlist.

## [1.0.0] - stable local dashboard and API

### Added
- Stable API v1 endpoints for the localhost dashboard, providing
  backward-compatible aliases for task detail, source status, and filtered
  search.
- Dashboard task detail overlay: click any task to see full metadata
  including summaries, timestamps, keywords, and source attribution.
- Dashboard heatmap week-count selector: choose how many weeks of activity
  to display (default 12).
- Dashboard source status panel: probe all registered sources and display
  their existence, file counts, and errors.

### Changed
- Dashboard search now supports filtering by task type, source, and date
  range in addition to free-text query.
- Dashboard tabs use icon-first controls for denser navigation.

## [0.9.0] - redaction and privacy preview

### Added
- `npm run preview` now shows a redaction diff view: new and changed
  sessions are displayed with their redacted title, type, and message count
  before any file is written.
- `redactWithDiff()` function in `src/sanitize.js` that returns both the
  redacted result and a list of applied redactions for transparency.
- Custom `redactPatterns` config hook: users can define additional redaction
  rules in `config.json -> redactPatterns[]` with `pattern`, `replacement`,
  and `flags` fields.
- `sanitize.setCustomPatterns()` to load custom patterns from config at
  startup.

### Changed
- `redactText()` now applies custom patterns from config after built-in
  patterns.

## [0.8.0] - cross-platform support

### Added
- Cross-platform CI: GitHub Actions now runs verification on
  `ubuntu-latest`, `macos-latest`, and `windows-latest`.
- `scripts/verify.sh` POSIX shell wrapper for the Node.js verify script.
- `scripts/archive.sh` POSIX shell wrapper for the archive command.
- macOS home path redaction (`/Users/<name>/`) in `src/sanitize.js`.
- `src/paths.js` cross-platform path utilities supporting Windows env vars
  (`%USERPROFILE%`, `%APPDATA%`, `%LOCALAPPDATA%`), Unix env vars (`$HOME`,
  `$XDG_CONFIG_HOME`, `$XDG_DATA_HOME`), and tilde expansion (`~/`).

### Changed
- All source adapters and config resolution now use `src/paths.js` for
  cross-platform path expansion instead of scattered `expandEnv()`
  implementations.
- Default session directories are computed per-platform for each source type.

## [0.7.0] - npm package hardening and one-command startup

### Added
- `codexjournal` shorthand command registered in `package.json -> bin`
  alongside `codexjournal-lite`.
- First-run detection: when no archived data is found, the CLI prints
  default session directory locations for all supported sources to guide
  new users.
- `npm run smoke` zero-dependency smoke test (`scripts/smoke-test.js`) that
  verifies the CLI end-to-end in a fresh environment.
- `--sessions-dir`, `--config`, and `--source` CLI parameters for overriding
  configuration without editing `config.json`.
- `CODEXJOURNAL_SESSIONS_DIR` environment variable as an alternative to
  `--sessions-dir`.

### Changed
- `npm run verify` and `npm run verify:fresh` now work cross-platform via
  Node.js, not only Windows PowerShell.

## [0.6.6] - unified path utilities and adapter extraction

### Added
- `src/paths.js` unified cross-platform path utilities: `expandEnv()`,
  `defaultSessionsDir()`, `joinSafe()`, `isWindows()`, `homeDir()`. Replaces
  scattered `expandEnv()` implementations in `config.js`, `idea.js`, and
  `verify.js` with a single source of truth.

### Changed
- IDEA / JetBrains log scanning logic extracted into the standard adapter
  interface (`src/sources/idea.js`), conforming to the same `probe` /
  `collect` contract as other source adapters.
- `src/sources/idea-parser.js` extracted as a standalone module for IDEA log
  parsing, with offline fixture test coverage.

## [0.6.5] - cross-platform verify and source parsing preview

### Added
- Cross-platform Node.js verification entrypoint: `npm run verify` and `npm run verify:fresh` now work outside Windows PowerShell.
- Windows-only legacy verification remains available as `npm run verify:ps1`.
- `npm run preview` to show new or changed Codex sessions without writing archive outputs.
- `npm run changelog` to write a local `reports/fingerprint-changes.md` summary from session fingerprint changes.
- IDEA AI Assistant log parser with offline fixture coverage.
- Claude Code source registry stub and read-only probe scaffold for future archive integration.
- Optional `redactPatterns` config hook for local custom redaction rules.

### Changed
- Dashboard activity chart now uses a compact heatmap view.
- Dashboard tabs use icon-first controls for denser navigation.
- Auto-archive logging captures command output before reading `$LASTEXITCODE`.
- Scheduled task installer uses `InteractiveToken` and supports `-StartNow`.
- README now documents the cross-platform verify path and new preview/changelog commands.

### Fixed
- Removed a CSS syntax error in the KPI card hover block.
- Corrected IDEA session-end matching to use whitespace regexes instead of literal `\s`.
- Cleaned up `src/verify.js` helper formatting so bundled verification remains parse-safe.

## [0.6.4] - Sanitizer regression coverage

### Added
- Added offline sanitizer regression tests (`npm run test:sanitize`) covering common API key, token, cookie, session, authorization header, GitHub PAT, Slack token, Windows username path, and JSON field redaction cases.
- Added sanitizer regression tests to GitHub Actions CI.
- Documented sanitizer regression coverage in contributor and privacy documentation.

### Changed
- `redactPath` now accepts the same redaction options as `redactText`, making path redaction tests deterministic in CI.
- GitHub PAT redaction is now case-insensitive.

### Security
- Replaced real local username examples with fixture-style placeholders.
- Strengthened regression coverage for local-only privacy guarantees.

## [0.6.3] - npm publishing and maintainer workflows

### Added
- Published `codexjournal-lite` to npm registry.
- Support for `npx codexjournal-lite` one-command startup.
- Support for `npm install -g codexjournal-lite`.
- `ROADMAP.md` with v0.7-v1.0 development trajectory.
- `docs/maintainer-workflows.md` - practical workflows for bugfix tracking, PR review, and release retrospectives.
- npm version badge in README.
- "Why It Matters" section in README - explains the problem CodexJournal-Lite solves.
- "For Open Source Maintainers" section guiding OSS maintainers to relevant workflows.

### Changed
- `package.json` version bumped to `0.6.3` with `preferGlobal: true`.
- README quick install section now shows `npx` and `npm install -g` as primary install methods.
- README release packaging example now references the current `v0.6.3` tag.
- `ROADMAP.md` now treats npm as an existing distribution path and focuses
  v0.7 on package hardening, smoke tests, and first-run improvements.

## [0.6.2] - Automated release packaging

### Added
- Automated GitHub Release workflow for version tags (`.github/workflows/release.yml`).
- `npm run verify:public-zip` to validate public release ZIP archives.
- SHA256 checksum generation for release ZIP files.
- Release packaging documentation in README and usage guide.

### Changed
- CI now verifies public release packaging (`package:public` + `verify:public-zip`) in addition to fresh clone checks.

### Security
- Public release ZIP verification rejects `.git/`, `.env`, `node_modules/`, generated journals, task records, local reports, nested ZIP files, and other non-public outputs.

## [0.6.1] - CI and public release hardening

### Added
- GitHub Actions CI (`ci.yml`) for fresh clone verification on every push / PR.
- Bug report and feature request issue templates (`.github/ISSUE_TEMPLATE/`).
- Pull request template with privacy and verification checklist.
- `npm run package:public` for GitHub Release-safe public archives.
- README guidance that distinguishes public release packages from local handoff packages.
- CI badge, license badge, Node version badge, and zero-dependency badge in README.

### Fixed
- `npm run check` no longer fails when `sessionsDir` does not exist on a fresh clone or CI runner. Missing sessions directory is now a WARN, not a FAIL. `check` only exits 1 for missing Node >= 18, unwritable output dirs, or severely broken config.
- Public release packaging (`package:public`) now excludes all generated personal outputs.
- Source fixture tests (`test:sources`) no longer treat common CI, Docker, or system usernames (`root`, `ci`, `runner`, `runneradmin`, `node`, `default`, `user`, `administrator`, `public`) as private real usernames. This prevents false failures in GitHub Actions and container environments.

### Security
- Clarified security reporting guidance: explicitly ask reporters not to paste private Codex session content, API keys, local usernames, or generated journal outputs into public issues.
- PR template requires confirmation that no private data or generated outputs are included.

## [0.6.0] - public re-release

Re-published as a clean public repo with **no local data, no real
usernames, and no session content in git**. Suitable for sharing on
GitHub.

### Added
- `LICENSE` (MIT) - first time the project ships with a permissive
  license.
- `SECURITY.md` - private vulnerability reporting instructions.
- `CONTRIBUTING.md` - hard rules and local dev loop.
- `docs/screenshots/` - reference dashboard screenshots used in
  `README.md`.
- `verify -Fresh` / `npm run verify:fresh` - the verify script now
  accepts a `-Fresh` flag that skips section H's
  "must have at least 1 task and 1 journal file" requirement, so a
  freshly-cloned repo can sanity-check the install with zero data.
- `README.md` rewritten as a public-facing introduction with quick
  start, privacy summary, and per-directory commitment table.
- `reports/dashboard.md` is now the generated local archive dashboard.
  `npm run archive` no longer overwrites the public `README.md`.
- `package.json` now declares an explicit `files` allowlist for npm
  packing, so generated personal archive outputs stay out of tarballs.
- `.gitignore` now ignores all of `data/`, `journal/`, `reports/`, and
  `dist/` by default and only allows back in a small set of
  intentional placeholder files (`.gitkeep`, `README.md`) so the
  directories stay in git.

### Removed
- 224 task records (`data/tasks.json`) and the 31-day `journal/` and
  `reports/` history. These were personal development data, not source
  code. They are reproducible on any clone by running
  `npm run archive`.
- `dist/CodexJournal-Lite-v0.5.2-local.zip` - the old handoff artifact
  contained the same personal data and is rebuilt locally by
  `npm run package:local`.
- The auto-regenerated `README.md` version block (with task counts).
  Public README is now hand-written; the in-tree dynamic regenerator
  now targets `reports/dashboard.md`.

### Notes
- The original development tree can keep personal archive data. The
  public publishing tree should commit source and placeholders only.
- `package.json` is bumped to `0.6.0` because this is a publishing
  milestone (license, public-readiness, `-Fresh` verify), not just a
  cosmetic re-export.
- Source, console, and verification scripts were updated so the public
  README remains documentation while generated personal dashboards stay
  under gitignored `reports/`.

## [0.5.2] - local handoff and packaging

Local packaging, output index, and environment doctor check. **No archive,
analysis, or source-scan logic changed.**

### Added
- `npm run doctor` - environment and output completeness check. Writes
  `reports/doctor.md`. Checks Node version, directory structure, config
  validity, script availability, and expected output file presence.
- `npm run index:outputs` - generates a complete output file index as
  `reports/output-index.md` (human-readable) and
  `reports/output-index.json` (machine-readable). Every path is
  redacted before writing.
- `npm run package:local` - creates `dist/CodexJournal-Lite-v0.5.2-local.zip`
  containing src/, scripts/, docs/, config, journal/, data/* (except
  `data/index.json`), and reports/. Excludes `node_modules/`, `.git/`,
  `.env`, `dist/`, `reports/errors.log`, and `*.tmp`.
- `scripts/package-local.ps1` - the packaging script. Includes an
  inline exclusion check that scans the archive for leaked items and
  warns if any are found.
- `scripts/verify.ps1` **Section M** - runs `npm run doctor`,
  `npm run index:outputs`, and `npm run package:local`; verifies each
  output file exists; validates `output-index.json` schema via Node.js;
  checks the zip archive for exclusions using .NET API; and confirms
  no protected files were mutated.

## [0.5.1] - report quality polish

Report readability improvements and stronger verify coverage for
monthly / yearly summary outputs.

### Added
- Long tasks and recent tasks now rendered as Markdown tables
  (`date | time | type | messages | title`) instead of loose list
  items, making them scannable at a glance.
- Title / snippet cleaning: newlines, control characters, and
  leading/trailing whitespace are stripped before truncation so
  table rows never break across lines.
- Project path distribution filtering: URLs (`http://`, `https://`,
  `s://`), plugin URIs (`plugin://`, `app://`, `n://`) and
  obviously non-local URI schemes are excluded from the project-
  path table.
- `Data Quality Notes` section in `reports/work-patterns.md` that
  reminds the reader the analysis is based on heuristic
  classification and that IDEA logs are still not parsed.
- `scripts/verify.ps1` L segment now also scans
  `reports/monthly/*.md` and `reports/yearly/*.md` for real
  Windows usernames and credential patterns.

### Fixed
- `reports/work-patterns.md` and the monthly / yearly reports now
  pass the same UTF-8 byte-level username and credential leak
  checks as the archive-path outputs.

## [0.5.0] - summaries and work patterns

Rule-based monthly/yearly summaries and work-pattern analysis built
on top of the existing `data/tasks.json` export. **No AI, no network,
no IDEA logs parsed.** The Codex archive and IDEA inventory paths
remain unchanged.

### Added
- `npm run summarize` - rule-based analysis command. Reads
  `data/tasks.json`, writes `data/patterns.json`,
  `reports/work-patterns.md`, `reports/monthly/*.md`,
  `reports/yearly/*.md`.
- `src/analysis.js` - the full analysis pipeline (groupByMonth,
  groupByYear, buildPatterns, renderMonthlyReport,
  renderYearlyReport, renderWorkPatternsReport). No external
  dependencies, no AI.
- `data/patterns.json` - machine-readable pattern summary with
  totals, by-month, by-year, by-type, by-source, by-project-path,
  top-keywords, time-of-day, weekday, longTasks, recentTasks, and
  rule-based insights.
- `reports/work-patterns.md` - human-readable full report covering
  all the same dimensions plus the privacy note.
- `reports/monthly/YYYY-MM.md` - per-calendar-month summary with
  task types, top keywords, top projects, time-of-day distribution,
  long tasks, and insights.
- `reports/yearly/YYYY.md` - per-year summary with monthly trend
  table, same sections as monthly.
- `docs/analysis.md` - explains the analysis pipeline, input, output,
  rules, time-of-day boundaries, and what summarize does **not** do.
- `scripts/verify.ps1` **Section L** - runs `npm run summarize`,
  verifies all output files exist, confirms via SHA-256 snapshot that
  summarize did not mutate any archive / scan-sources output, and
  checks for real-username and credential leaks in the new files.

### Notes
- Rule-based only. No external AI, no network.
- Does not parse IDEA logs into journal/tasks.
- Does not modify archive data files (`data/tasks.json`,
  `data/stats.json`, `data/search.md`, `data/index.json`,
  `journal/*.md`, `README.md`, `reports/idea-log-inventory.md`,
  `reports/source-scan-summary.json`).
- The verify gate now covers the analysis pipeline, so a future
  change that breaks the aggregate rules will fail the gate.

## [0.4.1] - inventory robustness

Hardens the v0.4.0 IDEA / JetBrains inventory probe. **No IDEA log
content is parsed into tasks.** All output stays in `reports/`.

### Added
- `reports/source-scan-summary.json` - machine-readable scan summary
  written by `npm run scan:sources`. Contains per-source
  `searchedRoots`, `existingRoots`, `discoveredLogDirs`,
  `existingRootsWithoutLogDirs`, `candidateFiles`, `likelyAiFiles`,
  `skippedLargeFiles`, `errors`, `summary` and a capped
  `likelyAiFileSample`. All paths go through `src/sanitize.js`
  before being written.
- `npm run test:sources` - offline Node.js test suite that exercises
  the IDEA probe against a synthetic log tree under
  `test-fixtures/idea-logs/`. Does **not** depend on any real
  JetBrains installation. Exit 0 on success, 1 on failure.
- `test-fixtures/idea-logs/JetBrains/PyCharm2025.3/log/idea.log` -
  normal JetBrains startup messages plus a small number of
  `OpenAI` / `Chat` keywords.
- `test-fixtures/idea-logs/JetBrains/PyCharm2025.3/log/ai-assistant.log`
  - obvious `AI Assistant` / `prompt` / `model` / `OpenAI` /
  `Anthropic` / `Copilot` / `completion` / `assistant` keywords.
- `test-fixtures/idea-logs/JetBrains/PyCharm2025.3/log/normal.log` -
  plain JetBrains lifecycle messages, no AI keywords.
- Broader JetBrains log directory discovery. v0.4.1 explicitly
  looks for the canonical log sub-directories
  (`log` / `logs` / `system/log` / `system/logs`) under each
  candidate root, in addition to the depth-bounded walk carried
  over from v0.4.0.
- `src/sources/idea.js` v0.4.1 result structure now separates
  `searchedRoots` / `existingRoots` / `discoveredLogDirs` /
  `existingRootsWithoutLogDirs`. The v0.4.0 field names
  (`searchedDirs`, `existingDirs`) are still populated for back-
  compat.
- `scripts/verify.ps1` Section K now also runs
  `npm run test:sources`, asserts the existence of
  `reports/source-scan-summary.json`, validates that file as JSON,
  and runs the same UTF-8 byte-level real-username check on it.
  The mutation allowlist grew from one file to two:
  `reports/idea-log-inventory.md` and
  `reports/source-scan-summary.json`.

### Notes
- v0.4.1 is **inventory-only**. No IDEA log content is parsed into
  `journal/`, `data/tasks.json`, `data/stats.json`,
  `data/search.md`, or `data/index.json`.
- The fixtures are synthetic, ship with the project, and are
  regenerated manually when the test cases change. They do **not**
  represent any real user's logs.
- `npm run verify` now exercises the offline test suite
  (`test:sources`) as part of Section K, so a future change to the
  heuristic keywords or the discovery logic that breaks the
  fixtures will fail the verify gate even on machines that have
  no real JetBrains installation.

## [0.4.0] - source inventory

Adds the multi-source registry scaffolding and a **read-only** IDEA /
JetBrains AI log inventory probe. The Codex archive path is **unchanged**.

### Added
- `src/sources/` multi-source registry (`index.js` + per-source
  modules). The Codex source is metadata-only here; the actual
  archive pipeline still goes through the v0.1-v0.3.1 `scanner.js` /
  `parser.js` / `classifier.js` / `writer.js` stack, byte-for-byte.
- `npm run scan:sources` - read-only probe. Walks candidate
  JetBrains / IDEA log directories (e.g. `%APPDATA%\JetBrains`,
  `%LOCALAPPDATA%\JetBrains`, `%USERPROFILE%\.IntelliJIdea*`,
  `...\.WebStorm*`, `...\.PyCharm*`), finds `log` / `logs` /
  `system/log` / `system/logs` sub-directories, lists every file
  with extension `.log` / `.txt` / `.json` / `.jsonl` whose path or
  first 50 KB preview matches one of the AI-related heuristic
  keywords (`AI Assistant`, `JetBrains AI`, `AIAssistant`, `LLM`,
  `Chat`, `OpenAI`, `Anthropic`, `Copilot`, `completion`, `prompt`,
  `model`, `assistant`, `ai-assistant`). Files larger than 20 MB
  are skipped without being read; per-file previews are capped at
  50 KB and 20 lines; all paths and preview lines are passed
  through `src/sanitize.js` before being written.
- `reports/idea-log-inventory.md` - the human-readable inventory
  produced by `npm run scan:sources`. Always overwritten on each
  scan run.
- `scripts/verify.ps1` **Section K** - the existing end-to-end
  verify gate now (1) runs `npm run scan:sources`, (2) checks that
  `reports/idea-log-inventory.md` exists, (3) confirms via SHA-256
  snapshot that `scan-sources` did not modify `README.md`,
  `journal/*.md`, `data/tasks.json`, `data/stats.json`,
  `data/search.md`, or `data/index.json`, and (4) verifies that the
  inventory file does not contain a real Windows username path
  (byte-level UTF-8 check, no PowerShell-5.1 encoding quirks).
- `config.json -> sources[]` block. Default entries:
  - `codex` (type=`codex`, enabled) - the full archive path.
  - `idea-ai` (type=`idea`, enabled) - the read-only probe.
    `logDirs` is an empty list by default; add your own directories
    there to override the auto-detected candidates.

### Notes
- v0.4.0 does **not** parse IDEA / JetBrains log content into
  `journal/`, `data/tasks.json`, `data/stats.json`, or
  `data/search.md`. Only the inventory report is written.
- The Codex archive pipeline is unchanged. v0.4.0 only adds a
  parallel, optional read-only probe that the user can run on
  demand via `npm run scan:sources`.
- `data/index.json` semantics are unchanged: still a local-only
  fingerprint cache (gitignored) that is **not** allowed to be
  modified by the scan-sources path; the new K check enforces
  this byte-for-byte.
- `npm run verify` now includes the scan-sources safety checks
  described above. The verify script never runs a real
  `git add` / `git commit` / `git push`, and never calls
  `install-task.ps1`.

## [0.3.1] - stable roll-up

No changes to the core archive / sanitize / classify pipeline. This release
tightens documentation, adds an end-to-end verify script, and freezes the
public surface for hand-off.

### Added
- `npm run verify` - one-shot end-to-end check that runs `check`, force
  `archive`, scans for real Windows username leaks, scans for real
  credential patterns, checks title pollution, checks field and date
  integrity, and exercises the `git-commit.ps1 -DryRun` safety path.
  Wired up in `package.json` and implemented in `scripts/verify.ps1`.
- `CHANGELOG.md` (this file).
- `docs/privacy.md` - what the project reads, what it writes, and what
  the redaction layer covers today.
- `docs/sources.md` - which AI client logs are supported in this
  release and which are explicitly **not** yet supported.
- README **Version / Roadmap / Verification / Documentation** section,
  regenerated on every `npm run archive` from `src/writer.js` so it
  cannot drift away from the code.

### Notes
- 100% local. No network calls, no telemetry, no upload.
- Original `.codex/sessions` files are never modified or deleted.
- `data/index.json` is a local-only fingerprint cache (gitignored) and
  may keep the original absolute path of each session file as a key so
  that incremental lookups stay stable.

## [0.3.0] - automation

### Added
- `scripts/git-commit.ps1` - safe `git add` + `git commit` driver. Refuses
  to run when the current directory is not a git repository root
  (prevents accidentally staging files from a parent workspace), and
  never pushes.
- `scripts/install-task.ps1` - registers a Windows Task Scheduler entry
  (`CodexJournal-Lite Daily Archive`) that runs `npm run archive` once
  a day at 00:10. **Not auto-installed by verify or any other command.**
- `scripts/run-archive.ps1` - the small entry point the scheduled task
  invokes.

## [0.2.0] - data and search

### Added
- `data/tasks.json` - per-session task records (id, date, time, source,
  projectPath, title, taskType, keywords, userSummary, assistantSummary,
  rawFilePath, messageCount, firstTimestamp, lastTimestamp).
- `data/stats.json` - aggregate dashboard source: totals, by source, by
  task type, by day, top keywords.
- `data/search.md` - VS Code / editor friendly full-text search index
  grouped by day, with title, type, keywords and redacted snippets.

## [0.1.0] - first cut

### Added
- `src/scanner.js` - recursive scan of `%USERPROFILE%\.codex\sessions`
  for `.jsonl` and `.transcript` files.
- `src/parser.js` - per-line JSONL parser for the Codex roll-out shape
  (`session_meta`, `event_msg`, `response_item`, `turn_context`). A
  single bad line never aborts the whole file.
- `src/sanitize.js` - redaction layer (API keys, Bearer tokens, cookie
  / session, GitHub / Slack tokens, Windows user paths in `C:\Users\<u>`,
  `C:/Users/<u>`, `C:\\Users\\<u>\\`, plus PowerShell prompt form
  `C:\Users\<u>>`).
- `src/classifier.js` - heuristic task type + keyword extraction; strips
  the AGENTS.md / `<INSTRUCTIONS>` / `<environment_context>` /
  `>>>` transcript blocks before classifying or naming a task.
- `src/writer.js` - writes `journal/YYYY-MM-DD.md` (grouped by message
  local date, **not** by file mtime), `data/tasks.json`, `data/stats.json`,
  `data/search.md`, and the project-root `README.md`.
- `journal/YYYY-MM-DD.md` - one Markdown file per local day, with all
  tasks grouped under their `HH:MM` start time.
