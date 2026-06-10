## Description

<!-- Briefly describe what this PR changes and why. -->

## Checklist

Before submitting, confirm each item:

- [ ] `npm.cmd run verify:fresh` passes on a clean clone
- [ ] `npm.cmd run test:sources` passes (offline fixture tests green)
- [ ] `npm.cmd pack --dry-run` shows only source, docs, fixtures, and placeholder files
- [ ] No generated personal outputs are committed (`data/tasks.json`, `data/stats.json`, `data/search.md`, `data/patterns.json`, `data/index.json`, `journal/*.md`, `reports/*.md`, `reports/*.json`, `reports/monthly/*`, `reports/yearly/*`, `dist/*.zip`)
- [ ] No new npm dependencies added
- [ ] No network calls introduced
- [ ] All new or changed paths in user-facing output go through `src/sanitize.js`
- [ ] New `npm run` commands are reflected in `console/server.js` `CMD_TABLE` (if applicable)
- [ ] `CHANGELOG.md` updated (if this is a user-visible change)

## Privacy

- [ ] I did not commit generated personal outputs (`data/tasks.json`, `journal/*.md`, `reports/*.md`, `dist/*.zip`, etc.)
- [ ] I did not include API keys, local usernames, absolute private paths, or private session content
