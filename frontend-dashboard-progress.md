# Frontend Dashboard Progress

Implements `tmp/plan/frontend-dashboard.md`: ship the `ai tracker` mockup as the real
`didmyaigetdumber start` dashboard — vendored static assets served by the existing Node
`http` server, fed by live aggregate metrics.

## Operating Rules

- One Harn plan per implementation phase.
- Test and commit before starting the next phase.
- UI loads only locally vendored assets (no CDN); endpoints stay aggregate-only.

## Phase Status

| Phase | Harn plan | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
<!-- harn:assume ui-static-asset-serving ref=progress-phase-1 -->
| 1. Vendor assets + static serving | `frontend-phase-1-static-serving` | complete | phase commit | Serve `src/ui/` static files; replace inline `dashboardHtml()`. |
<!-- harn:end ui-static-asset-serving -->
<!-- harn:assume rolling-status-metrics-api ref=progress-phase-2 -->
| 2. Aggregate UI data endpoint | `frontend-phase-2-ui-data-endpoint` | complete | phase commit | `GET /api/ui?days=N` aggregate-only payload. |
<!-- harn:end rolling-status-metrics-api -->
<!-- harn:assume ui-live-data-binding ref=progress-phase-3 -->
| 3. Wire live data into the UI | `frontend-phase-3-live-data` | complete | phase commit | Replace synthetic `data.js`; empty/error states; `?demo=1`. |
<!-- harn:end ui-live-data-binding -->
| 4. Close metric gaps / prune | `frontend-phase-4-metric-gaps` | superseded | — | Folded into FE-F; friction tiers already arrive via `/api/ui` top-level `friction.t1/t2`. |
| 5. Polish, offline + start wiring | `frontend-phase-5-polish` | superseded | — | Folded into FE-F. |
| 6. End-to-end verification | `frontend-phase-6-e2e` | superseded | — | Folded into FE-F verification. |

## Metrics-v3 consumption re-plan (2026-06-09)

The metrics-v3 backend (B1–B8) is complete; `/api/ui` now exposes `all`, `byModel`,
`models`, `account`, server-computed `rolling`/`status`, reworked `limits`
(time-to-exhaustion), and `?granularity=`. The frontend consumes **none** of it yet. The
phases below re-plan the remaining frontend work against the **real API field names**
(`rolling.<m> = {current,previous,change,changeRatio}`, `status.verdict ∈
healthy|degraded|insufficient-data`, `limits.fiveHour.percentTimeToExhaustHrs`,
`models[] = {id,name,tokens,attributedTurns}`). Backend asks that surfaced are logged in
`BACKEND_BACKLOG.md` (per-tool latency #6, burn-rate series #7, cost #5) — the frontend
does **not** wait on them.

| Phase | Harn plan | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| FE-A. Payload plumbing (`data.js`) | `frontend-fe-a-payload-plumbing` | complete | phase commit | Carry `all`/`byModel`/`models`/`account`/`rolling`/`status`/reworked `limits`/`buckets`; send `?granularity`; demo-mode parity. |
| FE-B. Rolling KPIs + server status | `frontend-fe-b-rolling-status` | complete | phase commit | Hero verdict + KPI headlines/deltas from `all.status`/`all.rolling`; removed hardcoded meta/narrative. |
| FE-C. Rate-limit rework (KPI-only burn) | `frontend-fe-c-rate-limits` | complete | phase commit | Lead with time-to-exhaustion + reset; burn rate is a current KPI (no sparkline until backlog #7). |
| FE-D. Model toggle | `frontend-fe-d-model-toggle` | complete | phase commit | `models` selector; scope threads through hero/KPIs/sections; limits stay account-wide; label hygiene. |
| FE-E. Granularity selector | `frontend-fe-e-granularity` | complete | phase commit | `1h·day·week·2w·month` detailed control via `granularity` URL param + reload; server re-buckets; 14-day KPIs/status unaffected; `1h` bounded server-side. |
| FE-F. Gaps / prune / polish | `frontend-fe-f-polish` | complete | phase commit | Brand → didmyaigetdumber, relabel impossible per-session distributions and per-tool-latency (backlog #6) placeholders, README dashboard docs. |

## Refinement re-plan (2026-06-09)

Review fixes/redesigns from `tmp/plan/frontend-dashboard-refinement.md`: stray KPI
separator, hard-refresh on granularity, confusing rate-limit "resets first", jagged
charts, leftover "coming to this section" placeholders, and single-line "All models".

| Phase | Harn plan | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| R1. Smooth charts + KPI separator | `frontend-r1-smooth-kpi` | complete | phase commit | Catmull-Rom smoothing in `pathFor`; first KPI of each row loses its left border. |
| R2. Remove "coming to this section" | `frontend-r2-remove-placeholders` | complete | phase commit | Delete roadmap placeholders + `.planned` styles. |
| R3. Rate-limit card redesign | `frontend-r3-rate-limit-redesign` | complete | phase commit | Lead with reset + used%; exhaustion is a conditional warning. |
| R4. SPA data loading | `frontend-r4-spa-loading` | planned | — | Async re-fetch on granularity; no page reload. |
| R5. Per-model multi-line for "All models" | `frontend-r5-per-model-multiline` | planned | — | One colored line per model + legend. |
