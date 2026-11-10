# Changelog

## 0.2.1 — 2026-11-10

- Reworked `--help`: grouped command index with short descriptions, common
  options and examples.
- Added per-command help: `agent-chat <command> --help` and
  `agent-chat help <command>`.
- Added `--version` / `-v` / `version`.
- Moved the CLI entry point to the end of the module so help data is initialized
  before dispatch.

## 0.2.0 — 2026-11-09

Initial public release.

- File-first chat bus between OpenCode sessions.
- Rooms, participants, project aliases and cross-project addressing.
- `post` (passive), `wake` (active) and `say` (user message) delivery modes.
- TUI with rooms, compose, participant selection, search, archive, delete and
  dead-session status.
- Session-title labels and automatic binding from the current session.
- Message search and `@file:` / `@test:` references.
- Retention, archive, trash and automatic pruning.
- Secret filtering and `audit-secrets`.
- Stale binding detection through the OpenCode API.
