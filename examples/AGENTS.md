# Agent Chat

A global chat bus is available between OpenCode sessions. It is for coordination
between agents and the human, not for general conversation.

## Check your inbox

If you are participating in a room:

```powershell
agent-chat rooms --from <your-name>
agent-chat inbox <your-name>
agent-chat read "<room>" --from <your-name>
```

`inbox` checks unread notes across every project where you participate. You do
not need `--all` for that.

## Rooms

Keep rooms small and task-specific: 2–5 participants is usually enough.

```powershell
agent-chat create "bug-123" --description "login regression" --from user --with programmer,tester
agent-chat invite "bug-123" reviewer --from programmer
```

Do not add every session to a room. Each wake is a separate model call.

## Sending

- `post` — passive note. It does not wake anyone; the recipient sees it in
  `inbox`. Use it for FYI and status updates.
- `wake` — actively starts selected agents. Use it when another agent must act
  now.
- `say` — a message from the human user. Use it only when you are asked to speak
  as the user.

```powershell
agent-chat post "bug-123" "build is green" --from tester
agent-chat wake "bug-123" "please review the branch" --from programmer --to reviewer
agent-chat say "bug-123" "ship it" --to programmer
```

`--to a,b` limits recipients. Without it, the message goes to every other
participant.

If Russian text is mangled in PowerShell, use a file:

```powershell
agent-chat say "bug-123" --text-file C:\Temp\message.txt --to tester
```

## Cross-project

An agent from another project is addressed as `name@alias`:

```powershell
agent-chat wake "release-1.2" "check the build" --from programmer --to tester@frontend
```

The message contains the room project and the sender alias, so do not confuse
directories.

## Rules

- Do not send secrets, tokens, passwords or `.env` contents. The message filter
  blocks common patterns, but it is not a guarantee.
- Use `@file:path` and `@test:name` (or `--file` / `--test`) when referring to
  code or tests.
- Do not create agent ping-pong. After two rounds, answer briefly or stop; a
  `hop` greater than 3 is blocked.
- Use one room per task. Archive it when the task is done:
  `agent-chat archive "<room>"`.
- Before deleting a room, prefer `archive`; `delete --yes` moves its history to
  `trash/`.
- Do not wake agents outside the task. Passive `post` is cheaper and less
  disruptive.

## Useful commands

```powershell
agent-chat rooms --from <your-name>
agent-chat read "<room>" --from <your-name>
agent-chat inbox <your-name>
agent-chat search "deploy" --limit 20
agent-chat channels --all --stale
agent-chat audit-secrets
```
