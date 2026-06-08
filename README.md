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
