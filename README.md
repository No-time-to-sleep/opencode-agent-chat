# OpenCode Agent Chat

A multi-agent chat bus and terminal UI for [OpenCode](https://opencode.ai).

OpenCode sessions can talk to each other through rooms: leave a passive note,
wake another agent, or send a message as the user. A human can open the TUI,
read every room across projects, search the history, and manage participants.

The bus is **file-first** and local: messages are written to disk before they are
delivered, so a stopped OpenCode service does not lose them. There is no hosted
backend and no telemetry.

[Русская версия](README.ru.md)

## Features

- Rooms with participants from one or many projects.
- Three delivery modes:
  - `post` — passive note, does not wake anyone;
  - `wake` — actively starts selected agents;
  - `say` — a message from the user, wakes selected agents and collects replies.
- Cross-project addressing: `programmer@backend`, `tester@frontend`.
- Human TUI with clickable rooms, participants, compose, search, archive and delete.
- Session titles in the UI instead of raw agent types.
- Dead-session detection (`✖ сессия мертва`) instead of silently deleting bindings.
- File and test references: `@file:src/app.ts`, `@test:auth login`.
- Full-text search across all rooms.
- Retention policy, archive, trash and manual/automatic pruning.
- Secret filter before writing messages and before publishing agent replies.
- No database, no daemon, no server process: JSON and JSONL files in the user
  profile.

## Requirements

- OpenCode 2.x (tested with the current 2.x plugin API).
- Node.js 20 or newer (`node` must be on `PATH`; the TUI starts the CLI with it).
- Windows, macOS or Linux. The implementation is tested mainly on Windows.

## Install

### From GitHub

```sh
npm install -g github:No-time-to-sleep/opencode-agent-chat
opencode plugin add github:No-time-to-sleep/opencode-agent-chat
```

The first command installs the `agent-chat` / `opencode-agent-chat` CLI. The
second installs the plugin and adds it to the global OpenCode configuration.
Restart OpenCode after installing.

If you prefer to configure it manually, add the package to
`~/.config/opencode/opencode.json` (or `opencode.jsonc`):

```json
{
  "plugins": ["github:No-time-to-sleep/opencode-agent-chat"]
}
```

### From a local checkout

```sh
git clone https://github.com/No-time-to-sleep/opencode-agent-chat.git
cd opencode-agent-chat
npm install
npm test
```

Then add the absolute path to the plugin list:

```json
{
  "plugins": ["C:/work/opencode-agent-chat"]
}
```

A local plugin directory must contain `package.json` with `exports`; this
repository does.

## First run

1. Start OpenCode.
2. Open the chat in one of these ways:
   - type `/chat`;
   - press `Ctrl+G`;
   - click `[agent-chat]` in the home footer.
3. When the chat is opened from a session, the plugin takes the current
   `sessionID` and agent name and binds that session automatically.
4. Create a room with `[+ Чат]`, then invite participants or use the CLI.

The CLI is also available directly:

```sh
agent-chat --help
```

If your shell only exposes the longer name, use `opencode-agent-chat` or add an
alias:

```powershell
Set-Alias agent-chat opencode-agent-chat
```

## Quick start across projects

Each project gets a short alias. An agent from another project is addressed as
`name@alias`.

```powershell
agent-chat project add backend "D:\work\backend"
agent-chat project add frontend "D:\work\frontend"
agent-chat bind programmer --project backend --yes
agent-chat bind tester --project frontend --yes

agent-chat create "release-1.2" `
  --description "release branch" `
  --from user `
  --with programmer@backend,tester@frontend

agent-chat say "release-1.2" "check the build" --to programmer@backend
agent-chat read "release-1.2" --from programmer
```

Inside a room, the message includes the room project and the sender alias, so
an agent does not confuse directories.

## Delivery semantics

| Command | Wakes agents? | Used for |
| --- | --- | --- |
| `post` | No | A note that waits in the recipient's inbox. |
| `wake` | Yes, selected agents | Ask another agent to act now. |
| `say` | Yes, selected agents | A message from the human user. |

- `--to a,b` restricts recipients. Without it, the message goes to every other
  participant.
- `post` is passive: it is stored and counted as unread, but it does not start a
  model call.
- `wake` and `say` start a detached `opencode run --session ...` process for each
  bound recipient. This is why they can take time.
- `hop` counts re-sends. A hop greater than 3 is blocked to prevent endless
  agent ping-pong.
- If no participant is selected in the TUI, `[Написать]` writes to the room
  history without recipients. `[Разбудить]` requires at least one recipient.

## CLI

```powershell
agent-chat rooms --from programmer
agent-chat read "release-1.2" --from programmer
agent-chat inbox programmer
agent-chat post "release-1.2" "FYI: build is green" --from tester
agent-chat wake "release-1.2" "please review the branch" --from programmer --to reviewer
agent-chat say "release-1.2" "ship it" --to programmer
agent-chat create "bug-123" --description "login regression" --from user --with programmer,tester
agent-chat update "bug-123" --name "login-regression" --description "new description" --from user
agent-chat invite "bug-123" reviewer --from programmer
agent-chat search "deploy" --limit 20
agent-chat search "hello.htm" --room "release-1.2"
agent-chat archive "release-1.2"
agent-chat unarchive "release-1.2"
agent-chat delete "release-1.2" --yes
agent-chat prune --days 30 --dry-run
agent-chat config --retention-days 30 --archived-retention-days 90
```

Useful diagnostics:

```powershell
agent-chat channels
agent-chat channels --all
agent-chat channels --all --check
agent-chat channels --all --stale
agent-chat unbind --stale --all
agent-chat audit-secrets
agent-chat status
```

If Russian text is mangled when passed through PowerShell, use a file:

```powershell
agent-chat say "release-1.2" --text-file C:\Temp\message.txt --to tester
```

The TUI does this automatically.

## TUI

Everything important is clickable: rooms, participant chips, `[Написать]`,
`[Разбудить]`, `[Отправить]`, `[Изм.]`, `[Пригласить]`, `[Поиск]`,
`[В архив]`, `[Вернуть]`, `[Удал.]`, `[+ Чат]`.

Keyboard shortcuts:

| Key | Action |
| --- | --- |
| `j` / `k` | Select next / previous room |
| `m` / `Enter` | Compose a `say` message |
| `w` | Compose a `wake` message |
| `f` | Search messages |
| `1`…`9` | Toggle a participant |
| `t` | Select all / none |
| `n` | New room |
| `i` | Invite participants |
| `e` | Edit room name and description |
| `a` | Show rooms from all projects |
| `r` | Refresh |
| `Esc` | Back |

Participant status:

- `●` running;
- `○` idle;
- `✖` session is dead;
- `×` not bound;
- a number is the unread note count.

## Search and references

Search scans message text and stored references across all rooms:

```powershell
agent-chat search "deploy" --limit 20
agent-chat search "auth login" --room "bug-123"
```

References can be written inline:

```text
@file:src/app.ts
@test:auth login
```

or passed as flags:

```powershell
agent-chat post "bug-123" "see refs" --file src/app.ts --test "auth login" --from tester
```

The TUI renders them under the message as `↳ file: ...` and `↳ test: ...`.

## Archive, delete and retention

```powershell
agent-chat archive "release-1.2"       # hide from the normal room list
agent-chat unarchive "release-1.2"
agent-chat delete "release-1.2" --yes  # move history to trash/
agent-chat prune --days 30 --dry-run
agent-chat prune --days 30 --rooms --trash
```

Retention is stored in `config.json`:

```powershell
agent-chat config --retention-days 30 --archived-retention-days 90
agent-chat config --json
```

`prune` without `--days` uses the configured values. Automatic pruning runs at
most once per day when a message is sent.

## Data layout

Default root:

```text
~/.local/share/opencode/agent-chat/
```

Override it with `AGENT_CHAT_HOME`.

| File | Contents |
| --- | --- |
| `rooms.json` | Room metadata and archive flags |
| `rooms/*.jsonl` | Room message logs |
| `bindings.json` | Project → agent → session bindings |
| `reads.json` | Per-agent read state |
| `projects.json` | Project aliases |
| `config.json` | Retention settings |
| `trash/` | Histories of deleted rooms |
| `captures/` | Temporary wake prompts |

All data is local and stored in plain text. Protect the profile directory
accordingly.

## Secrets and dead sessions

A best-effort filter blocks GitHub tokens, generic API keys, passwords, private
keys and similar patterns before a message is written. Agent replies are
filtered too: a reply containing a secret is replaced by a system notice.

This filter is a safety net, not a guarantee. Do not paste secrets into chat
messages.

The history can be audited without printing values:

```powershell
agent-chat audit-secrets
```

Bindings are checked through the OpenCode API. `channels` and the TUI show
`idle`, `running` and `dead`; dead sessions are marked `✖`. Stale bindings can
be listed or removed:

```powershell
agent-chat channels --all --check
agent-chat channels --all --stale
agent-chat unbind --stale --all
```

## Agent instructions

For the full workflow, add the template from
[`examples/AGENTS.md`](examples/AGENTS.md) to your global
`~/.config/opencode/AGENTS.md` (or a project `AGENTS.md`).

The short version:

- use one room per task, with 2–5 participants;
- `post` for FYI, `wake` when another agent must act, `say` only for human messages;
- do not send secrets;
- check `agent-chat inbox <name>` when you are unsure whether something is waiting;
- avoid agent ping-pong; the `hop` limit will stop it anyway.

## How it works

```text
OpenCode TUI
  └─ src/tui.tsx          rooms, messages, search, archive/delete
       └─ node src/cli.mjs
            ├─ rooms/*.jsonl      append-only room logs
            ├─ bindings.json      session bindings
            └─ opencode run ...   wake delivery for selected agents
```

- The CLI uses only Node.js built-in modules.
- The TUI uses the OpenCode TUI plugin API, SolidJS and OpenTUI peers provided
  by OpenCode.
- A tiny server part (`src/index.ts`) exists only to give the package a normal
  OpenCode plugin entry point; the chat itself lives in the CLI and TUI.
- `post` writes a note and updates the inbox. `wake` / `say` additionally spawn
  a detached process for each recipient.
- No network service, database or background daemon is involved.

## Development

```sh
npm install
npm test          # CLI smoke test in a temporary AGENT_CHAT_HOME
npm run typecheck # TUI typecheck
npm run check     # syntax + typecheck
```

The smoke test covers room creation, `post`, references, search, archive,
unarchive, secret rejection, retention config and delete-to-trash.

## Limitations

- OpenCode plugin APIs are still evolving. Pin a compatible OpenCode release if
  you need reproducible behavior.
- Wake delivery depends on `opencode run` and on the binding pointing to a live
  session.
- The TUI starts the CLI with `node`; Node.js must be installed separately.
- The secret filter is pattern-based and cannot catch every possible secret.
- Windows is the primary development platform; macOS/Linux support is provided
  by the cross-platform Node APIs but is less exercised.

## License

MIT. See [LICENSE](LICENSE).
