# Simple Hook Telemetry Progress

## Operating Rules

- Use one Harn plan per phase/commit.
- Test before each commit.
- Commit each phase before starting the next phase.
- Keep logs aggregate-only; do not store raw prompts, assistant text, file paths, command text, secrets, or source excerpts.

## Assumptions

<!-- harn:assume two-scope-pattern-files ref=progress-pattern-files -->
- Harn was added after the initial spec/pattern planning edits, so Phase 0 records and commits that baseline before implementation starts.
- V1 is a plain JavaScript Node CLI package with no build step, TypeScript, database, public upload, or VADER storage.
<!-- harn:end two-scope-pattern-files -->
<!-- harn:assume local-aggregate-privacy ref=progress-privacy-storage -->
- Live hooks process text only in memory; historical transcript parsing is limited to explicit backfill commands.
<!-- harn:end local-aggregate-privacy -->

## Phase Status

| Phase | Harn plan | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| 0. Baseline two-pattern planning state | `phase-0-baseline` | complete | `5eb7f4b` | Consolidated pattern files, spec updates, npm metadata, and phased implementation plan. |
<!-- harn:assume npm-cli-entrypoint ref=progress-phase-1 -->
| 1. Package and CLI skeleton | `phase-1-cli-skeleton` | complete | `52f2a85` | Created executable CLI and command routing. |
<!-- harn:end npm-cli-entrypoint -->
<!-- harn:assume scope-pattern-loader ref=progress-phase-2 -->
| 2. Pattern loader | `phase-2-pattern-loader` | complete | `7509c94` | Compile scope pattern files and return line hits. |
<!-- harn:end scope-pattern-loader -->
<!-- harn:assume daily-aggregate-log-schema ref=progress-phase-3 -->
| 3. Minimal local storage | `phase-3-log-store` | complete | `ea400d1` | Daily schema and default counters. |
<!-- harn:end daily-aggregate-log-schema -->
<!-- harn:assume daily-log-locking ref=progress-phase-4 -->
| 4. Locking and atomic writes | `phase-4-locking` | complete | `0ba2a96` | Busy-wait lock and atomic JSON writes. |
<!-- harn:end daily-log-locking -->
<!-- harn:assume normalized-event-increments ref=progress-phase-5 -->
| 5. Normalized event model | `phase-5-event-model` | complete | `0966fb5` | In-memory event and increment objects. |
<!-- harn:end normalized-event-increments -->
<!-- harn:assume codex-live-hook-counting ref=progress-phase-6 -->
| 6. Codex live hook adapter | `phase-6-codex-hooks` | complete | `a3766c5` | Codex hook normalization and init. |
<!-- harn:end codex-live-hook-counting -->
<!-- harn:assume claude-live-hook-counting ref=progress-phase-7 -->
| 7. Claude Code live hook adapter | `phase-7-claude-hooks` | complete | phase commit | Claude hook normalization and init. |
<!-- harn:end claude-live-hook-counting -->
| 8. Historical backfill | pending | pending | pending | Shared backfill write behavior. |
| 9. Codex backfill | pending | pending | pending | Parse `~/.codex/sessions/**/*.jsonl` aggregates only. |
| 10. Claude Code backfill | pending | pending | pending | Parse `~/.claude/projects/**/*.jsonl` aggregates only. |
| 11. Report command | pending | pending | pending | Terminal daily summary and rates. |
| 12. Local chart server | pending | pending | pending | Localhost dashboard and `/api/days`. |
| 13. Doctor command | pending | pending | pending | Pattern, log path, lock, and hook checks. |
| 14. Privacy and safety review | pending | pending | pending | Verify no raw text/path/command storage. |
| 15. Verification | pending | pending | pending | End-to-end simulated hooks/backfill/report/server checks. |
