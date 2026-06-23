# Data Sources

This document describes which AI client logs CodexJournal-Lite is
**currently** able to read, and which ones are explicitly **not**
supported in this release. The current source support contract is:

- **Currently supported for archive (writes to `journal/`, `data/`):**
  - `codex-sessions` (the v0.1-v0.4.0 archive pipeline, unchanged)
  - `claude-code` (Claude Code JSONL sessions, v1.4.0)
  - `gemini-cli` (Gemini CLI checkpoint JSON, v1.4.0; disabled by default)
  - `opencode` (OpenCode sessions via CLI export or file scan, v1.4.0; disabled by default)
- **Supported for inventory only (read-only probe, no parsing):**
  - `idea-ai` (IDEA / JetBrains AI logs; **not** parsed into tasks; writes
    `reports/idea-log-inventory.md` and `reports/source-scan-summary.json`)
- **Not supported for archive:**
  - Cursor
  - Windsurf
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

### `claude-code` (Claude Code) - v1.4.0

- **Default path:** `~/.claude/projects` (configurable via
  `config.json -> sources[]` for the `claude` type, or auto-detected
  cross-platform by `src/paths.js`).
- **Extensions read:** `.jsonl` (case-insensitive).
- **Walk:** scans project sub-directories under the sessions directory.
  Each sub-directory represents a project hash; `.jsonl` files inside
  are individual sessions.
- **Per-file behavior:** the file is read once with `fs.readFileSync`
  and split on `\r?\n`. Each non-empty line is parsed as JSON. Lines
  that fail to parse are recorded as errors and the rest of the file
  still completes.
- **Message types:** `type: "user"` and `type: "assistant"` entries
  are extracted. `type: "ai-title"` entries provide an optional
  session title. Content can be a string or an array of content blocks
  (text, tool_use, tool_result).
- **Per-message timestamp:** the parser reads the top-level `timestamp`
  field, then falls back to `createdAt` / `created_at`. If no
  timestamps are found, the file mtime is used as a fallback.
- **Source attribution:** every task emitted from this source has
  `source: "claude-code"` and `rawFilePath` pointing at the original
  absolute path. `rawFilePath` is passed through the redaction layer
  before being written to user-facing files.
- **Project path:** taken from the `cwd` field in user messages, or
  detected from message text as a secondary source.
- **Config entry:**
  ```json
  { "name": "claude-code", "type": "claude", "enabled": true, "sessionsDir": "" }
  ```
  Leave `sessionsDir` empty to use the auto-detected default.

### `gemini-cli` (Gemini CLI) - v1.4.0

- **Default path:** `~/.gemini/tmp` (configurable via
  `config.json -> sources[]` for the `gemini` type, or auto-detected
  cross-platform by `src/paths.js`).
- **Extensions read:** `.json` (case-insensitive).
- **Walk:** flat scan of the sessions directory. Each `.json` file is
  a checkpoint containing a messages array.
- **Per-file behavior:** the file is read and parsed as a single JSON
  object. The adapter is tolerant of multiple JSON structures: it
  tries `messages`, `history`, `conversation.messages`, and `turns`
  arrays in order.
- **Message normalization:** roles `user` / `human` are mapped to
  `user`; roles `model` / `assistant` / `ai` are mapped to `assistant`.
  Content is extracted from `content` (string), `text`, or `parts`
  (Gemini API format). Timestamps are read from `timestamp`, `ts`,
  `createdAt`, or `created_at`; the top-level object timestamp is used
  as a fallback.
- **Source attribution:** every task has `source: "gemini-cli"`.
- **Project path:** taken from `cwd`, `workingDirectory`, or
  `projectPath` fields, or detected from message text.
- **Config entry:**
  ```json
  { "name": "gemini-cli", "type": "gemini", "enabled": false, "sessionsDir": "" }
  ```
  Disabled by default. Set `"enabled": true` to enable.

### `opencode` (OpenCode) - v1.4.0

- **Default path:** `~/.local/share/opencode` (Unix) or
  `%LOCALAPPDATA%\opencode` (Windows). Configurable via
  `config.json -> sources[]` for the `opencode` type.
- **Modes:**
  - `mode: "cli"` (default) — calls `opencode session list --format json`
    to list sessions and `opencode export <sessionID>` to export each
    session. No SQLite dependency is introduced.
  - `mode: "file"` — scans a directory of pre-exported `.json` files.
    Useful when the `opencode` binary is not in PATH or when sessions
    have been exported manually.
- **Command fallback (export):** the export function tries the new
  top-level command `opencode export <sessionID>` first. If that fails
  (non-zero exit or unparseable output), it falls back to the legacy
  `opencode session export --session <id> --format json` for backward
  compatibility with older OpenCode versions. If both fail, a clear
  error is returned listing the commands that were tried.
- **Command fallback (list):** the session list function tries
  `opencode session list --format json` first, then falls back to
  `opencode list --format json`.
- **Error sanitization:** CLI mode error messages are sanitized via
  `sanitize.redactText()` before being written to `reports/errors.log`,
  ensuring no sensitive paths or credentials leak from stderr output.
- **Per-file behavior (file mode):** each `.json` file is parsed as a
  single JSON object. The adapter tries `messages`, `session.messages`,
  `conversation`, and `history` arrays in order.
- **Message normalization:** roles `user` / `human` are mapped to
  `user`; roles `assistant` / `ai` are mapped to `assistant`. Content
  is extracted from `content` (string), `text`, or `content.text`.
- **Source attribution:** every task has `source: "opencode"`. The
  `rawFilePath` field contains the session ID (not a file path in CLI
  mode, since sessions are retrieved via the binary).
- **Graceful degradation:** if the `opencode` binary is not found in
  PATH and no `sessionsDir` is configured, the adapter returns empty
  results without errors.
- **Known limitations:**
  - The `opencode export` command does not support a `--format` flag;
    JSON is the default output format.
  - The `--sanitize` flag on `opencode export` is not used by default;
    CodexJournal-Lite applies its own redaction pipeline.

#### OpenCode CLI command reference

The adapter calls the `opencode` binary in two phases: listing sessions and
exporting each session. Both phases try the new top-level command first,
then fall back to the legacy subcommand syntax.

| Phase | Primary command | Fallback command |
|-------|----------------|-----------------|
| List sessions | `opencode session list --format json` | `opencode list --format json` |
| Export session | `opencode export <sessionID>` | `opencode session export --session <id> --format json` |

**List command output:** the adapter tolerates multiple JSON structures:
a bare array, `{ sessions: [...] }`, or `{ data: [...] }`.

**Export command output:** the adapter tries `messages`, `session.messages`,
`conversation`, and `history` arrays in order to find the message list.

**Error handling:** if both the primary and fallback commands fail, a clear
error is returned listing the commands that were tried. All error messages
are sanitized via `sanitize.redactText()` before being written to
`reports/errors.log`.

**Binary detection:** the adapter uses `which` (Unix) or `where` (Windows)
to check if `opencode` is in PATH. If the binary is not found and no
`sessionsDir` is configured, the adapter returns empty results without
errors (graceful degradation).

**Config entry:**
  ```json
  { "name": "opencode", "type": "opencode", "enabled": false, "mode": "cli", "sessionsDir": "" }
  ```
  Disabled by default. Set `"enabled": true` and optionally
  `"mode": "file"` with a `sessionsDir` to use file mode.

### Multi-source adapter architecture

All source adapters conform to a standard interface defined in
`src/sources/base-adapter.js`:

- `name` — human-readable source name
- `type` — unique type identifier (used in `config.json -> sources[].type`)
- `getDefaultDir()` — returns the default sessions directory (cross-platform)
- `describe(cfg)` — returns metadata about the source
- `probe(cfg)` — read-only probe, returns file listing and stats
- `collect(cfg)` — core method, scans and parses, returns
  `{ tasks, errors, fileCount, dirCount }`

Adapters are auto-discovered by `src/sources/index.js`, which scans the
`src/sources/` directory for `.js` files (excluding `index.js`,
`base-adapter.js`, and `*.test.js`). External plugins can also be loaded
from `config.json -> plugins[]` (array of absolute or relative file paths).

The `archive` command collects tasks from all enabled sources in
`config.json -> sources[]` in a single run. The `preview --source <name>`
command probes and previews a specific adapter.

### Source adapter contract

Every adapter must implement the following interface (defined in
`src/sources/base-adapter.js`):

| Method | Signature | Description |
|--------|-----------|-------------|
| `name` | `string` | Human-readable source name |
| `type` | `string` | Unique type identifier (used in `config.json -> sources[].type`) |
| `getDefaultDir()` | `() -> string` | Returns the default sessions directory (cross-platform) |
| `describe(cfg)` | `(cfg) -> object` | Returns metadata about the source |
| `probe(cfg)` | `(cfg) -> object` | Read-only probe; returns file listing and stats |
| `collect(cfg)` | `(cfg) -> { tasks, errors, fileCount, dirCount }` | Core method; scans and parses sessions into task records |
| `doctor(cfg)` | `(cfg) -> { healthy, checks, warnings }` | Health check; returns check results and warnings |
| `capabilities()` | `() -> object` | Returns adapter capability flags |

Optional methods:

| Method | Signature | Description |
|--------|-----------|-------------|
| `renderReport(result)` | `(result) -> string` | Renders source-specific Markdown report |

The `collect()` method must return tasks that conform to the 14-field schema:
`id`, `date`, `time`, `source`, `projectPath`, `title`, `taskType`,
`keywords`, `userSummary`, `assistantSummary`, `rawFilePath`,
`messageCount`, `firstTimestamp`, `lastTimestamp`.

All paths and text in task records must be passed through `sanitize`
before being returned (the dispatcher does NOT re-sanitize).

### Capabilities comparison

Each adapter reports its capabilities via `capabilities()`. The following
table shows the capability flags for all built-in adapters:

| Adapter | `archive` | `inventory` | `cliRequired` | `supportsExport` | `supportsConfigDirs` |
|---------|-----------|-------------|---------------|------------------|---------------------|
| `codex` | yes | yes | no | no | no |
| `claude` | yes | yes | no | no | no |
| `gemini` | yes | yes | no | no | no |
| `opencode` | yes | yes | yes | yes | no |
| `idea` | no | yes | no | no | yes |

**Capability flags:**

| Flag | Description |
|------|-------------|
| `archive` | Can produce archived tasks and journal entries |
| `inventory` | Can produce an inventory/scan report |
| `cliRequired` | Requires an external CLI binary (e.g. `opencode`) |
| `supportsExport` | Supports exporting sessions via CLI |
| `supportsConfigDirs` | Uses multiple configurable directories (e.g. JetBrains `logDirs`) |

## Currently supported for inventory only

### `idea-ai` (IDEA / JetBrains AI logs) - inventory-only

The `idea-ai` source is wired up as a **read-only probe**.
It does **not** parse log content into tasks. It writes a
human-readable inventory to `reports/idea-log-inventory.md` and a
machine-readable summary to `reports/source-scan-summary.json` and
nothing else.

Contract:

- **`idea-ai` only writes the two files under `reports/`:**
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

Contract summary:

| Aspect | Value |
|--------|-------|
| `archive` capability | `false` (inventory-only) |
| `inventory` capability | `true` |
| `cliRequired` | `false` |
| `supportsConfigDirs` | `true` (uses `logDirs` array) |
| Writes to `journal/` | no |
| Writes to `data/tasks.json` | no |
| Writes to `data/stats.json` | no |
| Writes to `data/search.md` | no |
| Writes to `data/index.json` | no |
| Writes to `reports/idea-log-inventory.md` | yes (always overwritten) |
| Writes to `reports/source-scan-summary.json` | yes (always overwritten) |
| Read-only guarantee | nothing under any JetBrains directory is opened in write/append mode |
| File size cap | 20 MB (larger files are skipped without reading) |
| Preview cap | 50 KB / 20 lines per file |
| Walk depth | bounded (default 4 levels) |
| Symlink following | never |

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

IDEA AI log **parsing into tasks** is **not** part of the current release;
it remains a candidate for a future version.

## Explicitly NOT supported (for archive)

The following data sources are **out of scope for archive**. They are
listed here so that the project's limits are obvious; they are **not**
placeholders for "almost done" features.

- **IDEA AI / JetBrains AI Assistant log parsing.** Per the section
  above, the `idea-ai` source only generates the inventory + summary
  JSON. A parser that converts IDEA log content into task records is
  a candidate for a future version.

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
- **OpenClaw logs.** OpenClaw is a separate local tool maintained
  alongside CodexJournal-Lite. Its own log directory is read only by
  OpenClaw itself, not by this project.
- **Anything that is not a recognised session file under a source's
  sessions directory.** Files with unsupported extensions are
  intentionally skipped. We do not try to auto-detect JSONL content
  in `.txt` files because the cost of false positives is higher than
  the cost of missing some content.

## Common Errors and Fixes

### Codex sessions directory not found

**Symptom:** `probe()` returns `exists: false` or `collect()` returns
`missing: true`.

**Cause:** The Codex sessions directory does not exist or is not at the
expected path.

**Fix:**

```bash
# Check if the default path exists
ls ~/.codex/sessions

# If your sessions are elsewhere, set sessionsDir in config.json
# or use the --sessions-dir CLI parameter
codexjournal archive --sessions-dir /path/to/.codex/sessions
```

### Claude Code projects directory empty

**Symptom:** `doctor()` reports "No project subdirectories found" or
"No .jsonl session files found".

**Cause:** Claude Code has not been used yet, or the projects directory
is at a non-default location.

**Fix:**

```json
// config.json -> sources[]
{ "name": "claude-code", "type": "claude", "enabled": true, "sessionsDir": "/custom/path/to/.claude/projects" }
```

### OpenCode binary not found

**Symptom:** `doctor()` reports "opencode binary not found in PATH" or
`collect()` returns `missing: true` with error "opencode binary not found".

**Cause:** The `opencode` CLI is not installed or not in PATH.

**Fix:**

```bash
# Verify opencode is installed
opencode --version

# If not installed, install OpenCode CLI first
# Then verify it is in PATH
which opencode    # Unix
where opencode    # Windows
```

Alternatively, switch to file mode and scan pre-exported JSON files:

```json
{ "name": "opencode", "type": "opencode", "enabled": true, "mode": "file", "sessionsDir": "/path/to/exported/sessions" }
```

### OpenCode export command fails

**Symptom:** `reports/errors.log` contains "opencode export failed (tried:
opencode export ... | opencode session export ...)".

**Cause:** The OpenCode CLI version does not support either export command
syntax, or the session ID is invalid.

**Fix:**

1. Check your OpenCode version: `opencode --version`
2. Manually test the export command: `opencode export <sessionID>`
3. If the CLI export is unreliable, switch to file mode and pre-export
   sessions manually.

### OpenCode session list returns no sessions

**Symptom:** `collect()` returns zero tasks despite OpenCode being
installed.

**Cause:** OpenCode has not been used in the current environment, or
session data does not exist in the default data directory.

**Fix:**

```bash
# Verify sessions exist
opencode session list --format json

# Check the default data directory
ls ~/.local/share/opencode        # Unix
dir %LOCALAPPDATA%\opencode       # Windows
```

### Gemini CLI checkpoint files not found

**Symptom:** `doctor()` reports "Gemini tmp directory does not exist" or
"No .json checkpoint files found".

**Cause:** Gemini CLI is disabled by default and/or has not been used.

**Fix:**

```json
// config.json -> sources[]
{ "name": "gemini-cli", "type": "gemini", "enabled": true, "sessionsDir": "" }
```

Leave `sessionsDir` empty to use the auto-detected default (`~/.gemini/tmp`).

### IDEA / JetBrains directories not found

**Symptom:** `doctor()` reports "No JetBrains directories found" or
"no roots to search".

**Cause:** No JetBrains IDE is installed, or the log directories are at
non-standard locations.

**Fix:**

```json
// config.json -> sources[]
{
  "name": "idea-ai",
  "type": "idea",
  "enabled": true,
  "logDirs": ["/custom/path/to/JetBrains/PyCharm2025.3/log"]
}
```

### JSON parse errors in session files

**Symptom:** `reports/errors.log` contains "JSON parse" errors for
specific files.

**Cause:** A line in a `.jsonl` session file is not valid JSON (e.g.
truncated, corrupted, or contains non-JSON content).

**Fix:** This is expected behavior — the parser skips invalid lines and
continues processing the rest of the file. No action is needed unless
all lines in a file fail to parse. If a file is corrupted, re-export or
re-download the session from the original AI tool.

## Versioning

The set of supported sources is part of the public contract of this
project. Breaking changes (renaming a source id, removing a
supported extension) require a minor or major version bump of
`package.json`. Additions (a new extension under the same `source`
id) only require a patch bump and a line in this file.
