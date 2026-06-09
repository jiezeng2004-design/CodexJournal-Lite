# Data Sources

This document describes which AI client logs CodexJournal-Lite is
**currently** able to read, and which ones are explicitly **not**
supported in this release. The v0.5.0 split is:

- **Currently supported for archive (writes to `journal/`, `data/`):**
  - `codex-sessions` (the v0.1-v0.4.0 archive pipeline, unchanged in v0.4.1)
- **Supported for inventory only (read-only probe, no parsing):**
  - `idea-ai` (IDEA / JetBrains AI logs, v0.4.1-v0.5.0; **not** parsed into tasks; writes
    `reports/idea-log-inventory.md` and `reports/source-scan-summary.json`)
- **Not supported for archive in v0.4.1:**
  - IDEA AI / JetBrains AI Assistant log parsing
  - Cursor
  - Windsurf
  - Claude Code
  - OpenClaw

These are listed here so that the project's limits are obvious; they
are **not** placeholders for "almost done" features.

## Currently supported for archive

### `codex-sessions`

- **Default path:** `%USERPROFILE%\.codex\sessions`
  (configurable via `config.json` -> `sessionsDir`).
- **Extensions read:** `.jsonl`, `.transcript` (case-insensitive).
- **Walk:** recursive. Sub-directories are scanned.
- **Per-file behavior:** the file is read once with `fs.readFileSync`
  and split on `\r?\n`. Each non-empty line is fed to a JSON parser.
  A single line that fails to parse is recorded in
  `reports/errors.log` and the rest of the file still completes.
- **Per-message timestamp:** the parser reads the top-level
  `timestamp` field first, then falls back to `time`, `ts`,
  `created_at`, `createdAt`, `event_time`, and finally
  `payload.timestamp`. Values may be ISO-8601 strings, or numeric
  epoch seconds / milliseconds.
- **Per-day journal key:** the first message timestamp that
  successfully parses is converted to a local date (Asia/Shanghai
  by default, see `config.json` -> `timezone`) and used as the
  `journal/YYYY-MM-DD.md` filename. **The file's mtime is never used
  as the journal key.**
- **Source attribution:** every task emitted from this source has
  `source: "codex-sessions"` and `rawFilePath` pointing at the
  original absolute path. `rawFilePath` is passed through the
  redaction layer before being written to user-facing files.
- **Project path:** if the session contains a `session_meta` event
  with a `cwd` field (this is what Codex CLI writes on line 1 of
  every session), the project path is taken from there. The
  classifier also tries to detect a path from the user / assistant
  message text as a secondary source.

### What a task record looks like

```json
{
  "id": "t_<8-hex>",
  "date": "2026-06-03",
  "time": "11:41",
  "source": "codex-sessions",
  "projectPath": "<local-project-path>",
  "title": "...redacted...",
  "taskType": "codex | thesis | document | openclaw | zotero | environment | frontend | code | general",
  "keywords": ["..."],
  "userSummary": "...redacted...",
  "assistantSummary": "...redacted...",
  "rawFilePath": "C:\\Users\\<USER>\\.codex\\sessions\\...",
  "messageCount": 22,
  "firstTimestamp": "2026-06-03T03:41:38.000Z",
  "lastTimestamp":  "2026-06-03T03:55:11.000Z"
}
```

## Currently supported for inventory only

### `idea-ai` (IDEA / JetBrains AI logs) - v0.4.1

In v0.4.1 the `idea-ai` source is wired up as a **read-only probe**.
It does **not** parse log content into tasks. It writes a
human-readable inventory to `reports/idea-log-inventory.md` and a
machine-readable summary to `reports/source-scan-summary.json` and
nothing else.

Contract:

- **`idea-ai` in v0.4.1 only writes the two files under `reports/`:**
  - `reports/idea-log-inventory.md` (Markdown inventory, always overwritten)
  - `reports/source-scan-summary.json` (machine-readable scan summary)
- It does **not** write to `journal/`.
- It does **not** write to `data/tasks.json`.
- It does **not** write to `data/stats.json`.
- It does **not** write to `data/search.md`.
- It does **not** write to `data/index.json`.
- It does **not** modify `README.md`.
- The `npm run verify` script (Section K) snapshots SHA-256 of all of
  the above before and after `npm run scan:sources` and FAILS the
  build if scan-sources mutated any of them.

How it works:

- Walks candidate JetBrains directories
  (`%APPDATA%\JetBrains`, `%LOCALAPPDATA%\JetBrains`, and
  `%USERPROFILE%\.IntelliJIdea*` / `.IdeaIC*` / `.WebStorm*` /
  `.PyCharm*` / `.GoLand*` / `.RubyMine*` / `.CLion*` / `.PhpStorm*` /
  `.Rider*` / `.DataGrip*`), finds `log` / `logs` / `system/log` /
  `system/logs` sub-directories, and lists every file with a
  recognised log extension (`.log`, `.txt`, `.json`, `.jsonl`) whose
  path or first 50 KB preview matches one of the AI-related
  heuristic keywords
  (`AI Assistant`, `JetBrains AI`, `AIAssistant`, `LLM`, `Chat`,
  `OpenAI`, `Anthropic`, `Copilot`, `completion`, `prompt`, `model`,
  `assistant`, `ai-assistant`).
- Strictly read-only: nothing under any JetBrains directory is
  opened in write / append mode, no file is moved or renamed, and
  the file-size cap is **20 MB** (files larger than that are
  skipped without being read). Per-file previews are capped at
  50 KB and 20 lines.
- All paths and preview lines are passed through `src/sanitize.js`
  before being written.
- Override directories can be added by editing
  `config.json -> sources[].logDirs` for the `idea-ai` entry.

IDEA AI log **parsing into tasks** is **not** part of v0.4.1; it is
planned for **v0.4.2+** (see the bottom of this file).

## Explicitly NOT supported in v0.4.1 (for archive)

The following data sources are **out of scope for archive** in
v0.4.1. They are listed here so that the project's limits are
obvious; they are **not** placeholders for "almost done" features.

- **IDEA AI / JetBrains AI Assistant log parsing.** Per the section
  above, v0.4.1 only generates the inventory + summary JSON. A
  parser is a candidate for v0.4.2+.

### Test fixtures

`test-fixtures/idea-logs/` is a small synthetic tree the project
ships **purely for the offline test suite**. It is **not** a snapshot
of any real user's logs. The fixture is regenerated manually when
the test cases change; it does not represent real JetBrains output.

- `test-fixtures/idea-logs/JetBrains/PyCharm2025.3/log/idea.log` -
  normal JetBrains startup messages plus a tiny handful of
  `OpenAI` / `Chat` keywords. The expected behavior is that the
  file is treated as a candidate with at least one path / content
  keyword match.
- `test-fixtures/idea-logs/JetBrains/PyCharm2025.3/log/ai-assistant.log`
  - a long stretch of obvious `AI Assistant` / `prompt` / `model` /
  `OpenAI` / `Anthropic` / `Copilot` / `completion` / `assistant`
  keywords, so the test can assert a non-zero `likelyAiFiles`
  count.
- `test-fixtures/idea-logs/JetBrains/PyCharm2025.3/log/normal.log` -
  plain JetBrains lifecycle messages, no AI keywords. Used to
  confirm that the heuristic is not just `matched: everything`.

No real credentials, no real usernames, no real paths from the
developer's machine ever appear in these fixtures.

- **Cursor editor logs.** Cursor's session storage uses
  `app.cursor.com` / `cursor.com` cloud sync by default and stores
  local indexes under `%APPDATA%\Cursor\`. CodexJournal-Lite does not
  open any of those files.
- **Windsurf editor logs.** Same situation as Cursor: cloud-first,
  no documented local archive directory. Not read.
- **Claude Code logs.** Claude Code writes its own per-session JSON
  under `~/.claude/projects/...`. CodexJournal-Lite does not open
  any of those files.
- **OpenClaw logs.** OpenClaw is a separate local tool maintained
  alongside CodexJournal-Lite. Its own log directory is read only by
  OpenClaw itself, not by this project.
- **Anything that is not a `.jsonl` or `.transcript` file under
  `sessionsDir`.** Files with other extensions (`.md`, `.txt`, etc.)
  are intentionally skipped on the first pass. We do not try to
  auto-detect JSONL content in `.txt` files because the cost of
  false positives is higher than the cost of missing some content.

## Versioning

The set of supported sources is part of the public contract of this
project. Breaking changes (renaming a source id, removing a
supported extension) require a minor or major version bump of
`package.json`. Additions (a new extension under the same `source`
id) only require a patch bump and a line in this file.
