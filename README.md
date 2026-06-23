# CodexJournal-Lite

[![npm](https://img.shields.io/npm/v/codexjournal-lite)](https://npmjs.com/package/codexjournal-lite)
[![CI](https://github.com/jiezeng2004-design/CodexJournal-Lite/actions/workflows/ci.yml/badge.svg)](https://github.com/jiezeng2004-design/CodexJournal-Lite/actions/workflows/ci.yml)
[![OS: ubuntu / macos / windows](https://img.shields.io/badge/os-ubuntu%20%2F%20macos%20%2F%20windows-brightgreen.svg)](.github/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

Turn scattered AI coding sessions into a searchable local work memory — without uploading anything.

CodexJournal-Lite reads local session logs from multiple AI coding assistants
— **Codex, Claude Code, Gemini CLI, OpenCode, and JetBrains (IDEA)** — and
writes structured Markdown and JSON summaries. Everything stays on your
machine. No upload. No telemetry. No third-party npm dependencies.

## Quick Install

```bash
npx codexjournal-lite
```

Or install globally:

```bash
npm install -g codexjournal-lite
codexjournal-lite
```

For the full local workflow, clone the repository and follow the
[Install From A Fresh Clone](#install-from-a-fresh-clone) instructions.

It reads local session logs from multiple AI coding assistants, writes
Markdown and JSON summaries inside this project directory, and does not
upload data, call external services, or use third-party npm packages.

The project is designed for developers who want a lightweight, inspectable,
offline way to review their AI-assisted coding sessions: what was worked on,
when it happened, which projects were involved, and what outputs were created.

## Supported Sources

| Source | Type | Default | Status |
| --- | --- | --- | --- |
| Codex | `codex` | `~/.codex/sessions` | Enabled (full archive) |
| Claude Code | `claude` | `~/.claude/projects` | Enabled (full archive) |
| JetBrains (IDEA) | `idea` | `~/.config/JetBrains` (Unix) / `%APPDATA%\JetBrains` (Windows) | Enabled (inventory probe) |
| Gemini CLI | `gemini` | `~/.gemini/tmp` | Disabled by default (full archive) |
| OpenCode | `opencode` | `~/.local/share/opencode` (Unix) / `%LOCALAPPDATA%\opencode` (Windows) | Disabled by default (CLI / file mode) |

Enable or disable sources, and override their session directories, in
`config.json -> sources[]`. See [docs/sources.md](docs/sources.md) for
per-source details.

## What It Does

- Archives sessions from all enabled sources into `journal/YYYY-MM-DD.md`.
- Writes structured task records to `data/tasks.json`.
- Builds a full-text search file at `data/search.md`.
- Produces local reports such as `reports/dashboard.md`,
  `reports/work-patterns.md`, monthly summaries, yearly summaries, and output
  indexes.
- Provides a localhost-only dashboard at `http://127.0.0.1:7777/` with
  search filters, task detail view, heatmap week selector, and a source
  status panel.
- Includes offline fixture tests for all source adapters.

## Screenshots

> **Note:** The screenshots below show the v0.5.2-era UI. The current v1.4.x Dashboard includes additional summary cards (weekly stats, streak, source distribution, verify status), project activity panel, enhanced search with help panel and filter chips, and task detail with copy-JSON support. Updated screenshots will be provided in a future release.

| Dashboard (v0.5.2 preview) | Search (v0.5.2 preview) |
| --- | --- |
| ![Dashboard overview](docs/screenshots/01-dashboard.png) | ![Search view](docs/screenshots/02-search.png) |

| Data filter (v0.5.2 preview) | Dark search (v0.5.2 preview) |
| --- | --- |
| ![Data filter](docs/screenshots/03-data-filter.png) | ![Dark search view](docs/screenshots/04-search-dark.png) |

## Privacy Model

- No telemetry.
- No upload.
- No network calls for archive, analysis, verification, or the dashboard.
- No external npm dependencies.
- Generated personal outputs are gitignored by default:
  `data/*`, `journal/*`, `reports/*`, and `dist/*`.
- `data/index.json` is a local fingerprint cache and must never be committed.

See [docs/privacy.md](docs/privacy.md) for the detailed privacy contract.
See [docs/usage.md](docs/usage.md) for a step-by-step usage guide.
See [docs/project-summary.md](docs/project-summary.md) for a reviewer-friendly
project overview.

## Real-World Use Case

CodexJournal-Lite was built from a real maintainer workflow. As an active user of
AI coding assistants (Codex, OpenCode, Claude Code, Gemini CLI), I generate
hundreds of sessions per week — debugging steps, code reviews, refactoring
decisions, release context, and exploratory analysis. Before CodexJournal-Lite,
this knowledge was scattered across ephemeral log files that were impractical
to search or reference.

I use this tool daily to:

- **Trace past bugfix decisions**: When a regression appears, I search past
  sessions for the original debugging discussion instead of rediscovering the
  same root cause.
- **Review release history**: Before cutting a release, I scan the journal for
  which features, fixes, and refactors were discussed across multiple sessions.
- **Keep context across projects**: I maintain separate journals for different
  repositories (open-source tools, thesis research, web novel backend) by
  pointing CodexJournal-Lite at different session directories.
- **Avoid repeating work**: The search index lets me find "did I already
  explore approach X for problem Y?" across hundreds of past sessions.

The project stays local, private, and dependency-free by design — because it
was created to solve a real daily problem, not as a demonstration project.

## Requirements

- Node.js 18 or newer.
- AI coding session files in one of the supported default locations, or a
  custom path configured via `config.json`, `--sessions-dir`, or the
  `CODEXJOURNAL_SESSIONS_DIR` environment variable.
- Windows PowerShell is only needed for the legacy `package:local` and
  `package:public` scripts. All other commands work cross-platform via
  Node.js.

## Install From A Fresh Clone

```bash
# Cross-platform (Windows / macOS / Linux)
git clone https://github.com/jiezeng2004-design/CodexJournal-Lite.git
cd CodexJournal-Lite
npm run verify:fresh
```

There are no npm dependencies to install. The project uses Node.js built-ins
only. On Windows, `npm.cmd` can be used in place of `npm` if your shell
requires it.

### One-Command Run (without cloning)

```bash
npx codexjournal-lite
```

Or use the shorthand command after global install:

```bash
npm install -g codexjournal-lite
codexjournal          # shorthand for codexjournal-lite
```

This runs the archive command against your local session directories. Use
`codexjournal-lite --help` (or `codexjournal --help`) to see all available
commands.

### Workspace Root (npx / global install)

When running via `npx` or a global install, CodexJournal-Lite writes outputs
to the **current working directory** (`process.cwd()`), not the npm package
directory. This means `data/`, `journal/`, and `reports/` are created in
your current folder.

You can override the workspace root with:

- `--root <path>` CLI parameter
- `CODEXJOURNAL_ROOT` environment variable

```bash
# npx mode: outputs go to ./data, ./journal, ./reports
npx codexjournal-lite archive

# Explicit workspace root
npx codexjournal-lite archive --root /path/to/my-workspace

# Via environment variable
CODEXJOURNAL_ROOT=/path/to/workspace codexjournal-lite archive

# Clone mode: run from the project directory
cd CodexJournal-Lite
npm run archive
```

Config files are searched in this order:

1. `--config <path>` (highest priority)
2. `WORKSPACE_ROOT/config.json`
3. `APP_ROOT/config.json` (fallback for clone mode)

Relative `sessionsDir` and `logDirs` in config resolve against the config
file's directory. Output dirs (`dataDir`, `journalDir`, `reportsDir`) always
resolve against `WORKSPACE_ROOT`.

## Quick Start

```bash
# Cross-platform, from the project root
npm run check
npm run archive
npm run summarize
npm run console
```

Then open:

```text
http://127.0.0.1:7777/
```

Generated outputs stay inside the clone:

- `journal/YYYY-MM-DD.md`
- `data/tasks.json`
- `data/search.md`
- `data/stats.json`
- `reports/dashboard.md`
- `reports/work-patterns.md`

## Common Commands

```bash
# Cross-platform, from the project root
npm run check         # verify Node, config, source dir, and output dirs
npm run archive       # build journal/, data/tasks.json, data/search.md, reports/dashboard.md
npm run preview       # preview new/changed sessions without writing (shows redacted diff)
npm run build-index   # rebuild data/index.json only
npm run stats         # regenerate data/stats.json
npm run scan:sources  # inventory IDEA / JetBrains AI-related logs
npm run test:sources  # run offline fixture tests for all source adapters
npm run smoke         # zero-dependency end-to-end smoke test
npm run summarize     # build work-pattern reports from data/tasks.json
npm run doctor        # check expected project/output structure
npm run index:outputs # write reports/output-index.md and .json
npm run package:local # create a local handoff zip in dist/ (Windows PowerShell)
npm run package:public  # create a public release zip in dist/ (Windows PowerShell)
npm run verify:public-zip # validate public release zip contents (Windows PowerShell)
npm run verify:fresh   # verify a fresh clone with no personal archive data
npm run verify         # full local verification gate
```

### CLI Parameters

All commands accept these global options:

| Option | Description |
| --- | --- |
| `--sessions-dir <path>` | Override the Codex sessions directory (also updates the `codex` source in config) |
| `--config <path>` | Override the path to `config.json` |
| `--source <name>` | Filter by source name (`preview` command only: probe and preview a specific adapter) |
| `--force` | Force re-parse all files (`archive` command only) |

Environment variable `CODEXJOURNAL_SESSIONS_DIR` can also be used as an
alternative to `--sessions-dir`.

Examples:

```bash
# Archive from a custom Codex sessions directory
codexjournal archive --sessions-dir /path/to/.codex/sessions

# Preview only Claude Code sessions
codexjournal preview --source claude-code

# Use a custom config file
codexjournal archive --config /path/to/my-config.json
```

## Packaging for Release

Two packaging commands serve different purposes:

| Command | Output | Contents | Use for |
| --- | --- | --- | --- |
| `npm run package:local` | `dist/CodexJournal-Lite-v*-local.zip` | Source + your generated archive data | Personal backup / handoff |
| `npm run package:public` | `dist/CodexJournal-Lite-v*-public.zip` | Source + docs + fixtures only | **GitHub Releases** |

**`npm run package:local` is for local handoff only and may include your generated
personal outputs (`data/tasks.json`, `journal/*.md`, `reports/*.md`, etc.).**
**Do not upload local handoff packages to GitHub Releases.**

Use `npm run package:public` for any public-facing release artifact — it
excludes all generated personal data and contains only source code,
documentation, and test fixtures.

## Release Packaging

Public release packages are generated automatically by GitHub Actions when a
version tag such as `v1.4.1` is pushed.

The release workflow builds:

- `CodexJournal-Lite-v<version>-public.zip`
- `CodexJournal-Lite-v<version>-public.zip.sha256`

The public ZIP is verified before upload. It must not contain `.git/`,
`node_modules/`, `.env`, generated journals, task records, local reports, cache
files, or nested ZIP files.

For local manual verification:

```bash
npm run package:public
npm run verify:public-zip
```

> Note: `package:public` and `verify:public-zip` use Windows PowerShell
> scripts. On macOS / Linux, use the GitHub Actions release workflow instead.

Do not upload local handoff packages to GitHub Releases.

## npm Package

The `codexjournal-lite` package is available on npm:

```bash
npm install -g codexjournal-lite
codexjournal-lite
# or use the shorthand:
codexjournal
```

Or run directly without installing:

```bash
npx codexjournal-lite
```

The npm package includes the full CLI, dashboard, documentation, and test
fixtures. It has zero runtime dependencies. Both `codexjournal-lite` and
`codexjournal` are registered as bin entries.

## Project Layout

```text
CodexJournal-Lite/
  console/       Localhost dashboard, no external dependencies
  data/          Generated task records and indexes, gitignored
  dist/          Local zip packages, gitignored
  docs/          Privacy, source, and analysis documentation
  journal/       Generated daily Markdown journal, gitignored
  reports/       Generated reports and logs, gitignored
  scripts/       PowerShell and POSIX shell helper scripts
  src/           Node.js CLI implementation
  src/sources/   Multi-source adapters (codex, claude, gemini, opencode, idea)
  test-fixtures/ Offline fixture data for tests
  config.json    Editable defaults (sources, redactPatterns, plugins)
```

## Dashboard

Start the local dashboard:

```bash
# Cross-platform, from the project root
npm run console
```

The console server accepts a `--root` parameter to specify the workspace
root (where `data/`, `journal/`, `reports/`, and `dist/` are located).
This is useful when running from an npm global install or when your archive
data lives in a different directory from the source code:

```bash
# Use a custom workspace root for the dashboard
node console/server.js --root /path/to/my-workspace

# Or via environment variable
CODEXJOURNAL_ROOT=/path/to/workspace npm run console
```

The dashboard binds to `127.0.0.1` by default. It is intended for local use
only and should not be exposed to a LAN or the public internet. Features
include:

- Calendar heatmap with adjustable week count and hover tooltips
- Search with type, source, and date-range filters
- Structured field search: `source:codex`, `type:document`,
  `from:2026-06-01 to:2026-06-30`, `keyword:auth`, `path:myproject`,
  `"exact phrase"`, `-source:codex` (exclude). See `docs/usage.md`
  for full syntax.
- Task detail overlay for inspecting full metadata
- Source status panel that probes all registered adapters
- Stable API v1 endpoints (`/api/v1/tasks/:id`, `/api/v1/sources`,
  `/api/v1/search`)

## Search Syntax

The global search (Ctrl+K) and task search support structured field queries
in addition to plain keyword search. See [docs/usage.md](docs/usage.md) for
the full reference.

### Free-text search

Type any word to search across all task fields (title, summaries, keywords,
source, type, date):

```
JWT authentication
```

### Field search

Use `field:value` to search within a specific field:

| Field | Description | Example |
|-------|-------------|---------|
| `source:` | Source adapter name | `source:codex` |
| `type:` | Task type | `type:document` |
| `date:` | Date (YYYY-MM-DD or prefix) | `date:2026-06` |
| `from:` | Date range start | `from:2026-06-01` |
| `to:` | Date range end | `to:2026-06-30` |
| `title:` | Task title | `title:JWT` |
| `keyword:` | Task keywords | `keyword:auth` |
| `path:` | Project path or raw file path | `path:myproject` |

### Quoted phrases

Use double quotes for exact phrases:

```
"REST API endpoint"
```

### Negative filters (exclude)

Prefix with `-` to exclude:

```
source:codex -type:document
```

Exclude a specific source:

```
-source:codex
```

### Combined queries

```
source:codex date:2026-06 "REST API" -keyword:test
from:2026-06-01 to:2026-06-23 type:codex
```

## Troubleshooting

### OpenCode export command not found

If the OpenCode source fails with an export error, ensure the `opencode`
binary is in your PATH. The adapter tries `opencode export <sessionID>`
first (the current top-level command), then falls back to the legacy
`opencode session export --session <id> --format json`. If both fail,
check that you are running a recent version of OpenCode:

```bash
opencode --version
```

Alternatively, use `mode: "file"` in `config.json` to scan a directory
of pre-exported `.json` session files.

### No sessions found

If `opencode session list` returns no sessions, verify that OpenCode has
been used in the current environment and that session data exists in the
default data directory (`~/.local/share/opencode` on Unix or
`%LOCALAPPDATA%\opencode` on Windows).

### Journal page blank

If the Journal page shows blank content after selecting a date:
- Empty files display `No journal entries for this date.`
- Load failures display `Failed to load journal/YYYY-MM-DD.md` with the
  error detail.
- Run `npm run archive -- --force` to regenerate journal files from
  session data.

## For Open Source Maintainers

CodexJournal-Lite helps open-source maintainers keep a local, searchable log
of AI-assisted coding sessions. Review past bugfix discussions, track which
issues were explored, and search across sessions for decisions about a specific
module or dependency — all offline and private.

See [docs/maintainer-workflows.md](docs/maintainer-workflows.md) for practical
workflows for bugfix tracking, PR review, and release retrospectives.

For program reviewers, [docs/open-source-application.md](docs/open-source-application.md)
summarizes the public evidence: repository status, npm package, release
verification, privacy boundary, and maintainer support rationale.

## Why This Project Is Open Source Ready

- Source, scripts, dashboard assets, docs, fixtures, and license files are
  included in the repository.
- Personal archive outputs are ignored by default and are not part of the
  public source tree.
- The npm package allowlist includes the complete implementation, not only the
  README and package metadata.
- `npm run verify:fresh` validates a clean clone without requiring private user
  data.
- `npm run verify` runs the full local gate, including archive, source fixture
  tests, privacy checks, report generation, and local packaging.

## Verification Before Sharing

Run these from the project root:

```bash
# Cross-platform
npm run verify:fresh
npm run verify
npm pack --dry-run
```

Before publishing to GitHub, also check:

```bash
git status --short --ignored --untracked-files=all
```

Generated personal data should appear as ignored files, not as staged or
untracked files to commit.

## GitHub Publishing Notes

For a public repository, commit source, docs, scripts, fixtures, and placeholder
README files inside the generated output directories. Do not commit generated
personal archive outputs.

Expected generated files to keep out of Git:

- `data/tasks.json`
- `data/stats.json`
- `data/search.md`
- `data/index.json`
- `data/patterns.json`
- `journal/*.md`
- `reports/*.md`
- `reports/*.json`
- `reports/monthly/*`
- `reports/yearly/*`
- `dist/*.zip`

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full development trajectory, including
completed milestones (v1.0 through v1.4), future considerations, and items
that are explicitly out of scope.

## License

MIT. See [LICENSE](LICENSE).
