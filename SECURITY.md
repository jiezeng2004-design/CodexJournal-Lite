# Security Policy

## Reporting a vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Please do not paste private Codex session content, API keys, local usernames,
absolute private paths, or generated journal outputs into public issues.

### Preferred reporting channels

1. **GitHub private vulnerability reporting** (preferred, if enabled):
   1. Go to the repository's **Security** tab.
   2. Click **Report a vulnerability**.
   3. Describe the issue with reproduction steps (redact any keys, tokens, or
      paths you do not want to share).
   4. Include the affected version (`git rev-parse HEAD` and
      `git describe --tags`).

2. **If private vulnerability reporting is unavailable**, open a minimal public
   issue without sensitive details and state that you need a private channel.

You should receive a first reply within 7 days. We will keep you informed
of progress and credit you in the release notes (unless you prefer to stay
anonymous).

## Scope

A security issue is anything that causes:

- A real API key, token, cookie, or credential to appear in a generated
  output file (`journal/*.md`, `data/*.json`, `data/*.md`, `reports/*.md`,
  `reports/*.json`, `dist/*.zip`).
- A real local Windows username to appear unredacted in a generated output
  file (e.g. `C:\Users\local_user_name\` instead of `C:\Users\<USER>\`).
- An unintended network call (the project is designed to be fully offline).
- A write to a path outside the project root.
- A modification to the user's source `.codex/sessions` files.

## What is NOT a security issue

- A heuristic classifier mislabeling a task type (this is a bug, not a
  security issue — open a regular issue).
- A report formatting problem.
- A missing feature (e.g. "IDEA logs are not parsed into tasks").

## What this project does and does not do

`codexjournal-lite` reads files from your local `%USERPROFILE%/.codex/sessions`
directory, processes them on the same machine, and writes only to the project
directory you cloned it into. It makes no network calls, no telemetry, and
no uploads. See [`docs/privacy.md`](docs/privacy.md) for the full privacy
statement and redaction rules.

If you find that the project has made a network call without explicit user
action, or that the redaction layer has leaked a real secret, please report
it through the channel above.
