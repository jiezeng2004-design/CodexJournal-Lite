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
git tag v0.6.2
git push origin v0.6.2
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
