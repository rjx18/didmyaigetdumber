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
| FE-E. Granularity selector | `frontend-fe-e-granularity` | planned | — | `1h·day·week·2w·month` detailed control; gate `1h` to hourly retention. |
| FE-F. Gaps / prune / polish | `frontend-fe-f-polish` | planned | — | Branding, prune unsupported elements, per-tool-latency deferred to backlog #6, docs, e2e. |
