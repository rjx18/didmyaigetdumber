# METRICS.md

Candidate measurement dimensions beyond the rule-based friction signals in
`SPEC.md`. This is a **design backlog**, not yet an implemented contract — no
Harn assumptions are created until a metric is actually built. `SPEC.md` remains
authoritative for shipped behavior.

## Constraints (inherited from SPEC.md)

Every metric here must obey the project's hard invariants:

- **Aggregate-only.** All metrics are numeric sums, counts, ratios, or
  histograms. Never store raw user/assistant text, file paths, command text, or
  token *content* — only token *counts* and timings.
- **Hooks stay fast and non-blocking.** Live-path metrics must be cheap to
  compute from the event already on stdin. Anything needing transcript parsing
  belongs to `backfill`.
- **Server-side `+1` only** for any public counter; local detail stays local.

## Feasibility tags

- `[live]` — derivable from a single hook event in the hot path.
- `[backfill]` — needs transcript reading (per-message token/timing detail).
- `[token-data]` — depends on `usage` fields that may only appear on some
  events / agent versions.
- `[uncertain]` — provider-specific; not yet confirmed reachable from a hook.

Priority: **P1** build first · **P2** valuable · **P3** nice-to-have.

---

## 1. Token-budget erosion (the core "did it get dumber" signal)

The headline question this project exists to answer: **is the agent quietly
giving me less over time?** Track consumption against the rolling usage window
and watch the trend, not the snapshot.

- **Tokens used per rolling 5h window** `[token-data] [uncertain]` — **P1.**
  Sum of tokens consumed within each rolling 5-hour usage window. Express as
  both an absolute number and a percentage of the window allowance
  (`tokens_used ÷ window_allowance`). The point is **trend detection**: if the
  same workload consumes the allowance faster week over week, or the allowance
  itself shrinks, that's a measurable downgrade. Store per-window totals daily so
  the long-run series is visible.
  - *Open question:* hooks don't see API rate-limit headers. Confirm whether
    Claude Code exposes window/allowance state to a hook or via a local usage
    file before committing to the `%` form; the absolute per-window sum is
    derivable regardless.
- **Peak burn rate** `[token-data]` — **P3.** Busiest hour/window of token
  spend. Useful context for the above, not a primary signal.

*Dropped:* "turns/tokens remaining until reset" — not actionable.

---

## 2. Speed & throughput

- **Output tokens/sec** `[backfill] [token-data]` — **P2.** `output_tokens ÷
  generation time`. Watch for throttling trends.
- **Wall-clock per turn** `[live]` — **P2.** UserPromptSubmit → Stop duration.
- **Time-to-first-tool** `[live]` — **P3.** Prompt → first PreToolUse.
- **Tool latency by tool** `[live]` — **P3.** PreToolUse → PostToolUse duration,
  bucketed by tool name.

*Dropped:* "active vs idle split" — idle time is dominated by the user stepping
away, so it measures the human, not the agent.

---

## 3. Effort & cost

- **Tokens per turn / per session** `[token-data]` — **P1.** Input, output,
  total.
- **Cache hit ratio** `[token-data]` — **P1.** `cache_read ÷ (cache_read +
  input)`. Low ratio = expensive context churn.
- **Estimated $ per day / per session** `[backfill] [token-data]` — **P2.**
  Tokens × model price.
- **Thinking-token share** `[backfill] [token-data]` — **P2.** Reasoning tokens
  as % of output.
- **Output verbosity trend** `[token-data]` — **P3.** Avg output tokens per turn
  over time — is it getting chattier for the same work?

---

## 4. Tool-use patterns

- **Avg tool calls per message** `[live]` — **P1.** PreToolUse count between
  prompts.
- **Explore/Read calls per message** `[live]` — **P1.** Read/Grep/Glob/Explore
  vs. total. How much it looks before it leaps.
- **Tool-call mix** `[live]` — **P2.** % read / edit / execute / search / web.
- **Read-before-edit ratio** `[live]` — **P2.** Edits preceded by a Read of that
  file. Good-practice signal.
- **Parallel-tool ratio** `[live]` — **P3.** Calls issued in batches vs.
  one-at-a-time.

### Per-tool output share (the verbosity-finder)

The metric: of all the bytes tools feed back into context, what share comes from
each tool?

```
tool X % = chars(all tool_results from X) ÷ chars(all tool_results, all tools)
```

- **Per-tool share of tool output** `[backfill]` — **P1.** Measured by
  **character count** of each `tool_result`, attributed to its tool via
  `tool_use_id` → `tool_use.name`. No tokenizer: it's a ratio among tool
  outputs, so char-proportion tracks token-proportion closely enough, with no
  hot-path dependency. Attribution is **exact** (we know which tool produced
  each result); only the char≈token density varies slightly for
  binary/base64/dense-JSON output, which is noise for a "which tool is verbose"
  gauge. Surfaces a single tool quietly bloating context (an unbounded Bash dump,
  a giant Read).
- Tool *calls* themselves (the args the model emits) are output-side and tiny —
  ignored here.

*Dropped:* a "tool output as % of total input" ratio — `input_tokens` blends
user prompt, system prompt, and history inseparably, and caching makes the
denominator shift, so it's neither clean nor exact.

*Separate from this:* the thinking-vs-text split of the model's own output lives
in **Thinking-token share** (§3) — exact on Codex (`reasoning_output_tokens`),
estimated on Claude.

---

## 5. Reliability & rework

- **Tool error rate by tool** `[live]` — **P2.** PostToolUse failures ÷ total,
  per tool (Bash failures, failed edits).
- **Edit churn / rework rate** `[live]` — **P2.** Same file edited multiple
  times in one turn (thrash signal).
- **Permission-denied rate** `[live]` — **P3.** How often calls get blocked.
- **Compaction frequency** `[uncertain]` — **P3.** How often the context window
  fills and summarizes (depends on whether a hook fires).

---

## 6. Session shape

- **Turns per session** `[live]` — **P2.**
- **Tokens / cost per completed task** `[backfill] [token-data]` — **P2.**
  Efficiency, where "task" is bounded by session or git commit.
- **Model mix** `[live]` — **P3.** % Opus / Sonnet / Haiku, if the event carries
  the model id.
- **Plan-mode usage** `[live]` — **P3.** Share of work that went through
  planning first.

---

## Instrumentation plan

Confirmed against real session files on disk (2026-06, Claude Code 2.1.x,
Codex `rollout` format). The hook payloads themselves do **not** carry token or
rate-limit data; the session transcript files do. So the model is:

> **Hook fires → handler reads the session transcript it points at → extracts
> numeric usage → folds into the daily aggregate.**

### Required invariant amendment (SPEC decision, not silent)

This contradicts two current hard invariants and must be amended in `SPEC.md`
before building:

- *"Live hooks process text in memory only; reading historical transcripts is
  restricted to `backfill`."* → relax to allow hook-triggered **incremental**
  reads of the active session file, extracting **numbers only**.
- *Hooks target <100ms.* → preserved by reading only newly-appended bytes (see
  offset design), not the whole file.

The **aggregate-only** invariant is *not* relaxed: we extract token counts,
timestamps, percentages, and tool names — never message text, paths, or command
content. `test/privacy.test.js` still governs what may hit disk.

### Mechanism: hook-triggered incremental tail

1. Claude hooks receive `transcript_path`, `session_id`, `cwd`. Codex's active
   rollout file is the newest `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
   (match on `cwd` to disambiguate concurrent sessions).
2. Persist a per-session **byte offset** (e.g. in `~/.didmyaigetdumber/offsets/`).
3. On each triggering event, read only `file[offset..EOF]`, parse the new JSONL
   lines, accumulate numeric deltas, then save the new offset.
4. Trigger on low-frequency events (Claude `SessionEnd`/`StopFailure`; Codex
   `Stop`) to stay cheap; `PostToolUse` is optional and should be debounced.
5. The existing `backfill` parsers (`src/backfills/{claude,codex}.js`) get the
   same numeric extractors, so a full historical pass and the live tail share
   one code path.

### Data-source field map (verified)

**Claude** — `~/.claude/projects/<slug>/<session>.jsonl`, one JSON record/line:
- `assistant` record → `message.usage`: `input_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`,
  `server_tool_use.{web_search_requests,web_fetch_requests}`, `service_tier`.
- `message.model` (e.g. `claude-opus-4-8`); content blocks typed
  `text` / `thinking` / `tool_use{name,input}`.
- Every record has ISO `timestamp`.
- Following `user` record → `tool_result{tool_use_id, content, is_error}`.
- **No rate-limit window state on disk.** `~/.claude.json` holds only plan-tier
  flags (`organizationRateLimitTier`), not live usage.

**Codex** — `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`:
- `event_msg` `token_count` → `info.total_token_usage` & `last_token_usage`:
  `input_tokens`, `cached_input_tokens`, `output_tokens`,
  `reasoning_output_tokens`, `total_tokens`; `info.model_context_window`.
- Same record's `rate_limits`: `primary{used_percent, window_minutes:300,
  resets_at}` (**the 5h window**), `secondary{...,window_minutes:10080}`
  (weekly), `plan_type`.
- `turn_context` → per-turn `model`, `cwd`.
- `response_item` `function_call`/`custom_tool_call`/`web_search_call` and
  `event_msg` `patch_apply_end`/`mcp_tool_call_end`/`web_search_end` →
  tool activity; `task_started`/`task_complete` → task timing boundaries.

### Per-metric measurement & fidelity

| Metric | Claude | Codex |
|---|---|---|
| **5h-window % used** | ✗ on disk — only an absolute token sum bucketed into rolling 5h windows (no official %/allowance) | ✓ **exact** from `rate_limits.primary.used_percent`+`resets_at` |
| **Implied allowance trend** (did tokens shrink) | ~ infer from absolute consumption vs. when limits hit | ✓ `tokens_used ÷ (used_percent/100)` — directly detects shrinkage |
| **Tokens per turn/session** | ✓ sum `message.usage` | ✓ `last_token_usage` per turn |
| **Cache hit ratio** | ✓ `cache_read ÷ (cache_read+input+cache_creation)` | ✓ `cached_input ÷ input` |
| **Thinking-token share** | ~ **estimate** (thinking folded into `output_tokens`; size thinking blocks) | ✓ **exact** `reasoning_output_tokens` |
| **Output tokens/sec** | ~ `output_tokens ÷ (Δ between record timestamps)` — approximate | ~ same via record timestamps |
| **Per-tool share of tool output** | ✓ **exact share** by `tool_result` char count, attributed via `tool_use_id`→`tool_use.name` | ✓ **exact share** by tool-result char count per tool |
| **Est. $ / day / session** | ✓ tokens × model price (`model` known) | ✓ tokens × price (`model` from `turn_context`) |
| **Wall-clock per turn / tool latency** | ✓ record `timestamp` deltas (tool_use→tool_result) | ✓ `task_started`→`task_complete`; tool event timestamps |
| **Avg tool calls / explore-read / mix / read-before-edit / parallel** | ✓ count `tool_use` blocks by `name` (live or backfill) | ✓ count `function_call`/tool events by name |
| **Tool error rate** | ✓ `tool_result.is_error` | ✓ tool-end payload status |
| **Edit churn / rework** | ✓ repeated edits to same file in a turn | ✓ repeated `patch_apply` to same target |
| **Compaction frequency** | ~ if a compaction record/event exists | ✓ `event_msg` `context_compacted` + `compacted` records |
| **Model mix / plan-mode / turns per session** | ✓ `model`, content shape, record counts | ✓ `turn_context.model`, task counts |

Legend: ✓ exact from a reported field · ~ approximate (timestamp- or
size-derived; exact tokenization is not in the transcripts) · ✗ not available.

### Calculation & recording

**Golden rule: store additive raw counters per day; derive every ratio,
percentage, and average at report time.** A ratio cannot be re-aggregated across
days, so we never persist one. The daily log stays additive (matching today's
`totals`/`matches` merge semantics); ratios are computed in `report`/`server`.

Proposed daily-log extension (`schema_version` → 2; all additive unless noted):

```jsonc
{
  // ...existing totals, matches...
  "tokens": {                 // additive daily sums
    "input": 0,
    "output": 0,
    "cache_read": 0,
    "cache_creation": 0,
    "reasoning_output": 0,    // Codex exact; 0 on Claude
    "thinking_chars": 0,      // Claude: size of `thinking` blocks (est. input)
    "text_chars": 0           // Claude: size of assistant `text` blocks
  },
  "tool_output_chars": {},    // additive map: { "Bash": 0, "Read": 0, ... }
  "tool_calls_by_name": {},   // additive map: { "Bash": 0, "Edit": 0, ... }
  "timings_ms": {             // store sum + count; average at report time
    "turn_sum": 0, "turn_count": 0,
    "ttft_sum": 0, "ttft_count": 0,
    "tool_latency_sum": 0, "tool_latency_count": 0
  },
  "windows": []               // NON-additive snapshots — see below
}
```

Merge rules: scalar sums add; the two maps merge by summing per key; `windows`
appends then dedupes by `resets_at` keeping the max `used_percent`.

Per-metric **record → report formula**:

| Metric | Recorded (additive) | Report-time formula |
|---|---|---|
| Tokens/turn/session | `tokens.*` sums | direct, or ÷ `totals.sessions` |
| Cache hit ratio | `input`, `cache_read`, `cache_creation` | `cache_read ÷ (cache_read + input + cache_creation)` |
| Thinking share (Claude) | `thinking_chars`, `text_chars`, `output` | `thinking_chars ÷ (thinking_chars + text_chars)` × `output` |
| Thinking share (Codex) | `reasoning_output`, `output` | `reasoning_output ÷ output` |
| Per-tool output share | `tool_output_chars{tool}` | `tool_output_chars[t] ÷ Σ tool_output_chars` |
| Avg tool calls / msg | `tool_calls_by_name`, `assistant_messages` | `Σ tool_calls_by_name ÷ assistant_messages` |
| Explore/read ratio · mix | `tool_calls_by_name` | read-ish tools ÷ Σ; or per-tool % |
| Tool error rate | `tool_failures`, `tool_calls` (existing) | `tool_failures ÷ tool_calls` |
| Est. $ | `tokens.*` + a model→price table | `Σ tokenₜ × priceₜ` (price by `model`) |
| Wall-clock / latency | `timings_ms.*_sum` + `*_count` | `sum ÷ count` |
| Output tokens/sec | `output`, generation-time sum | `output ÷ gen_seconds` (gen time approx from timestamps) |

**The one exception — rate-limit windows (Codex).** `used_percent` is a
point-in-time snapshot of a *rolling* 5h window, so it is **not** additive and
does not belong in a daily sum. Record each observed snapshot as:

```jsonc
{ "kind": "5h", "resets_at": 1780901738, "used_percent": 73, "sampled_at": "..." }
```

For **implied-allowance / shrinkage** detection, the report layer reconstructs
each 5h window from the per-turn token series (timestamps + `last_token_usage`)
and pairs it with the matching snapshot:

```
tokens_in_window ÷ (used_percent ÷ 100)  ≈  current allowance
```

Plot that number over weeks — a downward step is a quiet token cut. This is the
only metric that needs a small time-series, not a pure daily counter; everything
else fits the additive model.

### Harn assumption impact (when built)

- `daily-aggregate-log-schema` — **retire + create** (schema v2 adds the blocks
  above; merge semantics extended for maps + `windows`).
- `normalized-event-increments` — **change** (events now carry numeric token /
  timing / per-tool deltas).
- `claude-live-hook-counting`, `codex-live-hook-counting` — **change** (hooks now
  do an incremental tail read of the session file).
- `claude-historical-backfill`, `codex-historical-backfill` — **change** (shared
  numeric extractors).
- `local-aggregate-privacy` — **reviewed/unchanged** (numbers only; no text).
- New assumption — the per-session **byte-offset tail** contract (read only
  appended bytes; persist offset under `~/.didmyaigetdumber/offsets/`).
- The SPEC invariant amendment (hooks may read the active transcript for numbers)
  is a prerequisite, not an assumption edit.

### Honest caveats

- **Per-tool output share is exact** (char-proportional, attributed by
  `tool_use_id`) — no tokenizer needed. The only output-side split that stays an
  **estimate** is Claude's thinking-vs-text share, since Claude folds thinking
  into one `output_tokens` (Codex reports `reasoning_output_tokens` exactly).
- **The Claude 5h-window metric is fundamentally weaker** than Codex's — we can
  show consumption trend but not an official remaining-percentage. If detecting
  allowance shrinkage matters most, **Codex is the stronger signal** and worth
  prioritizing.
- **Schema change.** Most of these need numeric fields (`usage`, timestamps,
  `tool_name`, `rate_limits`) added to the normalized event and a widened
  daily-log schema — gated by its own Harn plan, with `daily-aggregate-log-schema`
  and the live-hook assumptions reviewed.
