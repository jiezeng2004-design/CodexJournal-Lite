# Roadmap

CodexJournal-Lite is a local-first, privacy-first AI coding session journal.
This roadmap outlines the planned development trajectory.

## v0.7 — npm Package & One-Command Startup

- Publish `codexjournal-lite` to npm registry
- Support `npx codexjournal-lite` and `npm install -g codexjournal-lite`
- Add global `codexjournal` shorthand command
- Improve first-run experience with auto-config detection

## v0.8 — Cross-Platform Support

- Verify and fix compatibility on macOS and Linux (WSL)
- Add POSIX shell wrapper for verify scripts
- Ensure all paths work correctly on non-Windows platforms
- Document platform-specific setup steps

## v0.9 — Redaction & Privacy Preview

- Add `npm run preview` to show what will be written before archiving
- Show highlighted redactions in terminal output
- Allow users to flag additional terms for redaction
- Strengthen privacy guarantees with visible confirmation

## v1.0 — Stable Local Codex Memory Dashboard

- Full dashboard with calendar heatmap and type/category filters
- Search-as-you-type across all journal entries and tasks
- Offline-first with no external service dependency
- Stable API for community report plugins

## Future Considerations

- Multi-agent session support (Claude Code, Gemini CLI, etc.)
- Timeline view for project-level retrospectives
- i18n (English / Chinese interface)
- Skill-based community report templates
