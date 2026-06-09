# Changelog

All notable changes to **CodexJournal-Lite** are documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

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
