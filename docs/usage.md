# Usage Guide

CodexJournal-Lite is intentionally small: clone the repository, run the CLI
against local Codex session files, and inspect the generated Markdown/JSON
outputs or the localhost dashboard.

## 1. Verify A Fresh Clone

Run this before using the project on a new machine:

```powershell
# Windows PowerShell, from the project root
npm.cmd run verify:fresh
```

This checks the project structure, CLI entrypoint, fixture tests, privacy
guards, and packaging metadata without requiring any personal archive data.

## 2. Check Local Paths

```powershell
# Windows PowerShell, from the project root
npm.cmd run check
```

The command verifies:

- Node.js version.
- Codex session directory configured in `config.json`.
- Writable output directories: `journal/`, `data/`, and `reports/`.

If your Codex sessions are not under `%USERPROFILE%\.codex\sessions`, edit
`config.json` and set `sessionsDir` to your local session path.

### Workspace root (npx / global install)

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

# Clone mode: run from the project directory
cd CodexJournal-Lite
npm run archive
```

### Config file resolution

Config files are searched in this order:

1. `--config <path>` (highest priority)
2. `WORKSPACE_ROOT/config.json`
3. `APP_ROOT/config.json` (fallback for clone mode)

Relative `sessionsDir` and `logDirs` in config resolve against the config
file's directory. Output dirs (`dataDir`, `journalDir`, `reportsDir`) always
resolve against `WORKSPACE_ROOT`.

## 3. Build A Local Journal

```powershell
# Windows PowerShell, from the project root
npm.cmd run archive
```

This creates local outputs:

- `journal/YYYY-MM-DD.md`: daily Markdown journal files.
- `data/tasks.json`: structured task records.
- `data/stats.json`: dashboard statistics.
- `data/search.md`: searchable full-text index.
- `reports/dashboard.md`: Markdown dashboard summary.

These files are personal generated data and are ignored by Git.

## 4. Generate Analysis Reports

```powershell
# Windows PowerShell, from the project root
npm.cmd run summarize
```

This reads `data/tasks.json` and writes:

- `data/patterns.json`
- `reports/work-patterns.md`
- `reports/monthly/*.md`
- `reports/yearly/*.md`

No network access or AI API calls are used.

## 5. Open The Dashboard

```powershell
# Windows PowerShell, from the project root
npm.cmd run console
```

Open:

```text
http://127.0.0.1:7777/
```

The dashboard is served from `console/server.js` and binds to localhost by
default.

### Search Syntax

The global search (Ctrl+K) and task search support structured field queries
in addition to plain keyword search.

#### Free-text search

Type any word to search across all task fields (title, summaries, keywords,
source, type, date):

```
JWT authentication
```

#### Field search

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

Field values are matched as case-insensitive substrings. For example,
`source:codex` matches both `codex-sessions` and `codex`. The `date:` field
supports prefix matching, so `date:2026-06` matches any day in June 2026.

#### Available task types

The `type:` field supports the following values (classified by the
deterministic classifier in `src/classifier.js`):

| Type | Description | Example keywords |
|------|-------------|-----------------|
| `thesis` | Thesis / academic research | 毕业论文, thesis, 基因, 耐旱, 答辩, 开题 |
| `document` | Document formatting / editing | word, .docx, 论文排版, 降重, ppt, markdown |
| `zotero` | Reference management | zotero, 参考文献, citation, bibtex |
| `openclaw` | OpenClaw tool sessions | openclaw, gateway, dashboard |
| `codex` | Codex CLI sessions | codex, computer use, node_repl |
| `frontend` | Frontend development | 前端, html, css, react, vite, vue, 页面, 布局 |
| `environment` | Environment / troubleshooting | 环境, 排错, 报错, 权限, 端口, powershell, wsl |
| `code` | General coding | 代码, 脚本, python, javascript, git |
| `general` | Unclassified | (fallback when no rule matches) |

Chinese type examples:

```
type:thesis          # 搜索毕业论文相关会话
type:document        # 搜索文档排版相关会话
type:frontend        # 搜索前端开发相关会话
type:environment     # 搜索环境排错相关会话
```

#### Quoted phrases

Use double quotes for exact phrases:

```
"REST API endpoint"
```

Quoted phrases can also be used as field values:

```
title:"REST API"
keyword:"user authentication"
```

#### Negative filters (exclude)

Prefix with `-` to exclude:

```
source:codex -type:document
```

Exclude a specific source:

```
-source:codex
```

Exclude multiple values:

```
-type:document -type:thesis
```

#### Combined queries

```
source:codex date:2026-06 "REST API" -keyword:test
from:2026-06-01 to:2026-06-23 type:codex
```

Search for thesis-related sessions in June, excluding test keywords:

```
type:thesis from:2026-06-01 to:2026-06-30 -keyword:test
```

Search across all sources for frontend work in a specific project:

```
path:myproject type:frontend
```

## 6. Run The Full Verification Gate

```powershell
# Windows PowerShell, from the project root
npm.cmd run verify
```

The full gate checks:

- CLI health.
- Archive generation.
- Credential and local username redaction.
- Task schema completeness.
- Offline fixture tests.
- Summary report generation.
- Doctor and output index reports.
- Local ZIP packaging.
- ZIP entry paths use POSIX separators such as `console/server.js`.

## 7. Package Locally

```powershell
# Windows PowerShell, from the project root
npm.cmd run package:local
```

This writes `dist/CodexJournal-Lite-v<version>-local.zip`. The archive is
intended for local handoff and is ignored by Git.

## 8. Verify Public Release ZIP

```powershell
# Windows PowerShell, from the project root
npm.cmd run package:public
npm.cmd run verify:public-zip
```

The verification script checks:

- ZIP file exists.
- All paths use POSIX forward slashes.
- Required public files are present (`src/index.js`, `package.json`, `README.md`,
  `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `config.json`,
  `.github/workflows/ci.yml`, `docs/privacy.md`, `console/server.js`, etc.).
- No forbidden entries: `.git/`, `node_modules/`, `.env`, generated journal
  entries, task records (`data/tasks.json`), reports (`reports/*.md`), cache
  files (`data/index.json`), or nested ZIP files (`dist/*.zip`).

## 9. Public Release Flow

For maintainers:

1. Update `package.json` version.
2. Update `CHANGELOG.md`.
3. Run local checks.
4. Commit and push.
5. Create and push a version tag.

```powershell
git tag v1.4.0
git push origin v1.4.0
```

The release workflow will build, verify, and upload the public release archive
automatically.

## 10. Confirm Publish Hygiene

Before committing or publishing:

```powershell
# Windows PowerShell, from the project root
npm.cmd run verify:fresh
npm.cmd run verify
npm.cmd pack --dry-run
git status --short --ignored --untracked-files=all
```

The Git status should show source files, docs, fixtures, and placeholder files
as commit candidates. Personal generated files under `data/`, `journal/`,
`reports/`, and `dist/` should be ignored or absent.
