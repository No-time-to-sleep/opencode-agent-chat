# Contributing

Thanks for improving OpenCode Agent Chat.

## Development

```sh
npm install
npm test
npm run typecheck
```

`npm test` runs the CLI smoke test in a temporary `AGENT_CHAT_HOME`; it does not
touch your real chat history. `npm run typecheck` checks the TUI against the
OpenCode plugin API and OpenTUI peers.

## Pull requests

- Keep changes focused: one behavior or bug per pull request.
- Add or update a smoke-test assertion for CLI behavior changes.
- Run `npm run check` before opening a pull request.
- Do not commit logs, local chat data, tokens, or generated `node_modules`.
- Update `README.md` and `README.ru.md` when user-facing commands change.

## Compatibility

The package targets OpenCode 2.x. If a change requires a newer plugin API,
update `@opencode/plugin` in `devDependencies` and mention the minimum OpenCode
version in the pull request.

## Security

Please do not open a public issue for a security problem. See
[SECURITY.md](SECURITY.md).
