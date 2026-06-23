# Roadmap

CodexJournal-Lite is a local-first, privacy-first AI coding session journal.
This roadmap outlines the planned development trajectory.

## v0.7 — npm Package Hardening & One-Command Startup

- [x] Verify npm registry metadata, package contents, and `npx` startup docs
- [x] Add package smoke tests for `npx codexjournal-lite` and global install usage
- [x] Add global `codexjournal` shorthand command
- [x] Improve first-run experience with auto-config detection
- [ ] Add a two-minute README demo GIF or release-hosted demo video

## v0.8 — Cross-Platform Support

- [x] Verify and fix compatibility on macOS and Linux (WSL)
- [x] Add POSIX shell wrapper for verify scripts
- [x] Ensure all paths work correctly on non-Windows platforms
- [x] Document platform-specific setup steps

## v0.9 — Redaction & Privacy Preview

- [x] Add `npm run preview` to show what will be written before archiving
- [x] Show highlighted redactions in terminal output
- [x] Allow users to flag additional terms for redaction
- [x] Strengthen privacy guarantees with visible confirmation

## v1.0 — Stable Local Codex Memory Dashboard

- [x] Full dashboard with calendar heatmap and type/category filters
- [x] Search-as-you-type across all journal entries and tasks
- [x] Offline-first with no external service dependency
- [x] Stable API for community report plugins

## v1.1 — Multi-Source Adapter Architecture

- [x] Multi-source adapter architecture (Claude Code, Gemini CLI, OpenCode)
- [x] Plugin auto-discovery from `src/sources/` and `config.json -> plugins[]`
- [x] Cross-platform CI (ubuntu / macos / windows)
- [x] `--sessions-dir` / `--config` / `--source` CLI parameters
- [x] `codexjournal` shorthand command
- [x] POSIX shell scripts (`verify.sh`, `archive.sh`)
- [x] macOS path redaction (`/Users/<name>/`)
- [x] Custom `redactPatterns` with `flags` field support
- [x] Privacy preview with redaction diff view
- [x] First-run guided onboarding

## v1.2 — Dashboard UX & Field Search

- [x] Structured field search: `source:`, `type:`, `date:`, `from:`, `to:`,
      `title:`, `keyword:`, `path:`, quoted phrases, and negative filters
      (`-source:codex`)
- [x] Dashboard heatmap week scaling (adjustable week count selector)
- [x] Search result highlighting and snippet previews
- [x] Task detail overlay for inspecting full metadata
- [x] Source status panel that probes all registered adapters
- [x] Stable API v1 endpoints (`/api/v1/tasks/:id`, `/api/v1/sources`,
      `/api/v1/search`)

## v1.4 — Workspace Console, Dashboard Intelligence, Source Doctor & Release Readiness

- [x] Fixed Dashboard heatmap week scaling
- [x] Workspace-root support for console and doctor (`--root` parameter,
      `CODEXJOURNAL_ROOT` environment variable)
- [x] Dashboard project activity, task detail, and improved summaries
- [x] Search UX help, filter chips, saved searches, and result highlighting
- [x] Source-doctor and richer source adapter diagnostics
      (`/api/v1/source-doctor`, per-adapter `doctor()` + `capabilities()`)
- [x] Release readiness report
- [x] Export / Tag / Cluster / Migrate commands
- [x] Security headers (CSP, Referrer-Policy)

## Future Considerations

- Static HTML demo
- Better screenshots
- Monthly reports / project reports
- Plugin source adapters
- Large archive performance
- Optional local-only embeddings (clearly marked as future)

## Explicitly NOT Doing

The following are intentionally out of scope and will not be added:

- Default cloud sync
- Telemetry
- Uploading user sessions
- External API analysis
