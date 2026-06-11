# Maintainer Workflows with CodexJournal-Lite

CodexJournal-Lite is designed to help open-source maintainers keep a local,
searchable log of AI-assisted coding sessions. This document describes
practical workflows for using it alongside maintainer tasks.

## Why Maintainers Need a Local Journal

AI coding sessions generate valuable context: debugging steps, dependency
analysis, refactoring rationale, code review notes, and release preparation.
Without a journal, this context stays in ephemeral chat logs and is hard to
revisit days or weeks later.

CodexJournal-Lite keeps a local, offline, privacy-first archive so maintainers
can:

- Review AI-assisted bugfix reasoning before merging.
- Track which issues were discussed in past coding sessions.
- Search across sessions for past decisions about a specific module or API.
- Build a personal maintenance log without uploading anything to a service.

## Tracking Bugfix Sessions

After a debugging session with Codex:

```powershell
npm.cmd run archive
```

This writes a structured task record to `data/tasks.json` and a daily journal
entry to `journal/YYYY-MM-DD.md`. The entry includes the user's prompts, the
AI's responses, and detected keywords such as `bugfix`, `error`, or module
names.

Later, search across all sessions:

```powershell
# data/search.md contains a full-text searchable index of every task
Select-String -Path data/search.md -Pattern "bugfix" | Select-Object -First 10
```

## Reviewing PR Preparation

When Codex helps draft or review a pull request:

1. Run `npm.cmd run archive` after the session.
2. Open `journal/YYYY-MM-DD.md` to review the conversation.
3. Check `reports/work-patterns.md` for task-type summaries.

The local dashboard (http://127.0.0.1:7777/) also shows recent tasks and
aggregate statistics for quick review.

## Release Retrospectives

Before cutting a release:

```powershell
npm.cmd run summarize
```

This generates monthly and yearly reports under `reports/monthly/` and
`reports/yearly/`. Each report lists:

- Task types (bugfix, documentation, environment, code, etc.)
- Top keywords and project paths
- Time-of-day and weekday distributions
- Longest and most recent tasks

These reports help maintainers answer:
- What categories of work did Codex help with this month?
- Which projects or directories saw the most activity?
- Are there patterns in when maintainer work happens?

## Privacy-First Sharing

If you want to reference a journal entry in a team discussion or issue:

```powershell
npm.cmd run package:public
npm.cmd run verify:public-zip
```

The public ZIP contains only source code and documentation. Generated personal
outputs are excluded. The verification script confirms no private data leaks
into the archive.

## Further Reading

- [Privacy Model](privacy.md) — what the project reads, writes, and redacts.
- [Usage Guide](usage.md) — step-by-step CLI instructions.
- [Project Summary](project-summary.md) — high-level architecture and design.
