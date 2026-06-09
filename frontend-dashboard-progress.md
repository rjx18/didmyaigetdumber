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
| 4. Close metric gaps / prune | `frontend-phase-4-metric-gaps` | planned | — | Friction tiers; remove unsupported elements. |
| 5. Polish, offline + start wiring | `frontend-phase-5-polish` | planned | — | Fonts, responsive, docs. |
| 6. End-to-end verification | `frontend-phase-6-e2e` | planned | — | Full test + privacy + offline pass. |
