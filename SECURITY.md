# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a suspected security problem.
Email the maintainer (see `package.json` -> repository -> owner) with:

- a short description of the issue,
- reproduction steps (redact any keys / tokens / paths you do not want to share),
- the affected version (`git rev-parse HEAD` + `git describe --tags`).

You should receive a first reply within 7 days.

## What this project does and does not do

`codexjournal-lite` reads files from your local `%USERPROFILE%/.codex/sessions`
directory, processes them on the same machine, and writes only to the project
directory you cloned it into. It makes no network calls, no telemetry, and
no uploads. See [`docs/privacy.md`](docs/privacy.md) for the full privacy
statement and redaction rules.

If you find that the project has made a network call without explicit user
action, or that the redaction layer has leaked a real secret, please report
it through the channel above.
