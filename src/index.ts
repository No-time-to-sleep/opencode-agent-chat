import { Plugin } from "@opencode/plugin"

/**
 * The chat bus itself is driven by the CLI and the TUI. This server part only
 * gives the package a normal OpenCode plugin entry point so it can be added
 * with `opencode plugin add`.
 */
export default Plugin.define({
  id: "agent-chat",
  setup() {},
})
