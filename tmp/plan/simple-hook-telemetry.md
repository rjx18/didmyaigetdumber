# Simple Hook Telemetry Implementation Plan

## Scope

Build `didmyaigetdumber` as a small Node.js CLI package that can be installed with npm, run with npx, receive Codex and Claude Code hook JSON on stdin, update local daily aggregate logs, backfill historical logs, and serve a local chart dashboard.

Keep v1 intentionally simple:

- Plain JavaScript.
- No TypeScript.
- No build step.
- No database.
- No raw text storage.
- No public upload.
- No VADER storage.
- No transcript parsing during live hooks.

## Phase 1: Package And CLI Skeleton

Create the package structure:

```text
package.json
bin/didmyaigetdumber.js
src/cli.js
src/hook.js
src/patterns.js
src/log-store.js
src/backfill.js
src/report.js
src/server.js
src/doctor.js
src/init/codex.js
src/init/claude.js
src/adapters/codex.js
src/adapters/claude.js
patterns/en/user-patterns.md
patterns/en/assistant-patterns.md
```

Use one executable bin:

```json
{
  "name": "didmyaigetdumber",
  "version": "0.1.0",
  "bin": {
    "didmyaigetdumber": "./bin/didmyaigetdumber.js"
  },
  "files": [
    "bin",
    "src",
    "patterns",
    "README.md",
    "SPEC.md"
  ]
}
```

CLI commands:

```bash
didmyaigetdumber hook
didmyaigetdumber init codex
didmyaigetdumber init claude
didmyaigetdumber init all
didmyaigetdumber init codex --backfill
didmyaigetdumber init claude --backfill
didmyaigetdumber init all --backfill
didmyaigetdumber backfill codex
didmyaigetdumber backfill claude
didmyaigetdumber backfill all
didmyaigetdumber backfill codex --overwrite
didmyaigetdumber backfill claude --overwrite
didmyaigetdumber backfill all --overwrite
didmyaigetdumber doctor
didmyaigetdumber report --days 30
didmyaigetdumber start --port 3899
```

`npx didmyaigetdumber hook` should work, but installed hooks should use the resolved local/global binary path found by `didmyaigetdumber init` so normal hook execution does not depend on network access.

Acceptance checks:

- `node bin/didmyaigetdumber.js --help` prints commands.
- `npm pack --dry-run` includes only `bin`, `src`, `patterns`, `README.md`, and `SPEC.md`.
- Unknown commands exit non-zero with a short error.

## Phase 2: Pattern Loader

Pattern files:

```text
patterns/en/user-patterns.md
patterns/en/assistant-patterns.md
```

Rules:

- One regex per non-empty line.
- Compile case-insensitive.
- No YAML, IDs, comments, or weights.
- Category is filename without `.md`: `user-patterns` and `assistant-patterns`.
- Use internal metric keys with underscores: `user_patterns` and `assistant_patterns`.

Runtime scope mapping:

```text
user -> patterns/en/user-patterns.md
assistant -> patterns/en/assistant-patterns.md
```

Counting rules:

```text
events += 1 if at least one regex line matched the hook event
line_hits += number of matching regex lines
```

Do not retain matched text.

Acceptance checks:

- `doctor` compiles every regex line.
- Loader returns line numbers for `line_hits`.
- Loader can run from an installed package path, not only the git checkout.

## Phase 3: Minimal Local Storage

Daily logs:

```text
~/.didmyaigetdumber/logs/YYYY-MM-DD.json
```

Locks:

```text
~/.didmyaigetdumber/locks/YYYY-MM-DD.lock/
```

Minimal daily schema:

```json
{
  "schema_version": 1,
  "date": "2026-06-08",
  "updated_at": "2026-06-08T10:30:00+08:00",
  "totals": {
    "sessions": 1,
    "user_messages": 12,
    "assistant_messages": 11,
    "tool_calls": 84,
    "tool_failures": 3,
    "permission_requests": 2,
    "permission_denied": 0,
    "runtime_interrupts": 1
  },
  "matches": {
    "user_patterns": {
      "events": 4,
      "line_hits": 6
    },
    "assistant_patterns": {
      "events": 2,
      "line_hits": 3
    }
  }
}
```

Do not store redundant `bad_user_messages` or `bad_assistant_messages`; those equal `matches.user_patterns.events` and `matches.assistant_patterns.events`.

Do not store:

- Raw user prompts.
- Raw assistant messages.
- Tool command arguments.
- File paths.
- Source snippets.
- Environment values.
- API keys or secrets.
- Session IDs.
- Project hashes.
- Model breakdown in v1.

Acceptance checks:

- `SessionStart` creates the daily log if missing.
- Missing counters initialize to `0`.
- Existing unknown fields are preserved if present, but v1 should not create extras.

## Phase 4: Locking And Atomic Writes

Use an atomic lock directory:

```text
mkdir ~/.didmyaigetdumber/locks/YYYY-MM-DD.lock/
```

Busy-wait behavior:

```text
while mkdir(lockdir) fails:
  if lockdir mtime is older than 30 seconds:
    remove stale lockdir
  sleep 25-100ms
```

Keep the critical section minimal.

Outside lock:

```text
1. Read stdin JSON or backfill source.
2. Detect adapter.
3. Normalize event.
4. Extract transient text if present.
5. Compile/apply relevant patterns.
6. Build increment object in memory.
```

Inside lock:

```text
1. Read or initialize daily JSON.
2. Apply increment object.
3. Write a temp JSON file in the same directory.
4. Rename temp file over the daily JSON.
5. Remove lockdir.
```

Acceptance checks:

- Concurrent hook invocations do not corrupt JSON.
- Lock is released on thrown errors.
- Stale lock guard handles an abandoned lock directory.

## Phase 5: Normalized Event Model

Use a small in-memory event shape:

```json
{
  "agent": "codex",
  "event_type": "user_message",
  "scope": "user",
  "text": "transient text only",
  "flags": {
    "tool_call": false,
    "tool_failure": false,
    "permission_request": false,
    "permission_denied": false,
    "runtime_interrupt": false,
    "session_start": false
  }
}
```

The normalized event must never be written as-is.

Increment object shape:

```json
{
  "totals": {
    "sessions": 0,
    "user_messages": 1,
    "assistant_messages": 0,
    "tool_calls": 0,
    "tool_failures": 0,
    "permission_requests": 0,
    "permission_denied": 0,
    "runtime_interrupts": 0
  },
  "matches": {
    "user_patterns": {
      "events": 1,
      "line_hits": 2
    },
    "assistant_patterns": {
      "events": 0,
      "line_hits": 0
    }
  }
}
```

Acceptance checks:

- A user event with five matching lines increments `user_messages` by `1`, `user_patterns.events` by `1`, and `user_patterns.line_hits` by `5`.
- An assistant event with zero matching lines increments `assistant_messages` by `1` and does not increment `assistant_patterns.events`.

## Phase 6: Codex Live Hook Adapter

Install target:

```text
~/.codex/hooks.json
```

`didmyaigetdumber hook` should detect Codex payloads from payload shape or an installer-provided environment variable.

Codex live mapping:

```text
SessionStart
- totals.sessions += 1
- ensure today's daily log exists

UserPromptSubmit
- scope: user
- text source: prompt/user prompt field, or best available hook text field
- totals.user_messages += 1
- apply user-patterns.md

PostToolUse
- totals.tool_calls += 1
- if payload exposes failed/error status:
  - totals.tool_failures += 1

PermissionRequest
- totals.permission_requests += 1
- if payload exposes denied/rejected status:
  - totals.permission_denied += 1

Stop
- no text handling in v1 unless visible assistant output is directly present
- if payload exposes interruption/cancel:
  - totals.runtime_interrupts += 1

StopFailure / turn_aborted / runtime error equivalent
- totals.runtime_interrupts += 1
```

Codex live hooks should not parse transcript files in v1. Only classify assistant text if the hook payload directly includes visible assistant output.

Codex install behavior:

```text
1. Locate ~/.codex/hooks.json.
2. Read existing hooks if present.
3. Add didmyaigetdumber handlers without removing existing hooks.
4. Prefer the resolved binary path for the hook command.
5. Mark installed entries with a stable name/id if supported by the config shape.
6. Print the file changed and the installed events.
```

Codex target events:

```text
SessionStart
UserPromptSubmit
PostToolUse
PermissionRequest
Stop
StopFailure if available
```

Acceptance checks:

- Existing Codex hooks remain intact.
- Running `init codex` twice does not duplicate entries.
- Hook command exits silently on success.

## Phase 7: Claude Code Live Hook Adapter

Install target:

```text
~/.claude/settings.json
```

Use the Claude adapter for payloads with `hook_event_name`.

Claude Code live mapping:

```text
SessionStart
- totals.sessions += 1
- ensure today's daily log exists

UserPromptSubmit
- scope: user
- text source: payload prompt field
- totals.user_messages += 1
- apply user-patterns.md

MessageDisplay
- scope: assistant
- text source: visible message/display text field
- totals.assistant_messages += 1
- apply assistant-patterns.md

PostToolUse
- totals.tool_calls += 1

PostToolUseFailure
- totals.tool_calls += 1
- totals.tool_failures += 1

PermissionRequest
- totals.permission_requests += 1

PermissionDenied
- totals.permission_denied += 1

StopFailure
- totals.runtime_interrupts += 1

SessionEnd
- no-op in v1
```

If a Claude Code deployment does not expose `MessageDisplay`, skip assistant classification until a visible assistant-message hook or safe payload field is available.

Claude Code live hooks should not parse transcript files in v1. Hook input includes `transcript_path`, but live mode should ignore it.

Claude install behavior:

```text
1. Locate ~/.claude/settings.json.
2. Read existing settings if present.
3. Merge hook entries under the documented hooks object.
4. Prefer the resolved binary path for the hook command.
5. Preserve existing user/project hooks.
6. Print the file changed and the installed events.
```

Claude target events:

```text
SessionStart
UserPromptSubmit
MessageDisplay
PostToolUse
PostToolUseFailure
PermissionRequest
PermissionDenied
StopFailure
SessionEnd
```

Acceptance checks:

- Existing Claude settings remain intact.
- Running `init claude` twice does not duplicate entries.
- If `MessageDisplay` is unavailable, installer warns but still installs supported hooks.

## Phase 8: Historical Backfill

Backfill reads historical transcripts explicitly and writes only aggregate daily JSON.

Commands:

```bash
didmyaigetdumber backfill codex
didmyaigetdumber backfill claude
didmyaigetdumber backfill all
didmyaigetdumber backfill codex --overwrite
didmyaigetdumber backfill claude --overwrite
didmyaigetdumber backfill all --overwrite
```

Install flags:

```bash
didmyaigetdumber init codex --backfill
didmyaigetdumber init claude --backfill
didmyaigetdumber init all --backfill
```

`--backfill` on init means:

```text
1. Install hooks.
2. Run the matching backfill command.
3. Print created/skipped/overwritten day counts.
```

Backfill write behavior:

```text
1. Scan source logs.
2. Compute increments in memory grouped by local date.
3. For each date, write using the same lock/write path as hooks.
4. By default, create missing daily JSON files and skip existing dates.
5. With --overwrite, replace daily JSON files for dates covered by the selected source.
```

Do not append backfill counts into existing daily files by default. Without per-session import state, additive backfill is not idempotent.

Acceptance checks:

- Running backfill twice without `--overwrite` does not double-count.
- `--overwrite` rebuilds selected historical dates.
- Backfill does not write raw text.

## Phase 9: Codex Backfill

Scan:

```text
~/.codex/sessions/**/*.jsonl
```

Codex historical mapping:

```text
session_meta
- totals.sessions += 1 once per session file

event_msg user_message
- totals.user_messages += 1
- apply user-patterns.md to message text
- if matched:
  - matches.user_patterns.events += 1
  - matches.user_patterns.line_hits += matched regex line count

event_msg agent_message
- totals.assistant_messages += 1
- apply assistant-patterns.md to visible assistant message text
- if matched:
  - matches.assistant_patterns.events += 1
  - matches.assistant_patterns.line_hits += matched regex line count

response_item function_call / custom_tool_call / web_search_call
- totals.tool_calls += 1

event_msg exec_command_end / patch_apply_end / web_search_end / mcp_tool_call_end
- if payload exposes failure/error status:
  - totals.tool_failures += 1

event_msg turn_aborted / error
- totals.runtime_interrupts += 1
```

Skip:

- Command arguments.
- File paths.
- Function call payloads.
- Tool outputs.
- Source excerpts.
- Encrypted reasoning/content fields.

Do not classify tool output text.

Acceptance checks:

- Backfilled current local Codex logs produce user and assistant denominator counts.
- Session count increments once per JSONL file.
- Tool output content is ignored.

## Phase 10: Claude Code Backfill

Scan:

```text
~/.claude/projects/**/*.jsonl
```

Claude historical mapping:

```text
one transcript file
- totals.sessions += 1 once

user messages / prompts
- totals.user_messages += 1
- apply user-patterns.md

visible assistant messages
- totals.assistant_messages += 1
- apply assistant-patterns.md

tool use records
- totals.tool_calls += 1

tool error/failure records
- totals.tool_failures += 1

interrupted / failed stop records
- totals.runtime_interrupts += 1
```

Claude Code hook input includes `transcript_path`, but transcript parsing is allowed only in explicit backfill mode.

Skip:

- Tool input arguments.
- Tool outputs.
- File paths.
- Source excerpts.
- Project names.
- Transcript paths in stored output.

Acceptance checks:

- Backfill handles missing `~/.claude/projects` gracefully.
- Backfill can parse multiple transcript JSONL shapes defensively.
- No transcript paths are written to daily logs.

## Phase 11: Report Command

Command:

```bash
didmyaigetdumber report --days 30
```

Read:

```text
~/.didmyaigetdumber/logs/*.json
```

Print per day:

```text
date
user_messages
assistant_messages
user_pattern_events
assistant_pattern_events
user_pattern_rate
assistant_pattern_rate
tool_calls
tool_failures
tool_failure_rate
permission_requests
permission_denied
runtime_interrupts
```

Rate formulas:

```text
user_pattern_rate = matches.user_patterns.events / totals.user_messages
assistant_pattern_rate = matches.assistant_patterns.events / totals.assistant_messages
tool_failure_rate = totals.tool_failures / totals.tool_calls
```

Handle zero denominators as `0`.

Acceptance checks:

- Report shows raw denominators.
- Report does not read or need raw transcripts.
- Missing days are skipped, not synthesized.

## Phase 12: Local Chart Server

Command:

```bash
didmyaigetdumber start --port 3899
```

Use Node's built-in `http` module. No framework needed.

Bind to localhost by default:

```text
127.0.0.1:3899
```

Routes:

```text
GET /
- serves static HTML with inline JS/CSS

GET /api/days
- reads ~/.didmyaigetdumber/logs/*.json
- returns per-day aggregate rows
```

API response:

```json
[
  {
    "date": "2026-06-08",
    "user_messages": 12,
    "assistant_messages": 11,
    "user_pattern_events": 4,
    "assistant_pattern_events": 2,
    "user_pattern_rate": 0.3333,
    "assistant_pattern_rate": 0.1818,
    "tool_calls": 84,
    "tool_failures": 3,
    "tool_failure_rate": 0.0357,
    "permission_requests": 2,
    "permission_denied": 0,
    "runtime_interrupts": 1
  }
]
```

Charts:

```text
per-day user pattern %
per-day assistant pattern %
tool failure %
permission requests
permission denied
runtime interrupts
message volume
```

Use simple inline SVG or canvas charts. Avoid CDN chart libraries so the dashboard stays local and private.

Acceptance checks:

- `didmyaigetdumber start` prints the local URL.
- `/api/days` returns no raw text.
- Dashboard works with empty logs and with multiple days.

## Phase 13: Doctor Command

Command:

```bash
didmyaigetdumber doctor
```

Checks:

```text
patterns compile
~/.didmyaigetdumber/logs is writable
~/.didmyaigetdumber/locks is writable
lock acquire/release works
Codex hook config exists and contains didmyaigetdumber entries if installed
Claude hook config exists and contains didmyaigetdumber entries if installed
package binary resolves
```

Output should be concise:

```text
ok patterns
ok log directory
ok lock directory
warn codex hooks not installed
ok claude hooks installed
```

Acceptance checks:

- Doctor exits `0` for warnings.
- Doctor exits non-zero for invalid regexes or unwritable log paths.

## Phase 14: Privacy And Safety Review

Verify the implementation never writes:

- Raw prompts.
- Raw assistant messages.
- Tool command text.
- Tool arguments.
- Tool output.
- File paths.
- Source snippets.
- Environment values.
- Secrets.
- Session IDs.
- Project names.
- Git remotes.

Allowed stored data:

- Date.
- Updated timestamp.
- Numeric counters.
- Pattern category aggregate counters.
- Pattern line hit totals only in aggregate.

Acceptance checks:

- Search source for debug writes.
- Backfill output files contain only the daily schema.
- Server API contains only aggregate fields.

## Phase 15: Verification

Unit-level checks:

```text
pattern compile success
pattern matching increments event once and line_hits by all matched lines
daily log initialization
atomic write preserves JSON validity
lock contention with parallel hook invocations
rate calculations with zero denominators
```

Integration checks:

```text
simulate Codex SessionStart
simulate Codex UserPromptSubmit with matching user text
simulate Claude UserPromptSubmit with matching user text
simulate Claude MessageDisplay with matching assistant text
simulate tool success/failure events
simulate permission events
run backfill against a tiny sanitized JSONL fixture
run report against generated daily logs
run start and fetch /api/days
```

Manual checks:

```text
npm pack --dry-run
npx . doctor
npx . report
npx . start --port 3899
```

## V1 Exclusions

Do not implement in v1:

- Raw debug fixtures.
- Raw transcript parsing during live hooks.
- Public upload.
- Signed upload.
- Client-side aggregate upload.
- Project hashing.
- Session hashing.
- Database storage.
- Model/provider breakdown.
- Per-pattern daily history beyond aggregate `line_hits`.
- VADER or sentiment-score storage.
- Guardrail/blocking behavior.

VADER can remain an offline experiment. If added later, store only aggregate counters.
