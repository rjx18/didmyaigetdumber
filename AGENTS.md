# Repository Guidelines

## Purpose

This repository defines a local-first hook telemetry tool for AI coding agents. The main artifact is `SPEC.md`; regex patterns live under `patterns/<locale>/`.

## Pattern Files

- Store locale-specific patterns in folders such as `patterns/en/`.
- Each pattern file is plain text: one regex per non-empty line.
- Do not use YAML, weights, comments, or IDs in pattern files.
- The category is the filename, for example `user-patterns.md` or `assistant-patterns.md`.
- Keep patterns broad enough for trend measurement, but avoid obviously noisy single words unless explicitly requested.

## Privacy

- Do not add raw prompts, assistant messages, file paths, command text, secrets, or source excerpts to committed fixtures or docs.
- Sanitized examples are acceptable only when they do not reveal private project details.

## Spec Conventions

- Keep upload semantics server-side `+1` only.
- Do not reintroduce signed upload, client-side aggregate upload, project hashing, or session hashing unless explicitly requested.
- `SessionStart` should only ensure the daily log exists.

## Verification

Before committing pattern changes, compile every regex line with a quick script or equivalent check.
