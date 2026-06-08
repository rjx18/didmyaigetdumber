# Metrics Hooks + Backend Plan

This plan implements the non-frontend parts of `METRICS.md`: storage, backfill,
live hook extraction, and local API/report surfaces. `METRICS.md` remains the
field-map and metric-definition reference; this file only sequences the work.

## Scope

- Build local-only numeric metrics extraction for Codex and Claude.
- Extend daily aggregate storage and local APIs.
- Keep dashboard/frontend changes out of scope.
- Keep raw text, file paths, command text, source excerpts, and token content out
  of daily logs and API responses.

## Preflight Corrections

Before implementation, update `METRICS.md` / `SPEC.md` for these decisions:

- Codex live tailing should use hook `transcript_path` first, not newest rollout
  file discovery. Discovery is fallback only.
- Rename or clarify `[live]` metrics that actually require incremental
  transcript tailing; these are not derivable from a single hook payload.
- `windows` should retain every observed sample. Do not dedupe to one row per
  `resets_at`.
- Store enough data to compute `tokens_in_window` later: either timestamped
  token events or a per-window sample containing `tokens_in_window`.
- Claude timestamps are reliable for the records used by metrics
  (`user`/`assistant`/`system`/`progress`), not literally every metadata record.
- Claude thinking share is a char-based estimate; Codex reasoning-token share is
  exact.

Each implementation phase below should be one Harn plan and one commit.

## Phase 1: Spec + Privacy Contract

Reference: `METRICS.md` sections "Instrumentation plan", "Calculation &
recording", and "Harn assumption impact".

Tasks:

- Amend `SPEC.md` to allow hook-triggered incremental reads of the active
  transcript for numeric extraction only.
- Keep the current privacy invariant for daily logs/API responses.
- Define offset storage as local operational state, not report data and not
  uploaded telemetry.
- Decide the offset key shape explicitly. Prefer provider `session_id` when
  present; any fallback involving transcript path-derived keys needs explicit
  privacy review.

Verification:

- Privacy tests still prove daily logs and APIs exclude raw text, file paths,
  command text, and source excerpts.

## Phase 2: Schema v2 Merge Primitives

Reference: `METRICS.md` "Proposed daily-log extension".

Tasks:

- Add `schema_version: 2` normalization while preserving reads of v1 logs.
- Add additive metric blocks:
  - `tokens`
  - `tool_output_chars`
  - `tool_calls_by_name`
  - `timings_ms`
  - per-model token totals needed for model mix and cost estimates
- Add non-additive `windows` samples with:
  - `kind`
  - `sampled_at`
  - `resets_at`
  - `used_percent`
  - `tokens_in_window`
- Add merge helpers for scalar counters, maps, timing sum/count pairs, and
  append-only window samples.

Verification:

- Unit tests for normalization, v1 compatibility, additive map merges, and
  window sample append behavior.

## Phase 3: Shared Numeric Extractors

Reference: `METRICS.md` "Data-source field map" and "Per-metric measurement &
fidelity".

Tasks:

- Create shared extractor modules for Codex and Claude JSONL records.
- Extract only numeric/safe fields:
  - token counts
  - timestamps/durations
  - model id
  - tool name
  - tool output character counts
  - tool error counts
  - Codex rate-limit window snapshots
  - compaction counts when available
- Do not persist raw `tool_use.input`, tool output content, commands, paths, or
  message text.
- Make parsers defensive: missing fields produce zero/no-op deltas.

Verification:

- Fixture tests with sanitized JSONL records for each supported record shape.
- Privacy tests assert extractor output has no raw content-bearing fields.

## Phase 4: Backfill Metrics First

Reference: `METRICS.md` "The existing backfill parsers get the same numeric
extractors".

Tasks:

- Wire shared extractors into `backfill codex`, `backfill claude`, and
  `backfill all`.
- Preserve existing overwrite/skip behavior.
- Populate schema v2 metric blocks from historical logs.
- Keep current friction-pattern counters intact.

Verification:

- Backfill tests for token totals, cache totals, tool maps, timing sums,
  windows, model totals, and aggregate-only output.
- Run real local backfill in a temp base dir before touching the user's normal
  `~/.didmyaigetdumber`.

## Phase 5: Offset Tail Store

Reference: `METRICS.md` "Mechanism: hook-triggered incremental tail".

Tasks:

- Add `~/.didmyaigetdumber/offsets/` helpers.
- Store only operational cursor data:
  - provider
  - session key
  - byte offset
  - last updated timestamp
  - optional transcript size/inode guard if needed for rotation detection
- Handle missing, truncated, or replaced transcript files by safely resetting or
  no-oping.
- Keep offset critical sections small and separate from daily log writes where
  practical.

Verification:

- Unit tests for first read, incremental read, malformed trailing line,
  truncation, and concurrent-safe updates.

## Phase 6: Live Hook Tail Integration

Reference: `METRICS.md` "Hook fires -> handler reads the session transcript".

Tasks:

- Trigger tail extraction on low-frequency events first:
  - Codex `Stop` / `StopFailure`
  - Claude `SessionEnd` / `StopFailure`
- Use hook `transcript_path` when present.
- Keep existing single-event friction matching behavior unchanged.
- Merge numeric deltas into the same daily log update path.
- Fail soft: extraction errors should not block the agent.

Verification:

- Hook tests with temp transcript files and offset state.
- Timing sanity check that no-op and small-tail paths stay fast.

## Phase 7: Local Backend API

Reference: `METRICS.md` "Per-metric record -> report formula".

Tasks:

- Add derived metric helpers separate from storage.
- Extend or add local JSON endpoints for:
  - daily token totals
  - cache ratio
  - thinking/reasoning share
  - tool output share
  - tool call mix
  - tool error rate
  - timing averages
  - Codex window burn rate and allowance estimate samples
- Keep API response aggregate-only and frontend-neutral.

Verification:

- Server/API tests for allowlisted fields and derived formulas.
- Existing dashboard endpoint remains backward-compatible until frontend work.

## Phase 8: CLI Report Surface

Reference: `METRICS.md` priorities P1/P2.

Tasks:

- Add a concise CLI metrics report for backend validation.
- Start with P1 metrics:
  - tokens per day/session
  - cache hit ratio
  - Codex 5h window samples
  - burn rate
  - allowance estimate
  - avg tool calls/message
  - explore/read share
  - per-tool output share
- Include denominators and sample counts.

Verification:

- Report formatting tests.
- Manual run against temp backfilled data.

## Phase 9: End-to-End Verification

Tasks:

- Run `npm test`.
- Run Harn staged checks for the phase.
- Backfill sanitized fixture data into a temp base dir.
- Simulate live hooks with transcript tailing into a temp base dir.
- Confirm serialized logs/API output contain no private content.

Exit criteria:

- Historical and live paths produce the same metric deltas for the same records.
- Existing friction pattern reporting still works.
- No frontend work is required to inspect backend JSON/CLI output.
