# didmyaigetdumber Hook Telemetry Spec

## Purpose

`didmyaigetdumber` is a local-first telemetry tool for AI coding agents. It detects rule-based workflow friction signals in Codex and Claude Code sessions, aggregates daily totals locally, and can optionally submit privacy-preserving per-hook event claims to a public tracker.

The project is inspired by reports where degradation is visible as a trend across many sessions rather than one bad answer: more user corrections, more visible model concessions, more stop-like language, more user interruption, and more repeated restarts.

## Goals

- Detect common friction signals using editable regex pattern files.
- Support Codex and Claude Code through hook adapters.
- Keep raw prompts, assistant messages, file paths, and source code local by default.
- Write one daily aggregate file at `~/.didmyaigetdumber/logs/<YYYY-MM-DD>.json`.
- Record enough counters to compare trends by day, agent, model, and version.
- Make public event upload opt-in and no-login.
- Reduce public fake-data and spam by accepting only server-side `+1` event increments, never client-supplied totals.

## Non-Goals

- Proving model quality regressions from local data alone.
- Uploading raw conversation text.
- Blocking, steering, or correcting the agent by default.
- Inspecting hidden reasoning traces.
- Replacing provider-side evals or replay infrastructure.

## Design Principles

- **Local first:** every signal can be computed and reviewed on the user's machine.
- **Proxy, not proof:** metrics are labeled as behavioral proxies.
- **Deterministic classification:** every match comes from a locale, filename, and line number.
- **Editable vocabulary:** users can add local idioms, languages, and profanity patterns without rebuilding the tool.
- **Low hook risk:** hooks should be fast, silent on success, and non-blocking unless the user explicitly enables guardrail behavior.
- **Privacy by default:** daily logs store counts, not raw prompts, assistant text, file paths, or command text.

## Supported Agents

### Codex

Codex supports hooks through `hooks.json` or inline `[hooks]` config. Current useful events include `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, `SessionStart`, `PreCompact`, and `PostCompact`.

The Codex adapter should install user-level hooks under `~/.codex/hooks.json` by default. Project-local installation is optional and should be explicit.

Minimum Codex hook coverage:

- `UserPromptSubmit`: classify user prompt patterns.
- `PostToolUse`: count tool calls and optionally failed/retried tool behavior when the hook input exposes it.
- `PermissionRequest`: count permission prompts.
- `Stop`: finalize turn-level counters and classify visible assistant output if available from the hook payload or transcript reference.
- `SessionStart`: create the daily log if needed.

### Claude Code

Claude Code supports lifecycle hooks in settings files such as `~/.claude/settings.json`, `.claude/settings.json`, and plugin/skill hook bundles. Current useful events include `UserPromptSubmit`, `MessageDisplay`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Stop`, `StopFailure`, `SessionStart`, and `SessionEnd`.

Minimum Claude hook coverage:

- `UserPromptSubmit`: classify user prompt patterns.
- `MessageDisplay`: classify visible assistant concession, reasoning-loop, and stop-like phrases as text is displayed.
- `PostToolUse` and `PostToolUseFailure`: count tool success/failure.
- `PermissionRequest` and `PermissionDenied`: count approval or auto-mode friction.
- `Stop` and `StopFailure`: finalize turn-level counters.
- `SessionStart`: create the daily log if needed.
- `SessionEnd`: flush any pending local writes.

## Architecture

```text
agent hook event JSON
  -> agent adapter
  -> normalized event envelope
  -> pattern engine
  -> daily accumulator
  -> ~/.didmyaigetdumber/logs/YYYY-MM-DD.json
  -> optional per-event uploader
```

### Components

- `didmyaigetdumber hook`: command invoked by Codex/Claude hooks. Reads event JSON on stdin.
- `agent adapters`: normalize provider-specific hook payloads into a shared schema.
- `pattern loader`: loads tiered `patterns/<locale>/*.md` files and treats each non-empty, non-comment line as one regex.
- `pattern engine`: applies regexes to normalized text fields.
- `daily accumulator`: updates daily aggregate JSON atomically.
- `event uploader`: optional no-login hook-event submitter.
- `doctor`: verifies hooks, pattern syntax, permissions, and log writability.

There is no separate upload CLI in the normal data path. The same hook script that classifies an event also performs the optional upload for that event. Manual commands may exist for setup, diagnostics, and replaying local debug fixtures, but public production counters must not be updated from client-supplied daily aggregate JSON.

## Normalized Event Envelope

Every adapter emits this internal shape:

```json
{
  "schema_version": 1,
  "event_id": "uuid-v7",
  "observed_at": "2026-06-08T14:20:31+08:00",
  "local_date": "2026-06-08",
  "agent": "codex",
  "agent_version": "unknown",
  "model": "gpt-5.5",
  "event_type": "user_prompt",
  "tool_name": null,
  "text_scope": "user",
  "text": "raw text is used in memory only and never written by default",
  "runtime_flags": {
    "interrupted": false,
    "stop_failure": false,
    "permission_denied": false
  }
}
```

The `text` field is transient. It must not be written to disk unless the user enables an explicit debug mode.

## Signal Categories

### User Prompt Signals

- `user_1pt`: user-scope friction patterns that are useful but noisy, including failure reports, corrections, pushback, lexical interrupts, and steering phrases such as "doesn't work", "wrong", "I don't want", "no, don't", "undo", "pause", and "cancel".
- `user_2pt`: higher-confidence user frustration patterns, mainly profanity and direct insults such as "wtf", "why tf", "bullshit", and "are you stupid".

### Assistant Message Signals

- `assistant_1pt`: visible assistant concessions, uncertainty, stop-like phrasing, and recovery language such as "good catch", "I can't continue", "may not be complete", "I need to reconsider", and "let me step back".
- `assistant_2pt`: explicit assistant self-failure admissions such as "I failed to", "I broke it", "I violated the instructions", "my mistake", and "I introduced a regression".

### Runtime Signals

- `tool_call`: any agent tool call.
- `tool_failure`: failed tool call when visible.
- `permission_request`: permission or approval prompt.
- `permission_denied`: denied permission or auto-mode denial.
- `runtime_interrupt`: a real cancel/interrupt event if the agent exposes one.
- `stop_failure`: turn ended due to API/runtime error.

Important: lexical interrupts and runtime interrupts are separate. A user saying "stop doing that" is not the same as a terminal Ctrl-C or UI cancel event.

## Pattern Files

<!-- harn:assume tiered-scope-pattern-files ref=spec-pattern-files -->
Pattern files live under locale folders:

```text
patterns/en/user-1pt.md
patterns/en/user-2pt.md
patterns/en/assistant-1pt.md
patterns/en/assistant-2pt.md
```

Each `.md` file is intentionally plain:

- one regex per non-empty, non-comment line
- blank lines and lines whose trimmed text starts with `#` are ignored
- no YAML
- no IDs
- no per-line weights

The category comes from the filename. The locale comes from the folder name. The pattern identity for local debugging and upload is `{locale}/{filename}:{line_number}`.

Rules:

- Compile each non-empty, non-comment line as a case-insensitive regex.
- Prefer safe regexes compatible with RE2-style engines.
- Backreferences and arbitrary lookaround should be avoided.
- User-scope files: `user-1pt.md` and `user-2pt.md`.
- Assistant-scope files: `assistant-1pt.md` and `assistant-2pt.md`.
- Count a category at most once per hook event, even if multiple lines match.
- Local debug reports may count total line hits, but public counters should use the one-event, one-increment rule.
<!-- harn:end tiered-scope-pattern-files -->

The starter patterns were expanded from local Codex transcript mining across `~/.codex/sessions`:

- 94 JSONL session files.
- 935 unique `user_message` events.
- 5,223 visible `agent_message` events.
- 111 `turn_aborted` runtime events.

The mining pass confirmed that very broad words such as `no`, `stop`, `done`, and `failed` are noisy. Production patterns should prefer contextual phrases such as `it still doesn't work`, `no, I told you`, `you didn't`, `are you stupid`, `don't publish`, and assistant concessions like `you're right to push back`, `good catch`, or `that was my mistake`.

## Daily Log Schema

Daily logs are stored at:

```text
~/.didmyaigetdumber/logs/YYYY-MM-DD.json
```

Example:

```json
{
  "schema_version": 1,
  "date": "2026-06-08",
  "timezone": "Asia/Singapore",
  "created_at": "2026-06-08T00:03:10+08:00",
  "updated_at": "2026-06-08T22:14:03+08:00",
  "client": {
    "version": "0.1.0"
  },
  "totals": {
    "sessions": 4,
    "turns": 53,
    "user_prompts": 49,
    "assistant_messages": 45,
    "tool_calls": 912,
    "tool_failures": 31,
    "permission_requests": 12,
    "permission_denied": 2,
    "runtime_interrupts": 1,
    "bad_user_prompts": 9
  },
  "matches": {
    "user_1pt": { "events": 8, "line_hits": 24 },
    "user_2pt": { "events": 1, "line_hits": 4 },
    "assistant_1pt": { "events": 4, "line_hits": 6 },
    "assistant_2pt": { "events": 1, "line_hits": 3 }
  },
  "by_agent": {
    "codex": {
      "sessions": 3,
      "turns": 41,
      "tool_calls": 802,
      "bad_user_prompts": 7
    },
    "claude": {
      "sessions": 1,
      "turns": 12,
      "tool_calls": 110,
      "bad_user_prompts": 2
    }
  },
  "by_model": {
    "gpt-5.5": {
      "turns": 41,
      "user_prompts": 38,
      "bad_user_prompts": 7
    }
  },
  "pattern_files": [
    "patterns/en/user-1pt.md",
    "patterns/en/user-2pt.md",
    "patterns/en/assistant-1pt.md",
    "patterns/en/assistant-2pt.md"
  ]
}
```

The daily log must be updated atomically:

1. Acquire `~/.didmyaigetdumber/locks/YYYY-MM-DD.lock`.
2. Read existing JSON or initialize a new day.
3. Apply increments.
4. Write a temp file in the same directory.
5. `fsync` and rename.

## Privacy

<!-- harn:assume local-aggregate-privacy ref=spec-privacy-storage -->
Never write:

- raw user prompt text
- raw assistant text
- tool command arguments
- file paths
- source snippets
- environment variable values
- API keys or secrets

Optional debug mode may write raw event JSON to `~/.didmyaigetdumber/debug/`, but it must be off by default and excluded from upload.

Daily logs may store numeric sums, counts, timings, rate-limit percentages, token counts, safe model/tool labels, and sanitized per-model aggregate slices. These remain aggregate telemetry fields, not transcript content.

<!-- harn:assume per-model-daily-log-schema ref=spec-model-attribution -->
Per-model slices contain only counters that can be attributed to a resolved
model turn. Account-scoped counters such as sessions, permission events, and
rate-limit windows remain global. Unknown model ownership must be represented
explicitly rather than assigned to a known model, and legacy per-model token
maps may be normalized into the current aggregate schema without fabricating
other historical attribution.
<!-- harn:end per-model-daily-log-schema -->
<!-- harn:end local-aggregate-privacy -->

<!-- harn:assume numeric-transcript-tail-privacy ref=spec-numeric-tail-privacy -->
Metric collection may read newly appended bytes from an active Codex or Claude transcript when the hook payload identifies that transcript. This live transcript tailing is limited to deriving numeric counters, safe timestamps, model names, tool names, rate-limit percentages, and local byte offsets. It must not persist raw message text, file paths, command text, source excerpts, tool payload content, or token content in daily logs, API responses, uploads, or reports.
<!-- harn:end numeric-transcript-tail-privacy -->

## Counting

For each hook event:

- Apply the relevant locale/category regex files.
- Increment category `events` by `1` if at least one line in that category matches.
- Increment category `line_hits` locally by the number of matching regex lines.
- Increment `bad_user_prompts` by at most `1` for a `UserPromptSubmit` event, even if it matches multiple user pattern lines.
- Increment assistant categories separately for visible assistant-message hooks.

There are no per-line weights. The local two-tier score is derived from category filenames, while public accounting stays server-side `+1` per accepted event.

Derived rates:

- `user_pattern_rate = (user_1pt.events + user_2pt.events) / user_prompts`
- `assistant_pattern_rate = (assistant_1pt.events + assistant_2pt.events) / assistant_messages`
- `two_tier_score = 100 * (user_1pt.events + assistant_1pt.events + runtime_interrupts + 2 * (user_2pt.events + assistant_2pt.events)) / user_prompts`
- `interrupts_per_1k_tool_calls = runtime_interrupts * 1000 / tool_calls`
- `bad_prompt_rate = bad_user_prompts / user_prompts`

Reports should show raw denominators. A day with 3 prompts and 1 correction should not be presented like a stable trend.

## Hook Installation UX

Commands:

```bash
didmyaigetdumber init codex
didmyaigetdumber init claude
didmyaigetdumber init all
didmyaigetdumber doctor
didmyaigetdumber report --since 30d
```

Install behavior:

- Ask before editing existing hook config.
- Preserve existing hooks.
- Add only `didmyaigetdumber hook --agent <agent> --event <event>` handlers.
- Prefer user-level hooks for personal telemetry.
- Warn before project-local hooks because they may be committed.
- Provide `uninstall` that removes only managed hook entries.

Hook command requirements:

- Exit `0` on success.
- Never block the agent for classification-only mode.
- Timeout target: under `100ms` for normal prompt/message classification.
- On internal failure, log to `~/.didmyaigetdumber/errors/YYYY-MM-DD.log` and exit `0`.
- If upload is enabled, send the single normalized event from this hook invocation.
- Never upload local daily aggregate files as authoritative counters.

## Optional Public Tracker

Public event upload is opt-in:

```bash
didmyaigetdumber upload enable
didmyaigetdumber upload disable
```

After each hook occurrence, the hook script may POST one event claim to the server. The server computes counters from event claims. It never accepts a client field like `"bad_prompts": 100000`.

Uploaded event payloads include only:

- event ID
- hook event type
- local date
- timezone offset or coarse timezone bucket
- agent name and version
- model string
- matched boolean for the event scope
- matched category, if any
- matched pattern references such as `en/user-1pt.md:4`, if any

Uploaded payloads exclude:

- raw text
- file paths
- repository names
- git remotes
- user names
- hostnames
- command text
- event-level logs

### Server-Side Increment Rules

The public server accepts idempotent event claims, not aggregate deltas.

Required request shape:

```json
{
  "schema_version": 1,
  "event_id": "uuid-v7",
  "agent": "codex",
  "model": "gpt-5.5",
  "event_type": "UserPromptSubmit",
  "local_date": "2026-06-08",
  "scope": "user_prompt",
  "bad_prompt": true,
  "category": "user_1pt",
  "pattern_refs": ["en/user-1pt.md:4"]
}
```

Server behavior:

- Verify schema.
- Reject replayed event IDs within a short retention window.
- Derive all public counters internally.
- For `UserPromptSubmit`, increment `total_prompts` by at most `1`.
- If `bad_prompt: true`, increment `bad_prompts` by at most `1`.
- For assistant events, increment the relevant assistant signal by at most `1`.
- For runtime events such as `turn_aborted`, increment the relevant runtime counter by at most `1`.
- Ignore any client-supplied count greater than `1`.
- Bucket by server receive date and client local date separately to detect clock abuse.
- Rate-limit by IP, user agent, model, event type, and time window.

This directly addresses edited-local-JSON abuse: changing `~/.didmyaigetdumber/logs/YYYY-MM-DD.json` cannot change public counters because the server never reads that file.

### No-Login Anti-Abuse

No-login event telemetry cannot fully prevent fake data. This design intentionally accepts that tradeoff. Abuse is limited by:

- server-side `+1` only
- no client-supplied totals
- replay rejection for repeated event IDs
- per-IP and per-time-window rate limits
- per-model and per-event ceilings
- optional proof-of-work or CAPTCHA if abuse becomes visible

## Reporting

Local report views:

- daily table
- 7-day and 30-day rolling averages
- by agent
- by model
- pattern category breakdown

Public tracker views:

- aggregate by model and agent
- time window comparison
- sample-size warnings
- pattern file filters
- clear methodology page

Every chart must show:

- prompt count
- session count
- tool call count where relevant
- pattern files used

## Known Limitations

- Regex classifiers are noisy and culture/language dependent.
- "You're right" can be healthy collaboration, not necessarily failure.
- Frustration language may reflect task difficulty, not model degradation.
- Hook coverage differs between Codex and Claude Code.
- Runtime interrupts may not be exposed consistently by both agents.
- Model names and backend snapshots may be aliases, not exact deployed weights.
- Users can fake no-login uploads.
- Unsigned upload relies on server rate limits and does not prove that events came from real hook executions.

## MVP Acceptance Criteria

- `didmyaigetdumber hook` can process normalized fixture events for user, assistant, and tool scopes.
- Pattern files load from `patterns/<locale>/*.md`.
- Invalid regexes are reported by `doctor`.
- Daily JSON logs are created under `~/.didmyaigetdumber/logs/`.
- Raw text is not written in normal mode.
- Codex user-level hook installation works without removing existing hooks.
- Claude user-level hook installation works without removing existing hooks.
- Local report computes rates and denominators from daily logs.
- Event upload is disabled by default.
- Upload payload contains no raw text and can increment public counters by at most one event.

## References

- Codex hooks are documented in the current OpenAI Codex manual under `/codex/hooks.md`.
- Claude Code hook lifecycle, event names, settings locations, matchers, and handler types are documented at <https://code.claude.com/docs/en/hooks>.
