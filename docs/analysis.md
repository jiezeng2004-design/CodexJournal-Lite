# Analysis (summarize)

This document explains how `npm run summarize` works.

## Input

- **`data/tasks.json`** produced by `npm run archive`.
  If this file does not exist, `summarize` exits with code 1 and
  prints an error message.
- **`data/stats.json`** is *not* read by `summarize`; all analysis
  is based on the per-task records in `tasks.json`.

## Output

| File | Description |
| --- | --- |
| `data/patterns.json` | Machine-readable pattern summary. |
| `reports/work-patterns.md` | Human-readable full report. |
| `reports/monthly/YYYY-MM.md` | Per-calendar-month summary. |
| `reports/yearly/YYYY.md` | Per-year summary. |

All output files are passed through `src/sanitize.js` paths and text.
A violation (a real credential or a real Windows username still visible
in any output) is a bug.

## Text cleaning (v0.5.1)

Every title and snippet field in the reports goes through:

1. **Newline stripping** — `\r`, `\n`, `\t` replaced with a single space.
2. **Control-character removal** — non-printable characters (U+0000-U+001F,
   U+007F) removed.
3. **Whitespace collapse** — multiple consecutive spaces collapsed to one.
4. **Truncation** — after cleaning, the string is truncated at the
   configurable limit with `…`. This keeps Markdown table cells from
   breaking across lines.

## Rules

- **No AI.** Every number in the reports is a deterministic aggregate
  over the task list. No external model is called, no network request
  is made, no telemetry is sent.

- **Time of day** is computed from the `time` field of each task:
  | Slot | Hours |
  | --- | --- |
  | morning | 06:00 - 11:59 |
  | afternoon | 12:00 - 17:59 |
  | evening | 18:00 - 23:59 |
  | lateNight | 00:00 - 05:59 |
  | unknown | missing or malformed time string |

- **Long tasks** are the 10 tasks with the highest `messageCount`.
- **Recent tasks** are the 15 most recent tasks by `date` + `time`.
- **Insights** are rule-generated sentences based on the aggregates:
  highest task type, highest time-of-day slot, most frequent project
  path, log continuity (>= 20 active days → "relatively continuous"),
  tooling vs writing type ratios. No insight is synthesised by AI.

## What `summarize` does NOT do

- Does not read `.codex/sessions` directly (relies on `data/tasks.json`).
- Does not modify `data/tasks.json`, `data/stats.json`,
  `data/search.md`, `data/index.json`, `journal/*.md`, `README.md`.
- Does not access JetBrains / IDEA logs (use `npm run scan:sources`
  for that).
- Does not call any network API.
- Does not call any AI model.
