# Frontend Consolidation Progress

Implements `tmp/plan/frontend-dashboard-consolidation.md`: collapse the dashboard to four
tabs, fix chart labeling/units, prune dead charts, and omit partial leading buckets.
Backend-dependent items (allowance series, tool-mix-over-time, true throughput) are
recorded in `BACKEND_BACKLOG.md` (items 8/9/10) and not built this round.

## Operating Rules

- One Harn plan and one implementation commit per phase.
- Run the full test suite and transpile/render checks before committing each phase.
- Frontend consumes the existing `/api/ui`; no backend changes in this round.

## Phase Status

| Phase | Harn plan | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| Backlog + progress | `frontend-consolidation-backlog` | complete | phase commit | Add items 8/9/10 to `BACKEND_BACKLOG.md`; create this tracker. |
| P1. Section restructure (8 → 4 tabs) | `frontend-consolidation-p1-sections` | planned | — | Friction · Activity and Limits · Tokens and Cache · Latency and Tools. |
| P2. Controls + labels | `frontend-consolidation-p2-controls` | planned | — | Move Overall/By-model next to granularity; "At a glance"; per-chart time window. |
| P3. Chart fixes | `frontend-consolidation-p3-charts` | planned | — | Remove severity stack; tool mix → two bars; name truncation; TTFT s/min; latency s/ms; per-model-mix range label. |
| P4. Partial-bucket omit | `frontend-consolidation-p4-buckets` | planned | — | Drop a leading bucket shorter than its period across all series. |
