# Metrics v3 Progress

## Operating Rules

- Use one Harn plan and one implementation commit per phase.
- Run focused tests and the full test suite before committing each phase.
- Keep model attribution aggregate-only and distinguish attributable counters
  from account-scoped counters.

## Phase Status

| Phase | Harn plan | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
<!-- harn:assume per-model-daily-log-schema ref=progress-phase-b1 -->
| B1. Attribution contract + schema v3 primitives | `metrics-v3-phase-b1-schema` | complete | phase commit | Added `by_model`, compatibility projection, and schema tests. |
<!-- harn:end per-model-daily-log-schema -->
<!-- harn:assume date-scoped-transcript-metrics ref=progress-phase-b2 -->
| B2. Date-scoped, model-aware extraction | `metrics-v3-phase-b2-extractors` | complete | phase commit | Partitioned metrics by record date and attributed turn-owned metrics. |
<!-- harn:end date-scoped-transcript-metrics -->
<!-- harn:assume historical-per-model-backfill ref=progress-phase-b3 -->
| B3. Historical backfill integration | `metrics-v3-phase-b3-backfill` | complete | phase commit | Merged date-scoped metrics and model-attributed counters during backfill. |
<!-- harn:end historical-per-model-backfill -->
<!-- harn:assume live-attribution-reconciliation ref=progress-phase-b4 -->
| B4. Live-tail integration and reconciliation | `metrics-v3-phase-b4-live-tail` | complete | phase commit | Wrote date-scoped live tails and enforced direct-hook ownership. |
<!-- harn:end live-attribution-reconciliation -->
| B5. Aggregation core + rate-limit correction | `metrics-v3-phase-b5-aggregation` | planned | — | |
| B6. UI API model views + rolling status | `metrics-v3-phase-b6-ui-api` | planned | — | |
| B7. Day-and-coarser bucketing | `metrics-v3-phase-b7-bucketing` | planned | — | |
| B8. Hourly storage + API | `metrics-v3-phase-b8-hourly` | planned | — | |
