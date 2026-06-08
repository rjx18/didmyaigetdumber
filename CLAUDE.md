# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`didmyaigetdumber` is a local-first, zero-build CommonJS Node CLI that detects rule-based workflow-friction signals (user corrections, assistant concessions, interrupts, retries) in Codex and Claude Code sessions, aggregates them into daily JSON files, and can optionally upload privacy-preserving per-event claims to a public tracker. `SPEC.md` is the authoritative design document; read it before changing behavior. There is no TypeScript, bundler, database, or build step.

## Commands

```bash
npm test                              # run all tests (node --test)
node --test test/patterns.test.js     # run a single test file
node bin/didmyaigetdumber.js <cmd>    # run the CLI from source
```

CLI commands: `hook`, `install`, `init {codex|claude|all}`, `backfill {codex|claude|all}`, `doctor`, `report [--days N]`, `start [--port N]`. See `HELP` in `src/cli.js` for full flags.

## Architecture

The hot path is the `hook` command, invoked by the agent on every lifecycle event with event JSON on stdin:

```
stdin JSON → adapter → normalized event → pattern match → increment → daily log (locked, atomic write)
```

- `src/cli.js` — arg parsing and command dispatch. All commands take an injected `io` object (`{ stdin, stdout, stderr }`) instead of touching globals directly; tests pass fakes.
- `src/hook.js` — orchestrates the pipeline above. Detects agent (`--agent`, `DIDMYAIGETDUMBER_AGENT`, or payload shape), normalizes, matches patterns only when there is a scope + text, increments, writes.
- `src/adapters/{codex,claude}.js` — map provider-specific (and deeply varied) hook payloads into a normalized event `{ agent, event_type, scope, text, flags }`. Adapters defensively probe many field names because hook payload shapes differ across agent versions.
- `src/events.js` — `incrementFromEvent` converts a normalized event into a counter delta. Counting rule: **at most one event increment per hook invocation per category** (even if multiple regex lines match); `line_hits` may exceed 1 for local debugging only.
- `src/patterns.js` — loads tiered `patterns/<locale>/<scope>-<points>.md` files, compiling each non-empty, non-comment line as one case-insensitive regex. Category = filename, locale = folder, pattern identity = `{locale}/{file}:{line}`.
- `src/log-store.js` — daily aggregate schema, directory-based busy-wait locking (`mkdir` lock with stale reclaim), and atomic temp-write + rename. The canonical home is `~/.didmyaigetdumber/` (`logs/`, `locks/`, `config.json`).
- `src/backfill*.js`, `src/init/*.js`, `src/install.js`, `src/doctor.js`, `src/report.js`, `src/server.js` — historical transcript backfill, hook installation, interactive onboarding, health checks, reporting, and the local dashboard server.

### Testability convention

Filesystem-touching functions accept an `options` object with overrides — `options.baseDir`, `options.configFile`, `options.root`, `options.locale` — so tests redirect all I/O to a temp dir instead of the real home directory. Preserve this pattern; never hardcode `os.homedir()` paths in new code paths that tests need to isolate.

## Hard invariants (do not regress)

These are enforced by `test/privacy.test.js` and the spec — violating them defeats the project's purpose:

- **Aggregate-only.** Never write raw user/assistant text, file paths, command text, source snippets, env values, or secrets to disk. The normalized event's `text` field is in-memory only. Optional raw debug capture must stay off by default.
- **Server-side `+1` only.** Public counters are derived server-side from idempotent per-event claims. Never reintroduce client-supplied aggregate totals, signed uploads, or project/session hashing unless explicitly requested.
- **Live hooks process text in memory only.** Reading historical transcripts is restricted to explicit `backfill` commands.
- **Hooks are fast, silent on success, and non-blocking.** Target <100ms; on internal failure, log and exit 0 — never block the agent.

## Pattern files (`patterns/<locale>/*.md`)

Plain text, intentionally minimal: one regex per non-empty, non-comment line. Lines whose trimmed text starts with `#` and blank lines are ignored. Do not use YAML, IDs, or per-line weights. Use `user-1pt.md`, `user-2pt.md`, `assistant-1pt.md`, and `assistant-2pt.md`. Prefer contextual phrases over single broad words (`no`, `stop`, `done`, `failed` are known-noisy). Keep regexes RE2-safe: avoid backreferences and arbitrary lookaround. **Before committing pattern changes, compile every active regex line** to catch invalid regexes (`doctor` also validates them).

## Harn workflow

This repo is developed under **Harn**. The `.harn/` directory holds `assumptions/*.yaml` (tracked design invariants) and `plans/*.yaml` (per-phase implementation plans), and the source contains `harn:assume <id> ref=<name>` … `harn:end <id>` anchors tying code regions to those assumptions. `simple-hook-telemetry-progress.md` tracks phase status.

When making any code change here, use the **harn** skill — it handles planning, editing within anchors, checking, and committing against the Harn assumption set. Do not remove or rename `harn:` anchors casually; they are load-bearing for verification.

## Repo conventions

- `AGENTS.md` holds repository guidelines (pattern-file rules, privacy, spec conventions) — keep it and `SPEC.md` in sync with behavior changes.
- One Harn plan per phase/commit; test before each commit; commit each phase before starting the next.
