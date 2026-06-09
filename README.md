# didmyaigetdumber

Local-first hook telemetry for AI coding agents.

## Install

<!-- harn:assume scoped-npm-package ref=package-scope -->
<!-- harn:assume scoped-npm-package ref=readme-install -->
Run the guided installer:

```bash
npx @richhardry/didmyaigetdumber@latest install
```

The installer helps you:

- install Codex and Claude Code hooks
- backfill local Codex and Claude Code session logs
- choose whether to opt in to privacy-preserving public telemetry

Daily logs stay aggregate-only under `~/.didmyaigetdumber/logs/`. They do not store raw prompts, assistant messages, file paths, command text, source snippets, or secrets.
<!-- harn:end scoped-npm-package -->
<!-- harn:end scoped-npm-package -->

## Commands

```bash
didmyaigetdumber report
didmyaigetdumber doctor
didmyaigetdumber backfill all
didmyaigetdumber start
```

`didmyaigetdumber start` opens a local dashboard server. By default it listens on `http://127.0.0.1:3587`.

The dashboard reads a single aggregate endpoint, `GET /api/ui?days=N&granularity=G`, and renders:

- a server-computed **system status** verdict (healthy / degraded / insufficient-data) and **headline KPIs** over a trailing 14-day rolling window;
- a **model toggle** ("All models" plus one entry per attributed model) that scopes every section to one model's metrics;
- a **granularity** control (`1h · day · week · 2w · month`) that re-buckets the detailed charts server-side (`1h` is bounded to the hourly retention window);
- **rate-limit** windows led by estimated **time-to-exhaustion** and time-to-reset (account-wide; not model-scoped).

Everything stays aggregate-only and offline (vendored assets, same-origin fetch). Backend
features the dashboard would still like — per-tool latency, a burn-rate series, and cost/$
views — are tracked in [`BACKEND_BACKLOG.md`](BACKEND_BACKLOG.md).
