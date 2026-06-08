# Metrics Hooks Backend Progress

## Operating Rules

- Use one Harn plan per implementation phase.
- Test and commit before starting the next phase.
- Keep metric storage aggregate-only: numeric counters, timings, safe model/tool
  labels, and local cursor offsets only.

## Assumptions

<!-- harn:assume numeric-transcript-tail-privacy ref=progress-numeric-tail-privacy -->
- Live metric extraction may tail active Codex/Claude transcript files only for
  numeric metrics and offset bookkeeping. It must not write raw transcript text,
  paths, command text, source excerpts, or token content to logs or APIs.
<!-- harn:end numeric-transcript-tail-privacy -->

## Phase Status

| Phase | Harn plan | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| 1. Spec + privacy contract | `metrics-phase-1-spec-privacy` | complete | `d99aa68` | Define numeric transcript tailing and commit implementation plan. |
<!-- harn:assume daily-metrics-log-schema ref=progress-phase-2 -->
| 2. Schema v2 merge primitives | `metrics-phase-2-schema-v2` | complete | phase commit | Add metric blocks and window sample storage. |
<!-- harn:end daily-metrics-log-schema -->
| 3. Shared numeric extractors | pending | pending | pending | Parse Codex/Claude numeric fields without raw content. |
| 4. Backfill metrics | pending | pending | pending | Populate metrics from historical transcripts. |
| 5. Offset tail store | pending | pending | pending | Persist per-session byte offsets. |
| 6. Live hook tail integration | pending | pending | pending | Tail active transcripts from low-frequency hooks. |
| 7. Local backend API | pending | pending | pending | Return aggregate metrics JSON for future frontend. |
| 8. CLI metrics report | pending | pending | pending | Add concise backend validation report. |
| 9. End-to-end verification | pending | pending | pending | Compare backfill/live paths and privacy output. |
