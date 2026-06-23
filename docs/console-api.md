# Console API Reference

CodexJournal-Lite ships a localhost-only HTTP console server
(`console/server.js`) that powers the dashboard UI and exposes a stable
read-only API for programmatic access.

- **Default URL:** `http://127.0.0.1:7777/`
- **Bind address:** `127.0.0.1` (local-only; override with `HOST` env)
- **Port:** `7777` (override with `PORT` env)
- **Dependencies:** zero — Node.js 18+ built-ins only
- **Security:** all endpoints are read-only except the job runner; commands
  are hardcoded in an allowlist; no user-supplied shell invocation

Start the server:

```bash
npm run console
# or with a custom workspace root:
node console/server.js --root /path/to/workspace
```

---

## Table of Contents

- [Static Routes](#static-routes)
- [Dashboard](#dashboard)
- [Journal](#journal)
- [Reports](#reports)
- [Data](#data)
- [Dist](#dist)
- [Verify Tail](#verify-tail)
- [Search](#search)
- [Stable v1 API](#stable-v1-api)
- [Job Runner](#job-runner)

---

## Static Routes

### GET /

Returns the dashboard `index.html`.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/` |
| Parameters | none |
| Response | `text/html` |

### GET /static/*

Serves static assets (CSS, JS, images) from `console/public/static/`.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/static/<path>` |
| Parameters | none |
| Response | file stream with appropriate MIME type |

---

## Dashboard

### GET /api/dashboard

Returns aggregated dashboard data: project metadata, task/message/day
counts, calendar heatmap data, streaks, source distribution, top projects,
verify summary, and doctor status.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/dashboard` |
| Parameters | none |

**Response structure:**

```json
{
  "project": {
    "name": "codexjournal-lite",
    "version": "1.4.0",
    "root": "/path/to/workspace",
    "workspaceRoot": "/path/to/workspace",
    "appRoot": "/path/to/app",
    "sessionsDir": "~/.codex/sessions",
    "node": "v18.x.x"
  },
  "counts": {
    "tasks": 1200,
    "messages": 15000,
    "days": 180,
    "journals": 180,
    "distArtifacts": 2
  },
  "topType": { "k": "codex", "v": 500 },
  "topKw": [["auth", 30], ["jwt", 25]],
  "byDay": { "2026-06-01": 5, "2026-06-02": 3 },
  "byDayMessages": { "2026-06-01": 120, "2026-06-02": 80 },
  "byDayJournalSize": { "2026-06-01": 4096, "2026-06-02": 2048 },
  "byType": { "codex": 500, "document": 200, "thesis": 100 },
  "lastTasks": [
    { "id": "t_abc12345", "date": "2026-06-23", "time": "11:41", "type": "codex", "title": "..." }
  ],
  "weekStats": { "tasks": 15, "lastWeekTasks": 20 },
  "streak": 5,
  "longestStreak": 30,
  "sourceDistribution": { "codex-sessions": 500, "claude-code": 300 },
  "topProjects": [
    { "path": "/home/user/project-a", "count": 120, "lastDate": "2026-06-23" }
  ],
  "verify": { "pass": 12, "fail": 0 },
  "doctor": { "pass": 27, "fail": 0, "generatedAt": null },
  "serverTime": "2026-06-23T11:41:38.000Z"
}
```

**Key fields:**

| Field | Description |
|-------|-------------|
| `project` | Package name, version, workspace/app roots, Node version |
| `counts` | Total tasks, messages, active days, journal files, dist artifacts |
| `topType` | Most frequent task type |
| `topKw` | Top 12 keywords as `[keyword, count]` pairs |
| `byDay` | Task count per day (YYYY-MM-DD) — drives the heatmap |
| `byDayMessages` | Message count per day |
| `byDayJournalSize` | Journal file size per day (bytes) |
| `byType` | Task count per type |
| `lastTasks` | 10 most recent tasks (id, date, time, type, title) |
| `weekStats` | This week's and last week's task counts |
| `streak` | Current consecutive-day streak |
| `longestStreak` | Longest consecutive-day streak ever |
| `sourceDistribution` | Task count per source adapter |
| `topProjects` | Top 5 projects by task count |
| `verify` | Pass/fail counts parsed from `reports/verify-full.log` |
| `doctor` | Pass/fail counts parsed from `reports/doctor.md` |

---

## Journal

### GET /api/journal

Returns a list of journal files in `journal/`, sorted by modification time
(newest first).

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/journal` |
| Parameters | none |

**Response:**

```json
{
  "items": [
    { "name": "2026-06-23.md", "size": 4096, "mtime": "2026-06-23T11:41:38.000Z" },
    { "name": "2026-06-22.md", "size": 3072, "mtime": "2026-06-22T18:00:00.000Z" }
  ]
}
```

### GET /api/journal/:date

Returns the Markdown content of a single journal file.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/journal/:date` |
| Parameters | `:date` — must match `YYYY-MM-DD.md` |

**Response:** `text/markdown`

**Example:**

```
GET /api/journal/2026-06-23.md
```

**Errors:**

| Status | Condition |
|--------|-----------|
| `400` | Date does not match `YYYY-MM-DD.md` format |
| `404` | No such journal file |

---

## Reports

### GET /api/reports

Returns a recursive list of all files under `reports/` (including
`monthly/` and `yearly/` subdirectories), sorted by modification time.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/reports` |
| Parameters | none |

**Response:**

```json
{
  "items": [
    { "name": "dashboard.md", "size": 8192, "mtime": "2026-06-23T11:00:00.000Z" },
    { "name": "monthly/2026-06.md", "size": 4096, "mtime": "2026-06-23T11:00:00.000Z" },
    { "name": "yearly/2026.md", "size": 6144, "mtime": "2026-06-23T11:00:00.000Z" }
  ]
}
```

### GET /api/reports/*

Returns the content of a single report file.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/reports/<path>` |
| Parameters | `<path>` — relative path under `reports/` |

**Response:** `text/markdown`

**Example:**

```
GET /api/reports/dashboard.md
GET /api/reports/monthly/2026-06.md
```

**Errors:**

| Status | Condition |
|--------|-----------|
| `404` | No such report file |

---

## Data

### GET /api/data

Returns a list of data files in `data/` (excludes `index.json` which is
gitignored and intentionally not exposed).

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/data` |
| Parameters | none |

**Response:**

```json
{
  "items": [
    { "name": "tasks.json", "size": 102400, "mtime": "2026-06-23T11:00:00.000Z" },
    { "name": "stats.json", "size": 8192, "mtime": "2026-06-23T11:00:00.000Z" },
    { "name": "search.md", "size": 51200, "mtime": "2026-06-23T11:00:00.000Z" }
  ]
}
```

### GET /api/data/tasks

Returns a paginated, filterable list of tasks from `data/tasks.json`.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/data/tasks` |

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | `50` | Items per page (1–500) |
| `offset` | integer | `0` | Zero-based offset |
| `q` | string | (empty) | Search query (supports field syntax) |
| `type` | string | (empty) | Filter by task type (e.g. `codex`, `document`) |
| `source` | string | (empty) | Filter by source adapter name |

**Response:**

```json
{
  "total": 1200,
  "items": [
    {
      "id": "t_abc12345",
      "date": "2026-06-23",
      "time": "11:41",
      "source": "codex-sessions",
      "projectPath": "/home/user/project",
      "title": "Fix authentication bug",
      "taskType": "codex",
      "keywords": ["auth", "jwt"],
      "userSummary": "...",
      "assistantSummary": "...",
      "rawFilePath": "/home/user/.codex/sessions/...",
      "messageCount": 22,
      "firstTimestamp": "2026-06-23T03:41:38.000Z",
      "lastTimestamp": "2026-06-23T03:55:11.000Z"
    }
  ]
}
```

**Example:**

```
GET /api/data/tasks?limit=20&offset=0&type=codex&q=auth
```

### GET /api/data/:name

Returns the content of a single data file. JSON files are returned as
pretty-printed JSON; other files are returned as text.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/data/:name` |
| Parameters | `:name` — filename (no path separators allowed) |

**Response:** `application/json` for `.json` files, otherwise the
appropriate MIME type.

**Example:**

```
GET /api/data/stats.json
GET /api/data/search.md
```

**Errors:**

| Status | Condition |
|--------|-----------|
| `400` | Name contains `..`, `/`, or `\` |
| `404` | File does not exist, or name is `index.json` (intentionally hidden) |

---

## Dist

### GET /api/dist

Returns a list of files in `dist/`.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/dist` |
| Parameters | none |

**Response:**

```json
{
  "items": [
    { "name": "CodexJournal-Lite-v1.4.0-local.zip", "size": 1048576, "mtime": "2026-06-23T11:00:00.000Z" }
  ]
}
```

### GET /api/dist/download

Streams the first (single) `.zip` file found in `dist/` as a download
attachment.

| Property | Value |
|----------|-------|
| Method | `GET` or `HEAD` |
| URL | `/api/dist/download` |
| Parameters | none |

**Response:** `application/zip` with `Content-Disposition: attachment`

**Errors:**

| Status | Condition |
|--------|-----------|
| `404` | No `.zip` artifact found in `dist/` |

---

## Verify Tail

### GET /api/verify-tail

Returns the last N lines of `reports/verify-full.log`.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/verify-tail` |

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `lines` | integer | `60` | Number of lines to return (10–500) |

**Response:**

```json
{
  "lines": [
    "[Section A] CLI health ... PASS",
    "[Section B] Archive generation ... PASS"
  ],
  "exists": true,
  "total": 120,
  "mtime": "2026-06-23T11:00:00.000Z"
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| `200` with `exists: false` | `reports/verify-full.log` does not exist |

---

## Search

### GET /api/search

Performs a global cross-content search across journal files, task records,
and report files. Supports structured field syntax in the `q` parameter.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/search` |

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | (required) | Search query (min 2 characters; supports field syntax) |
| `limit` | integer | `20` | Max results per source group (1–100) |
| `type` | string | (empty) | Filter tasks by type |
| `source` | string | (empty) | Filter tasks by source |
| `dateFrom` | string | (empty) | Date range start (YYYY-MM-DD) |
| `dateTo` | string | (empty) | Date range end (YYYY-MM-DD) |

**Response:**

```json
{
  "q": "auth",
  "filters": { "type": "", "source": "", "dateFrom": "", "dateTo": "" },
  "total": 15,
  "groups": {
    "journal": [
      { "source": "journal", "date": "2026-06-23", "snippet": "...auth...", "score": 3 }
    ],
    "task": [
      { "source": "task", "id": "t_abc12345", "date": "2026-06-23", "type": "codex", "title": "Fix auth", "snippet": "...", "score": 5 }
    ],
    "report": [
      { "source": "report", "name": "dashboard.md", "snippet": "...auth...", "score": 2 }
    ]
  }
}
```

**Example:**

```
GET /api/search?q=source:codex%20type:document&limit=10
GET /api/search?q=JWT&dateFrom=2026-06-01&dateTo=2026-06-30
```

**Errors:**

| Status | Condition |
|--------|-----------|
| `400` | `q` is less than 2 characters |

---

## Stable v1 API

The v1 endpoints are stable and backward-compatible. They are intended for
programmatic access and community tooling.

### GET /api/v1/tasks/:id

Returns the full detail of a single task by ID.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/v1/tasks/:id` |
| Parameters | `:id` — task ID (e.g. `t_abc12345`) |

**Response:** the full task object with all 14 fields.

```json
{
  "id": "t_abc12345",
  "date": "2026-06-23",
  "time": "11:41",
  "source": "codex-sessions",
  "projectPath": "/home/user/project",
  "title": "Fix authentication bug",
  "taskType": "codex",
  "keywords": ["auth", "jwt"],
  "userSummary": "...",
  "assistantSummary": "...",
  "rawFilePath": "/home/user/.codex/sessions/...",
  "messageCount": 22,
  "firstTimestamp": "2026-06-23T03:41:38.000Z",
  "lastTimestamp": "2026-06-23T03:55:11.000Z"
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| `400` | Task ID is empty |
| `404` | No such task |

### GET /api/v1/sources

Returns the probe status of all registered and enabled source adapters.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/v1/sources` |
| Parameters | none |

**Response:**

```json
{
  "sources": [
    {
      "source": "codex",
      "scannedAt": "2026-06-23T11:41:38.000Z",
      "sessionsDir": "/home/user/.codex/sessions",
      "exists": true,
      "files": 150,
      "name": "codex",
      "type": "codex",
      "enabled": true
    },
    {
      "source": "claude-code",
      "scannedAt": "2026-06-23T11:41:38.000Z",
      "sessionsDir": "/home/user/.claude/projects",
      "exists": true,
      "files": 80,
      "name": "claude-code",
      "type": "claude",
      "enabled": true
    }
  ],
  "generatedAt": "2026-06-23T11:41:38.000Z"
}
```

### GET /api/v1/source-doctor

Returns health-check diagnostics for all enabled source adapters. Each
adapter's `doctor()` method is called, returning check results, warnings,
and capability flags.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/v1/source-doctor` |
| Parameters | none |

**Response:**

```json
{
  "sources": [
    {
      "name": "codex",
      "type": "codex",
      "enabled": true,
      "archive": true,
      "capabilities": {
        "archive": true,
        "inventory": true,
        "cliRequired": false,
        "supportsExport": false,
        "supportsConfigDirs": false
      },
      "doctor": {
        "healthy": true,
        "checks": [
          { "label": "sessionsDir exists", "pass": true, "detail": "/home/user/.codex/sessions" },
          { "label": "sessionsDir readable", "pass": true, "detail": "directory" },
          { "label": "session files found", "pass": true, "detail": "150 file(s)" }
        ],
        "warnings": []
      }
    }
  ],
  "generatedAt": "2026-06-23T11:41:38.000Z"
}
```

**Capability flags:**

| Flag | Description |
|------|-------------|
| `archive` | Can produce archived tasks/journal entries |
| `inventory` | Can produce an inventory/scan report |
| `cliRequired` | Requires an external CLI binary (e.g. OpenCode) |
| `supportsExport` | Supports exporting sessions via CLI |
| `supportsConfigDirs` | Uses multiple configurable directories (e.g. IDEA) |

### GET /api/v1/search

Stable v1 alias for the global search endpoint. Accepts the same parameters
and returns the same response structure as [`GET /api/search`](#search).

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/v1/search` |

**Query parameters:** same as [`GET /api/search`](#search).

---

## Job Runner

The job runner allows starting predefined npm scripts from the dashboard.
Commands are hardcoded in an allowlist — no user-supplied commands or shell
invocation.

### POST /api/run

Starts a new job. Only one concurrent job of the same command is allowed.

| Property | Value |
|----------|-------|
| Method | `POST` |
| URL | `/api/run` |
| Content-Type | `application/json` |

**Request body:**

| Field | Type | Description |
|-------|------|-------------|
| `cmd` | string | (required) Command name from the allowlist |
| `force` | boolean | (optional) For `archive`: pass `--force` flag |
| `skipArchive` | boolean | (optional) For `verify`: pass `--skip-archive` flag |

**Allowed commands:**

| `cmd` | Runs |
|-------|------|
| `check` | `npm run check` |
| `archive` | `npm run archive` (add `--force` if `force: true`) |
| `stats` | `npm run stats` |
| `build-index` | `npm run build-index` |
| `scan-sources` | `npm run scan:sources` |
| `summarize` | `npm run summarize` |
| `doctor` | `npm run doctor` |
| `index-outputs` | `npm run index:outputs` |
| `package-local` | `npm run package:local` |
| `verify` | `npm run verify` (add `--skip-archive` if `skipArchive: true`) |

**Response (success):**

```json
{
  "jobId": "j_lzabc123_abc123"
}
```

**Response (conflict — command already running):**

```json
{
  "error": "command already running: archive",
  "jobId": "j_lzabc123_existing"
}
```

**Example:**

```bash
curl -X POST http://127.0.0.1:7777/api/run \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"archive","force":true}'
```

### GET /api/jobs

Returns a list of live (running) jobs and recent job history.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/jobs` |
| Parameters | none |

**Response:**

```json
{
  "live": [
    {
      "id": "j_lzabc123_abc123",
      "cmd": "archive",
      "args": ["run", "archive", "--", "--force"],
      "startedAt": "2026-06-23T11:41:38.000Z",
      "endedAt": null,
      "status": "running",
      "exitCode": null
    }
  ],
  "history": [
    {
      "id": "j_lzabc122_def456",
      "cmd": "check",
      "args": ["run", "check"],
      "startedAt": "2026-06-23T11:00:00.000Z",
      "endedAt": "2026-06-23T11:00:30.000Z",
      "exitCode": 0,
      "status": "stopped"
    }
  ]
}
```

### GET /api/jobs/:id

Returns the status and last 200 log lines of a specific job.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/jobs/:id` |
| Parameters | `:id` — job ID |

**Response:**

```json
{
  "id": "j_lzabc123_abc123",
  "cmd": "archive",
  "args": ["run", "archive"],
  "startedAt": "2026-06-23T11:41:38.000Z",
  "endedAt": "2026-06-23T11:42:10.000Z",
  "status": "stopped",
  "exitCode": 0,
  "log": [
    "[out] Archiving sessions...",
    "[out] 150 files processed",
    "[meta] exit=0"
  ]
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| `404` | No such job |

### GET /api/jobs/:id/stream

Opens a Server-Sent Events (SSE) stream for real-time job output.

| Property | Value |
|----------|-------|
| Method | `GET` |
| URL | `/api/jobs/:id/stream` |
| Parameters | `:id` — job ID |
| Response | `text/event-stream` |

**SSE events:**

| Event | Data | Description |
|-------|------|-------------|
| `: connected` | comment | Connection established |
| `replay` | `{ id, cmd, args, status, startedAt, log }` | Replay of last 200 log lines |
| `log` | `{ line }` | New log line (stdout/stderr) |
| `exit` | `{ id, exitCode, status }` | Job exited |
| `ping` | `{ t }` | Keepalive (every 15 seconds) |

**Example (JavaScript):**

```javascript
const es = new EventSource('http://127.0.0.1:7777/api/jobs/j_lzabc123_abc123/stream');
es.addEventListener('log', (e) => {
  const data = JSON.parse(e.data);
  console.log(data.line);
});
es.addEventListener('exit', (e) => {
  const data = JSON.parse(e.data);
  console.log('Job exited with code:', data.exitCode);
  es.close();
});
```

**Errors:**

| Status | Condition |
|--------|-----------|
| `404` | No such job |

### POST /api/jobs/:id/stop

Kills a running job. On Windows, uses `taskkill /T /F` to terminate the
entire process tree. On other platforms, sends `SIGTERM`.

| Property | Value |
|----------|-------|
| Method | `POST` |
| URL | `/api/jobs/:id/stop` |
| Parameters | `:id` — job ID |

**Response (success):**

```json
{
  "ok": true
}
```

**Response (error):**

```json
{
  "error": "job not running"
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| `200` with `error` | Job not found or not running |

---

## Security Notes

- The server binds to `127.0.0.1` by default and is not reachable from the
  LAN or public internet.
- All data endpoints are read-only. No file writes occur through the API.
- The only write-capable endpoint is `POST /api/run`, which spawns a
  hardcoded allowlist of npm scripts. No user-supplied command or shell
  invocation is possible.
- `data/index.json` is intentionally not exposed via the API (it is a local
  fingerprint cache).
- Path traversal is prevented: `safeJoin()` rejects any path that resolves
  outside the workspace root.
- Response headers include `X-Content-Type-Options: nosniff` and
  `Cache-Control: no-store`.
