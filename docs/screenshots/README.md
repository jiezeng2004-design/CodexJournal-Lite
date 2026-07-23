# Public screenshots

The PNG files in this directory must be generated from a fully synthetic workspace. Never capture documentation screenshots from a real CodexJournal archive or enabled local source directory.

Generate a clean demo workspace outside the repository:

```powershell
npm.cmd run create:public-demo -- --out C:\Public\CodexJournalDemoWorkspace
$env:PORT = '17777'
node console/server.js --root C:\Public\CodexJournalDemoWorkspace
```

Before approving replacement screenshots, inspect every image at full resolution for:

- real usernames or home directories;
- real workspace, session, attachment, or source paths;
- share links, session identifiers, account identifiers, or tokens;
- real task titles, prompts, assistant output, or journal text;
- browser, terminal, or notification overlays.

After manual review, update `approved-manifest.json` with the five SHA-256 values and run:

```powershell
npm.cmd run test:screenshots
npm.cmd run package:public
npm.cmd run verify:public-zip
npm.cmd pack --dry-run
```

The hash manifest prevents an unreviewed screenshot replacement from entering the public ZIP or npm package. It does not replace full-resolution human review.

## History cleanup

On 2026-07-23, the repository history was rewritten under maintainer authorization to remove the pre-v1.4.3 screenshot objects. The five files currently in this directory are the synthetic, manually approved v1.4.3 screenshots listed in `approved-manifest.json`.
