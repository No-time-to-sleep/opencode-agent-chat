import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { after, before, test } from "node:test"

const execFileAsync = promisify(execFile)
const CLI = path.resolve("src/cli.mjs")

let base
let project
let home

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), "opencode-agent-chat-"))
  project = path.join(base, "project")
  home = path.join(base, "home")
  await mkdir(project, { recursive: true })
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

async function run(args) {
  const result = await execFileAsync(process.execPath, [CLI, ...args], {
    cwd: project,
    env: { ...process.env, AGENT_CHAT_HOME: home },
    maxBuffer: 16 * 1024 * 1024,
  })
  return { stdout: result.stdout, stderr: result.stderr }
}

async function runJson(args) {
  const { stdout } = await run([...args, "--json"])
  return JSON.parse(stdout)
}

test("file-first room lifecycle, refs, search and secret filter", async () => {
  await run([
    "create",
    "smoke",
    "--description",
    "release smoke test",
    "--from",
    "user",
    "--with",
    "alice,bob",
  ])

  const rooms = await runJson(["rooms", "--from", "bob"])
  assert.equal(rooms.rooms.length, 1)
  assert.equal(rooms.rooms[0].name, "smoke")

  await run([
    "post",
    "smoke",
    "hello @file:src/app.ts @test:auth login",
    "--from",
    "alice",
    "--to",
    "bob",
  ])

  const read = await runJson(["read", "smoke", "--from", "bob"])
  const note = read.messages.find((message) => message.kind === "note")
  assert.ok(note)
  assert.equal(note.text, "hello @file:src/app.ts @test:auth login")
  assert.deepEqual(note.refs, [
    { kind: "file", value: "src/app.ts" },
    { kind: "test", value: "auth login" },
  ])

  const search = await runJson(["search", "hello"])
  assert.equal(search.count, 1)
  assert.equal(search.results[0].room.name, "smoke")
  assert.equal(search.results[0].message.id, note.id)

  await run(["archive", "smoke"])
  assert.equal((await runJson(["rooms"])).rooms.length, 0)
  assert.equal((await runJson(["rooms", "--archived"])).rooms.length, 1)

  await run(["unarchive", "smoke"])
  assert.equal((await runJson(["rooms"])).rooms.length, 1)

  await assert.rejects(
    run([
      "post",
      "smoke",
      "leaked token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "--from",
      "alice",
      "--to",
      "bob",
    ]),
    (error) => /секрет/.test(String(error.stderr || error.message)),
  )

  const afterSecret = await runJson(["read", "smoke", "--from", "bob"])
  assert.equal(afterSecret.messages.filter((message) => message.kind === "note").length, 1)

  const config = await runJson([
    "config",
    "--retention-days",
    "7",
    "--archived-retention-days",
    "14",
  ])
  assert.equal(config.retentionDays, 7)
  assert.equal(config.archivedRetentionDays, 14)

  await run(["delete", "smoke", "--yes"])
  const trash = await readdir(path.join(home, "trash"))
  assert.ok(trash.some((file) => file.endsWith(".jsonl")))
  assert.equal((await runJson(["rooms", "--all"])).rooms.length, 0)
})

test("help is discoverable from the command line", async () => {
  const global = await run(["--help"])
  assert.match(global.stdout, /Команды:/)
  assert.match(global.stdout, /agent-chat <команда> --help/)
  assert.match(global.stdout, /wake/)

  const post = await run(["post", "--help"])
  assert.match(post.stdout, /agent-chat post/)
  assert.match(post.stdout, /--reply-to/)

  const version = await run(["--version"])
  assert.match(version.stdout, /agent-chat \d+\.\d+\.\d+/)
})
