# CodexJournal-Lite agent rules

CodexJournal-Lite is a local-first session journal and dashboard. Privacy, deterministic sanitization, public-package boundaries, and cross-platform behavior are release requirements.

## Commands

Run from this repository in Windows PowerShell:

```powershell
npm.cmd run test:sanitize
npm.cmd run test:sources
npm.cmd run verify:fresh
npm.cmd run package:public
npm.cmd run verify:public-zip
npm.cmd pack --dry-run
```

Use the tests related to a small change during iteration, then run the full chain before PR or release claims.

## Privacy and packaging

- Never commit or package generated journals, reports, local config, task records, usernames, absolute personal paths, credentials, `.env`, nested archives, or browser data.
- Keep sanitizer fixtures synthetic. Do not replace them with real user content.
- A successful local ZIP or version bump is preparation only; verify the remote tag, GitHub Release, npm version, and `dist-tags.latest` separately.
- Preserve PowerShell/Windows compatibility while keeping Node logic portable where supported.

## Git workflow

- Use branch -> PR -> `CI gate` -> merge. Do not push directly to `main`.
- Update tests, README/docs, CHANGELOG, package metadata, and public-package checks when user-visible behavior changes.
- This repository may have multiple local clones. Never assume the current clone is canonical without checking path, branch, remote, and dirty state.
