# Release Checklist

This is a manual checklist for cutting a new CodexJournal-Lite release.
Follow each step in order. Do not skip the automated checks.

## 1. Pre-Release Automated Check

Run the release readiness verification. This runs 19 checks covering
version numbers, changelog entries, stale references, npm pack hygiene,
script availability, CI workflow, and documentation completeness.

```bash
npm run release:check
```

The command writes `reports/release-readiness.md` and
`reports/release-readiness.json`. If any blocker is reported, fix it
before proceeding. Warnings are advisory but should be reviewed.

## 2. Test Suite

Run the complete test suite. The `test` script invokes every `test:*`
script, including source adapters, privacy, console, root isolation,
release checks, export, tags, clustering, and migration:

```bash
npm test
```

Also run the full verification gate:

```bash
npm run verify:fresh
npm run verify
```

All commands must exit 0.

## 3. Version Number Update

Update the version in **both** locations:

1. `package.json` — set `"version": "X.Y.Z"`.
2. `CHANGELOG.md` — add or update the `## [X.Y.Z]` entry.

The version in `package.json` and the `CHANGELOG.md` entry must match
exactly. Run `npm run release:check` again after updating to confirm
check #1 and #2 pass.

## 4. CHANGELOG Authoring

Write the changelog entry following the [Keep a Changelog](https://keepachangelog.com/)
format already used in this project:

```markdown
## [X.Y.Z] - short description

### Added
- ...

### Fixed
- ...

### Changed
- ...
```

Use past tense, be specific, and reference issue numbers when applicable.
Do not include private data, real usernames, or credential-like strings.

## 5. Git Operations

The `main` branch is protected. Push a release branch, open a PR, wait for
`CI gate`, merge it, and tag the merged `main` commit:

```bash
git switch -c release/vX.Y.Z
git add -A
git commit -m "release: vX.Y.Z"
git push -u origin release/vX.Y.Z
gh pr create --base main --head release/vX.Y.Z --title "release: vX.Y.Z"
gh pr checks --watch
gh pr merge --merge --delete-branch
git fetch origin main
git tag -a vX.Y.Z origin/main -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

The tag name must be `v` + the version number (e.g. `v1.4.0`).

## 6. npm Publishing

First, do a dry run to inspect what will be published:

```bash
npm pack --dry-run
```

Verify the tarball does **not** contain:
- `data/tasks.json`, `data/stats.json`, `data/search.md`, `data/index.json`
- `journal/*.md` (generated daily journals)
- `reports/*.md`, `reports/*.json` (generated reports)
- `dist/*.zip` (local packages)
- `.git/`, `.env`, `node_modules/`

Then publish:

```bash
npm publish
```

For scoped or first-time publishes, use `npm publish --access public` if
needed.

## 7. Public Package Build

Build and verify the public release ZIP:

```bash
npm run package:public
npm run verify:public-zip
```

The `verify:public-zip` script rejects `.git/`, `.env`, `node_modules/`,
generated journals, task records, local reports, nested ZIP files, and
other non-public outputs. It must exit 0.

On macOS / Linux, use the GitHub Actions release workflow instead of the
PowerShell scripts.

## 8. GitHub Release

Create a GitHub Release for the tag:

1. Go to the repository Releases page.
2. Click "Draft a new release".
3. Select the tag `vX.Y.Z`.
4. Title: `Release vX.Y.Z`.
5. Paste the CHANGELOG entry as the release notes.
6. Attach the public ZIP and SHA256 checksum from `dist/`.
7. Publish the release.

The GitHub Actions release workflow (`.github/workflows/release.yml`)
may also build and attach the ZIP automatically when the tag is pushed.

## 9. Post-Release Verification

Verify the published package works from a clean environment:

```bash
npx codexjournal-lite help
```

Confirm the help output includes all commands:
`archive`, `check`, `preview`, `changelog`, `doctor`, `source-doctor`,
`release-check`.

Optionally install globally and run:

```bash
npm install -g codexjournal-lite
codexjournal --help
codexjournal check
```

## Quick Reference

| Step | Command | Must exit 0 |
| --- | --- | --- |
| Release check | `npm run release:check` | Yes |
| Complete test suite | `npm test` | Yes |
| Fresh verify | `npm run verify:fresh` | Yes |
| Full verify | `npm run verify` | Yes |
| npm dry run | `npm pack --dry-run` | Yes |
| Public ZIP build | `npm run package:public` | Yes |
| Public ZIP verify | `npm run verify:public-zip` | Yes |
