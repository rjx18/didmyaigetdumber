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
| 2. Schema v2 merge primitives | `metrics-phase-2-schema-v2` | complete | `d7de86d` | Add metric blocks and window sample storage. |
<!-- harn:end daily-metrics-log-schema -->
<!-- harn:assume historical-backfill-numeric-metrics ref=progress-phase-3 -->
| 3. Shared numeric extractors | `metrics-phase-3-numeric-extractors` | complete | `88deb65` | Parse Codex/Claude numeric fields without raw content. |
<!-- harn:end historical-backfill-numeric-metrics -->
<!-- harn:assume historical-backfill-numeric-metrics ref=progress-phase-4 -->
| 4. Backfill metrics | `metrics-phase-4-backfill-metrics` | complete | `3a541a0` | Populate metrics from historical transcripts. |
<!-- harn:end historical-backfill-numeric-metrics -->
<!-- harn:assume transcript-offset-tail-store ref=progress-phase-5 -->
| 5. Offset tail store | `metrics-phase-5-offset-tail-store` | complete | `e3d38ce` | Persist per-session byte offsets. |
<!-- harn:end transcript-offset-tail-store -->
<!-- harn:assume live-hook-numeric-tail-integration ref=progress-phase-6 -->
| 6. Live hook tail integration | `metrics-phase-6-live-tail-hooks` | complete | `92e9974` | Tail active transcripts from low-frequency hooks. |
<!-- harn:end live-hook-numeric-tail-integration -->
<!-- harn:assume local-metrics-api ref=progress-phase-7 -->
| 7. Local backend API | `metrics-phase-7-local-metrics-api` | complete | `b92c98c` | Return aggregate metrics JSON for future frontend. |
<!-- harn:end local-metrics-api -->
<!-- harn:assume cli-metrics-report ref=progress-phase-8 -->
| 8. CLI metrics report | `metrics-phase-8-cli-metrics-report` | complete | `e1b6e74` | Add concise backend validation report. |
<!-- harn:end cli-metrics-report -->
<!-- harn:assume metrics-end-to-end-verification ref=progress-phase-9 -->
| 9. End-to-end verification | `metrics-phase-9-end-to-end-verification` | complete | phase commit | Compare backfill/live paths and privacy output. |
<!-- harn:end metrics-end-to-end-verification -->
