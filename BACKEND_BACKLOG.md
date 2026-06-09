# Backend Backlog

Backend work **requested by the frontend** during the metrics-v3 dashboard consumption
pass (2026-06-09). These are *not yet implemented*; the frontend ships against the
current `/api/ui` surface and degrades gracefully where these would add value.

Each item is written as a spec the backend can pick up independently. The frontend owner
does not implement these — this file is the handoff. The authoritative design doc remains
`SPEC.md`; the per-model API contract lives in `tmp/plan/metrics-per-model-backend.md`,
and the v3 phase record in `metrics-v3-progress.md`.

**Invariants every item must keep** (see `.harn/assumptions/local-aggregate-privacy.yaml`,
`test/privacy.test.js`): aggregate-only, no raw user/assistant text, no file paths, no
command text, no secrets. Pricing tables and tool names are reference/label data, not user
content. New numeric fields are additive; keep `/api/days` and `/api/metrics/days`
backward-compatible.

---

## Item 6 — Per-tool average latency on `/api/ui` *(priority: high, small)*

### Motivation
The Timing section wants **"avg tool latency by tool"** (bars/line per tool, ideally
per-model). The frontend can render it the moment the field exists.

### Current state
- `tool_latency_ms_by_name` (a tool→summed-latency map) **is already persisted** in the
  daily log and in every `by_model[*]` slice (`src/log-store.js`).
- `/api/ui` exposes only the *global* average `timing.toolLatency` (a daily series) and a
  per-tool `tools.mix[]` of `{ name, count, errRate, outChars }` — **no per-tool
  latency**. The data is on disk; the API just doesn't surface it.

### Proposed change
1. In `src/ui-data.js` `buildSeries`, aggregate `tool_latency_ms_by_name` across the range
   alongside the existing call/fail/out aggregation, and add `avgLatencyMs` to each
   `tools.mix[]` entry. Do the same for `byModel[*].aggregates.tools`.
2. **Denominator caveat — likely needs a tiny schema add.** A correct average is
   `Σ latency / Σ (calls that produced a latency sample)`. The store currently has only the
   latency **sum** map (`tool_latency_ms_by_name`) and the total call map
   (`tool_calls_by_name`); not every call yields a latency sample, so dividing the sum by
   `tool_calls_by_name` understates latency. Pick one:
   - **(a) Exact:** add a paired `tool_latency_count_by_name` map to the schema
     (extractors/live hooks increment it whenever they add to the latency sum). Schema
     bump + extractor/backfill change + read-compat for older logs.
   - **(b) Approximate now:** divide the existing sum by `tool_calls_by_name` and document
     it as a lower bound. No schema change.
   Recommend **(a)** for correctness (mirrors the existing `*_sum`/`*_count` timing pairs);
   ship **(b)** only if (a) slips.

### Privacy
Tool names are already sanitized labels in storage; no new content. Aggregate-only holds.

### Tests
- `avgLatencyMs` per tool equals `Σ latency / Σ count` on fixture logs.
- Tools with no latency sample omit the field (or report `null`), never `0`.
- Per-model tool latency sums are consistent with global.

---

## Item 7 — Burn-rate time series on `/api/ui` *(priority: medium, small)*

### Motivation
The Rate-limit section's planned **"Burn rate — sparkline + KPI"** needs a *series*. The
frontend currently ships **KPI-only** (a single current burn-rate number) because the API
exposes only a scalar. This item unblocks the sparkline.

### Current state
- `limits.burnRate` and `limits.fiveHour.burnPctPointsPerHour` are **single current
  scalars**.
- The only time series in `limits` is `windowHistory` (used-% samples), not burn rate.
- Per-sample burn is already computable: `src/metrics.js` `windowMetrics` derives
  per-sample data, and `estimateWindow` computes `burnPctPointsPerHour` from consecutive
  samples.

### Proposed change
- Add `burnHistory` to `limits.fiveHour` and `limits.weekly`: an ordered array of
  per-sample burn-rate values aligned to the same samples as `windowHistory`, in
  **%-points/hour** (account-accurate; derived from `used_percent` deltas over elapsed
  hours).
- Token-rate burn (`tokens/hour`) stays `null` per sample unless the local token allowance
  is known — same reasoning as the existing `local*` split (used-% is account-wide, but
  observed token deltas are machine-local; a true account token-allowance is not knowable).
- This is **point-in-time context**, not a rolling metric.

### Privacy
Derived from existing window samples (numbers only). Aggregate-only holds.

### Tests
- `burnHistory` length and ordering align with `windowHistory`.
- Each value equals `(used_percent[i] - used_percent[i-1]) / elapsed_hours`.
- Empty/single-sample windows yield `[]` (no spurious values).

---

## Item 5 — Cost / spend ($) on `/api/ui` *(priority: medium, larger — product decision)*

### Motivation
Token volume is tracked, but there is **no money view**: cost/day, cost by model, cost per
session, cumulative spend. Users care about spend, not just tokens. This is a genuine
product decision (do we want a money view at all?), not just plumbing.

### Current state
- The frontend has token counts (`tokens.comp.*`, `models[].tokens`,
  `byModel[*].series.tokens.*`) but **no price reference anywhere in the API**.
- Hardcoding a price table in the UI is brittle: prices change, new models appear, and the
  cache-read vs cache-create vs reasoning token classes price differently per provider.

### Proposed change
1. **Pricing table as reference data.** A maintained map keyed by sanitized model id →
   per-token-class rate (`{ input, output, cacheRead, cacheCreate, reasoning }` in $/Mtok),
   stored as a checked-in data file (e.g. `pricing/usd.json`) or a `config.json` section.
   Static reference data — no secrets, no user content.
2. **Server-computed cost (recommended) vs expose-the-table.**
   - *Recommended:* compute cost **server-side** so the math lives in one tested place.
     Add derived fields: `tokens.costUsd` (per-day series), `models[].costUsd`, and
     `byModel[*].series.tokens.costUsd`. Optionally a `cost` rolling metric on `rolling`.
   - *Alternative:* expose the `pricing` table on `/api/ui` and let the UI multiply. More
     flexible, but duplicates the token-class accounting in the browser.
3. **Unknown models → `null` cost**, never `0` (so the UI can show "—" / "price unknown"
   instead of a misleading free reading). Track an "unpriced token share" so the UI can
   warn when a large fraction of spend is unpriced.
4. **Currency:** scope to USD first; structure the table so other currencies can be added.

### Privacy
Pricing is static reference data; cost is an aggregate derived from existing token
aggregates. No raw content, no new invariant risk.

### Tests
- `costUsd = Σ tokens_by_class × rate_by_class` on fixture logs, per day and per model.
- Per-model cost sums to the global cost (for priced models).
- Unknown/unpriced model → `null` cost and counts toward the unpriced-share metric.
- Adding a model to the pricing table changes cost without touching extractor/schema code.

---

## Item 8 — 5-hour-window allowance series on `/api/ui` *(priority: high, small)*

### Motivation
The Limits view should show the **estimated 5-hour-window token allowance** over time —
how big the window's budget is — bucket-averaged at the active granularity. The frontend
can chart it immediately once exposed.

### Current state
- Window samples already carry both `tokens_in_window` and `used_percent`
  (e.g. `{ kind:"weekly", used_percent:58, tokens_in_window:216639 }`), so the implied
  allowance is computable: `allowance = tokens_in_window / (used_percent / 100)`.
- `/api/ui` `limits` exposes only `windowHistory` (a used-% series) and a 14-day scalar
  `localAllowanceEstimateRolling`. There is **no per-bucket allowance series**.

### Proposed change
- Add `limits.allowanceSeries` (and/or per-window-kind) to `/api/ui`: for each calendar
  bucket of the current granularity, the **mean of the per-sample implied allowance**
  (`tokens_in_window / (used_percent/100)`) for the 5h window (skip samples with
  `used_percent == 0`). Align to the same `buckets[]` as the other series so the frontend
  can plot it on the granularity axis.
- Optionally expose the weekly-window allowance series too (decide; the UI asked for 5h).

### Privacy
Derived from existing numeric window samples. Aggregate-only holds.

### Tests
- Per-bucket allowance equals the mean of `tokens_in_window/(used_percent/100)` over the
  bucket's samples; zero-`used_percent` samples are excluded.
- Empty buckets yield `null` (not `0`); series length aligns with `buckets[]`.

---

## Item 9 — Per-day, per-tool counts for a tool-mix-over-time chart *(priority: medium, medium)*

### Motivation
The Tools view shows the tool-call mix as static bars aggregated over the whole range; the
frontend cannot show **how the mix shifts over time** (a stacked area of tool usage by
bucket) because per-day per-tool counts are not exposed.

### Current state
- `tool_calls_by_name` is stored per day, but `/api/ui` only emits the range-aggregated
  `tools.mix[]`. There is no per-day (or per-bucket) tool-count series.

### Proposed change
- Expose a per-bucket per-tool call-count series (e.g. `tools.byBucket[tool][]` aligned to
  `buckets[]`, top-N tools + an "other" bucket) so the UI can stack tool usage over time.
- Output-char (token) variant optional, mirroring the static by-output bars.

### Privacy
Tool names are sanitized labels already. Aggregate-only holds.

### Tests
- Per-bucket tool counts sum (over buckets) to the range-aggregated `tools.mix[]` counts.
- Top-N + other partitioning is stable; empty buckets are 0, not missing.

---

## Item 10 — True generation throughput (tokens/sec) *(priority: medium, larger)*

### Motivation
`timing.throughput` (`output_tokens_per_sec`) reads implausibly low (~4 tok/s) because it
divides output tokens by the **entire turn wall-clock**, not the model's generation time.

### Current state
- Both extractors set `generation_sum` equal to the turn latency
  (`durationMs(taskStartedAt/lastUserAt, assistant_ts)` — `codex.js:145`, `claude.js:127`),
  so `output_tokens_per_sec = output_tokens / turn_wall_clock`. That includes queueing,
  thinking, and intra-turn tool round-trips — not pure generation.

### Proposed change
- Capture (where the transcripts allow) a **generation duration** distinct from total turn
  latency — e.g. first-output-token → last-output-token — and feed `generation_sum` from
  that. If unavailable, document the metric as "output tokens per turn-second" and consider
  dropping the misleading "throughput" framing.
- Until then the frontend keeps the current label unchanged (per product decision).

### Privacy
Timing sums/counts only. Aggregate-only holds.

### Tests
- `output_tokens_per_sec` uses generation duration, not turn wall-clock, on fixtures with
  separable timing; falls back gracefully when generation timing is absent.

---

## Out of scope (recorded, deliberately not requested)

These came up in the same review and are **blocked by the aggregate-only, daily-bucketed
storage model** — closing them would mean abandoning a core invariant, so they are *not*
in this backlog. Listed so the decision is on record:

- **Distributions / histograms** (turns-per-session, tokens-per-session distributions).
  Storage keeps daily totals and means only — no per-session/per-turn samples.
- **Percentiles / tail latency** (p50/p95 TTFT, slowest turns). Timings are stored as
  `*_sum`/`*_count` pairs → only averages are recoverable.
- **Per-session / per-conversation drilldown** (session timelines). Aggregate-only by
  invariant; there are no session records.
- **Friction by *type*** (retry vs correction vs concession as separate series). Friction
  is bucketed by **tier** (`user/assistant_1pt/2pt`), not semantic type; separating types
  is a counting-model change in `events.js` + pattern files, not an API exposure.

If any of these is later wanted, it is a deliberate storage/schema decision (e.g. bounded
per-day histograms), not a frontend or `/api/ui` task.
