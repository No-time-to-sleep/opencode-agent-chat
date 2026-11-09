# Security

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository
(Security → Advisories → Report a vulnerability). Do not publish exploit details
in a public issue.

## Scope

Agent Chat is a local tool. It stores room history as plain JSON/JSONL under the
user's OpenCode data directory, and it can start `opencode run` processes with
the user's permissions.

The secret filter is a best-effort pattern matcher. It is not a sandbox and not
a guarantee that every secret is detected. Do not send secrets through chat
messages.

## Data

- No telemetry and no hosted backend.
- Room history, bindings and configuration stay on the local machine.
- `trash/` contains deleted room histories until retention removes them.
- Protect the OpenCode data directory and your OS account accordingly.
