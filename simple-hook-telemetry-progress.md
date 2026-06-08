# Simple Hook Telemetry Progress

## Operating Rules

- Use one Harn plan per phase/commit.
- Test before each commit.
- Commit each phase before starting the next phase.
- Keep logs aggregate-only; do not store raw prompts, assistant text, file paths, command text, secrets, or source excerpts.

## Assumptions

<!-- harn:assume tiered-scope-pattern-files ref=progress-pattern-files -->
- Harn was added after the initial spec/pattern planning edits, so Phase 0 records and commits that baseline before implementation starts.
- V1 is a plain JavaScript Node CLI package with no build step, TypeScript, database, public upload, or VADER storage.
- Pattern files are split into user/assistant 1pt and 2pt tier files; blank lines and `#` section headings are ignored.
<!-- harn:end tiered-scope-pattern-files -->
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
<!-- harn:assume tiered-pattern-loader ref=progress-phase-2 -->
| 2. Pattern loader | `phase-2-pattern-loader` | complete | `7509c94` | Compile tiered scope pattern files and return line hits. |
<!-- harn:end tiered-pattern-loader -->
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
| 7. Claude Code live hook adapter | `phase-7-claude-hooks` | complete | `b554d66` | Claude hook normalization and init. |
<!-- harn:end claude-live-hook-counting -->
<!-- harn:assume backfill-idempotent-writes ref=progress-phase-8 -->
| 8. Historical backfill | `phase-8-backfill-core` | complete | `feb8826` | Shared backfill write behavior. |
<!-- harn:end backfill-idempotent-writes -->
<!-- harn:assume codex-historical-backfill ref=progress-phase-9 -->
| 9. Codex backfill | `phase-9-codex-backfill` | complete | `9b406e8` | Parse `~/.codex/sessions/**/*.jsonl` aggregates only. |
<!-- harn:end codex-historical-backfill -->
<!-- harn:assume claude-historical-backfill ref=progress-phase-10 -->
| 10. Claude Code backfill | `phase-10-claude-backfill` | complete | `1e9b3c7` | Parse `~/.claude/projects/**/*.jsonl` aggregates only. |
<!-- harn:end claude-historical-backfill -->
<!-- harn:assume daily-report-percentages ref=progress-phase-11 -->
| 11. Report command | `phase-11-report-command` | complete | `586d217` | Terminal daily summary and rates. |
<!-- harn:end daily-report-percentages -->
<!-- harn:assume local-dashboard-server ref=progress-phase-12 -->
| 12. Local chart server | `phase-12-local-chart-server` | complete | `a104e3e` | Localhost dashboard and `/api/days`. |
<!-- harn:end local-dashboard-server -->
<!-- harn:assume doctor-health-checks ref=progress-phase-13 -->
| 13. Doctor command | `phase-13-doctor-command` | complete | `393d1ab` | Pattern, log path, lock, and hook checks. |
<!-- harn:end doctor-health-checks -->
<!-- harn:assume aggregate-only-safety-checks ref=progress-phase-14 -->
| 14. Privacy and safety review | `phase-14-privacy-review` | complete | `02c85a9` | Verify no raw text/path/command storage. |
<!-- harn:end aggregate-only-safety-checks -->
<!-- harn:assume end-to-end-verification ref=progress-phase-15 -->
| 15. Verification | `phase-15-verification` | complete | phase commit | End-to-end simulated hooks/backfill/report/server checks. |
<!-- harn:end end-to-end-verification -->
| Post-MVP. Tiered pattern files | `tiered-pattern-files` | complete | pending | Split pattern files and counters into 1pt/2pt categories. |
