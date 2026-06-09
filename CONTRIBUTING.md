# Contributing

This is a local-only, zero-dependency Windows tool. The bar for a change
landing is intentionally high.

## Hard rules

- No new npm dependencies. If a feature truly cannot be built without
  one, open an issue first and discuss.
- No network calls. Every code path must remain offline.
- No writes outside the project root.
- No modifications to the user's source `.codex/sessions` files.
- All user-facing output stays in Markdown or JSON inside this repo.
- Redaction is mandatory for Windows usernames, API keys, cookies, and
  tokens. Never widen the redaction bypass; only tighten it.

## Local development loop

```powershell
# from the project root
npm run check        # sanity check
npm run test:sources # offline unit tests for the IDEA probe
npm run verify -Fresh  # full verify, skipping the "must have data" gate
```

The `-Fresh` flag tells `verify.ps1` to skip section H's
"`journal/` has at least 1 .md / `data/tasks.json` has at least 1 task"
requirement, which is useful for a freshly-cloned repo that has not yet
been run against real session data. Standard `npm run verify` (without
`-Fresh`) is the canonical pre-handoff gate and DOES require data.

## Code style

- `console/server.js` and `console/public/app.js` must stay
  dependency-free. They use Node 18+ built-ins and vanilla DOM only.
- Match the existing file structure (`const $ = ...`, `state = {...}`,
  `api(path, opts)` helper, etc.). If you add a new API endpoint, put
  the route in the same `if (req.method === 'GET' && p === ...)`
  ladder in `console/server.js` and add a matching `state.*` field
  on the client side.
- Keep CSS variables in `style.css`. No hard-coded colors.
- New `npm run` commands must also be reflected in
  `console/server.js` `CMD_TABLE` so the dashboard can run them.
