# CodexJournal-Lite Local Console

A localhost-only web UI for CodexJournal-Lite. It uses only Node.js built-ins:
no external npm dependencies, no CDN, no upload.

## Start

```powershell
# Windows PowerShell, from the project root
npm.cmd run console
```

Then open:

```text
http://127.0.0.1:7777/
```

## Override

- `PORT` - default `7777`
- `HOST` - default `127.0.0.1`

Do not bind `HOST` to `0.0.0.0` unless you fully understand the exposure risk.
That would make the local project dashboard reachable from your LAN.

```powershell
# Windows PowerShell
$env:PORT = 8888
npm.cmd run console
```

## What You Can Do

- Dashboard: task, message, day, journal, report, and dist counts.
- Actions: run allowlisted local commands and watch stdout/stderr.
- Journal: list and read generated `journal/YYYY-MM-DD.md` files.
- Reports: read generated reports under `reports/`.
- Data: inspect generated data files; `data/index.json` is intentionally not
  exposed.
- Dist: list and download local zip artifacts.
- Verify: view verify output and re-run selected checks.

## Hard Rules

- Bound to `127.0.0.1` by default.
- Commands are a hardcoded allowlist.
- No arbitrary shell command is accepted from HTTP input.
- File endpoints are read-only.
- The only write paths are the same local commands exposed by the CLI, such as
  `archive`, `summarize`, `doctor`, `index:outputs`, `package:local`, and
  `verify`.
- Static assets are served from `console/public/`.

## File Map

```text
console/
  server.js          Node http + SSE, no external dependencies
  public/
    index.html       Single-page UI
    style.css        Light/dark theme, responsive layout
    app.js           Vanilla JS client for /api/*
  README.md          This file
```

## Stop

Press `Ctrl+C` in the terminal where `npm run console` is running.
