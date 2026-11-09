#!/usr/bin/env node
/**
 * agent-chat — a small message bus between OpenCode agent sessions.
 *
 * The bus is deliberately file-first: every message is written to a room log
 * before it is delivered. If the OpenCode service is down, the message is not
 * lost; it stays in the log with delivered/failed marks.
 *
 * Room state lives outside the project:
 *   %USERPROFILE%\.local\share\opencode\agent-chat\
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const VERSION = "0.2.0";
const HOME = os.homedir();
const ROOT =
  process.env.AGENT_CHAT_HOME ||
  path.join(HOME, ".local", "share", "opencode", "agent-chat");
const ROOMS_FILE = path.join(ROOT, "rooms.json");
const BINDINGS_FILE = path.join(ROOT, "bindings.json");
const READS_FILE = path.join(ROOT, "reads.json");
const PROJECTS_FILE = path.join(ROOT, "projects.json");
const CONFIG_FILE = path.join(ROOT, "config.json");
const ROOMS_DIR = path.join(ROOT, "rooms");
const CAPTURES_DIR = path.join(ROOT, "captures");
const TRASH_DIR = path.join(ROOT, "trash");

const SELF = fileURLToPath(import.meta.url);
const MAX_TEXT = 32 * 1024;
const MAX_HOPS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const BINDING_CHECK_MS = 60 * 1000;

const DEFAULT_CONFIG = {
  retentionDays: 30,
  archivedRetentionDays: 90,
};

const argv = process.argv.slice(2);
const cmd = argv.shift() || "help";
const opts = parseOpts(argv);

main().catch((error) => {
  console.error(`agent-chat: ${error.message || error}`);
  process.exit(1);
});

async function main() {
  await ensureDirs();

  switch (cmd) {
    case "help":
    case "--help":
    case "-h":
      return help();
    case "rooms":
      return cmdRooms();
    case "create":
      return cmdCreate();
    case "invite":
      return cmdInvite();
    case "update":
      return cmdUpdate();
    case "archive":
      return cmdArchive(true);
    case "unarchive":
      return cmdArchive(false);
    case "delete":
      return cmdDelete();
    case "prune":
      return cmdPrune();
    case "search":
      return cmdSearch();
    case "audit-secrets":
      return cmdAuditSecrets();
    case "config":
      return cmdConfig();
    case "post":
      return cmdPost(false);
    case "wake":
      return cmdPost(true);
    case "say":
      return cmdSay();
    case "read":
      return cmdRead();
    case "inbox":
      return cmdInbox();
    case "messages":
      return cmdMessages();
    case "snapshot":
      return cmdSnapshot();
    case "bind":
      return cmdBind();
    case "unbind":
      return cmdUnbind();
    case "channels":
      return cmdChannels();
    case "sessions":
      return cmdSessions();
    case "projects":
      return cmdProjects();
    case "project":
      return cmdProject();
    case "status":
      return cmdStatus();
    case "init":
      return cmdInit();
    case "wake-one":
      return cmdWakeOne();
    default:
      throw new Error(`unknown command "${cmd}". Run: agent-chat help`);
  }
}

/* ------------------------------------------------------------------ */
/* CLI parsing                                                        */
/* ------------------------------------------------------------------ */

function parseOpts(input) {
  const out = { _: [] };
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (item === "--") {
      out._.push(...input.slice(i + 1));
      break;
    }
    if (item.startsWith("--")) {
      const eq = item.indexOf("=");
      if (eq !== -1) {
        out[item.slice(2, eq)] = item.slice(eq + 1);
      } else {
        const key = item.slice(2);
        const next = input[i + 1];
        if (next === undefined || next.startsWith("--")) {
          out[key] = true;
        } else {
          out[key] = next;
          i++;
        }
      }
    } else {
      out._.push(item);
    }
  }
  return out;
}

function help() {
  console.log(`agent-chat ${VERSION} — мини-мессенджер между агентами OpenCode

Комнаты:
  agent-chat rooms [--from <агент>] [--all] [--archived | --include-archived] [--json]
  agent-chat create "<название>" [--description "текст"] [--with a,b] [--from <агент>]
  agent-chat update "<комната>" [--name "новое"] [--description "текст"] [--from <агент>]
  agent-chat invite "<комната>" <агент...> [--from <агент>]
  agent-chat archive "<комната>" | unarchive "<комната>" [--from <агент>]
  agent-chat delete "<комната>" --yes              # история уходит в trash/
  agent-chat prune [--days N] [--rooms] [--trash] [--dry-run]
  agent-chat search "<текст>" [--room <комната>] [--from <агент>] [--limit 30] [--include-archived] [--current]

Сообщения:
  agent-chat post "<комната>" "<текст>" --from <агент> [--reply-to <id>] [--file path] [--test name]
  agent-chat wake "<комната>" "<текст>" --from <агент> [--to a,b] [--timeout 300] [--force]
  agent-chat say  "<комната>" "<текст>" [--to a,b | --room-only] [--timeout 300] [--file path] [--test name]
  agent-chat read "<комната>" [--from <агент>] [--json]
  agent-chat inbox <агент> [--all] [--json]          # непрочитанные заметки
  agent-chat messages "<комната>" [-n 50] [--json]

Сессии и проекты:
  agent-chat bind <агент> [--session ses_...] [--yes] [--project <alias|dir>]
  agent-chat unbind <агент> [--project <alias|dir>] | unbind --stale [--all]
  agent-chat channels [--all] [--check] [--stale]
  agent-chat sessions [--project <alias|dir>] [--agent <тип>] [--limit 30]
  agent-chat projects
  agent-chat project add <alias> "<dir>"
  agent-chat config [--retention-days N] [--archived-retention-days N]
  agent-chat audit-secrets
  agent-chat status
  agent-chat snapshot [--all] [--include-archived] [--json]

Кросс-проект:
  агент адресуется как <агент>@<alias>, например programmer@opencode.
  agent-chat say "<комната>" "..." --to programmer@opencode
  agent-chat invite "<комната>" tester@backend

Правила:
  - post — пассивное уведомление, не будит и не требует ответа;
  - wake — будит указанных агентов и запускает их;
  - say — сообщение от пользователя, будит участников и собирает ответы;
  - hop > ${MAX_HOPS} блокируется, чтобы агенты не переписывались бесконечно;
  - archive скрывает комнату, delete переносит историю в trash/;
  - секреты в сообщениях блокируются фильтром (ключи, токены, пароли);
  - ссылки: @file:путь и @test:название, либо --file / --test.

Данные: ${ROOT}`);
}

/* ------------------------------------------------------------------ */
/* Files                                                              */
/* ------------------------------------------------------------------ */

async function ensureDirs() {
  await fsp.mkdir(ROOMS_DIR, { recursive: true });
  await fsp.mkdir(CAPTURES_DIR, { recursive: true });
  await fsp.mkdir(TRASH_DIR, { recursive: true });
}

function now() {
  return Date.now();
}

function uid(prefix) {
  return (
    prefix +
    Date.now().toString(36) +
    randomBytes(4).toString("hex")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normProject(dir) {
  return path.resolve(dir).replace(/\\/g, "/").toLowerCase();
}

function currentProject() {
  const ref = opts.project;
  if (!ref) return path.resolve(process.cwd());
  if (fs.existsSync(ref)) return path.resolve(ref);
  try {
    const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf8"));
    const key = Object.keys(projects).find(
      (alias) => alias.toLowerCase() === String(ref).toLowerCase(),
    );
    if (key) return projects[key];
  } catch {
    // Fall back to a path.
  }
  return path.resolve(ref);
}

function aliasForPath(dir) {
  const resolved = path.resolve(dir);
  const base = path.basename(resolved);
  if (!base || !/[a-z0-9]/i.test(base)) return "home";
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

async function loadProjects() {
  return readJson(PROJECTS_FILE, {});
}

async function saveProjects(projects) {
  await writeJson(PROJECTS_FILE, projects);
}

async function loadConfig() {
  return { ...DEFAULT_CONFIG, ...(await readJson(CONFIG_FILE, {})) };
}

async function saveConfig(config) {
  await writeJson(CONFIG_FILE, config);
}

async function ensureProject(dir) {
  const resolved = path.resolve(dir);
  const projects = await loadProjects();
  for (const [alias, value] of Object.entries(projects)) {
    if (normProject(value) === normProject(resolved)) return alias;
  }
  const base = aliasForPath(resolved);
  let alias = base;
  let index = 2;
  while (projects[alias]) alias = `${base}-${index++}`;
  projects[alias] = resolved;
  await saveProjects(projects);
  return alias;
}

async function resolveProjectRef(ref) {
  if (!ref) throw new Error("project is required");
  if (fs.existsSync(ref)) {
    const project = path.resolve(ref);
    return { project, alias: await ensureProject(project) };
  }
  const projects = await loadProjects();
  const key = Object.keys(projects).find(
    (alias) => alias.toLowerCase() === String(ref).toLowerCase(),
  );
  if (key) return { project: projects[key], alias: key };
  throw new Error(
    `unknown project "${ref}". Known: ${Object.keys(projects).join(", ") || "—"}`,
  );
}

function aliasOf(projects, dir) {
  const found = Object.entries(projects).find(
    ([, value]) => normProject(value) === normProject(dir),
  );
  return found?.[0] || aliasForPath(dir);
}

function splitParticipant(value, roomProject) {
  const at = String(value).lastIndexOf("@");
  if (at <= 0) {
    return {
      id: String(value),
      name: String(value),
      projectRef: null,
      alias: null,
      project: roomProject,
      qualified: false,
    };
  }
  return {
    id: String(value),
    name: String(value).slice(0, at),
    projectRef: String(value).slice(at + 1),
    alias: String(value).slice(at + 1),
    project: null,
    qualified: true,
  };
}

async function resolveParticipant(value, roomProject) {
  const parts = splitParticipant(value, roomProject);
  if (!parts.projectRef) {
    return {
      ...parts,
      project: roomProject,
      alias: await ensureProject(roomProject),
    };
  }
  const resolved = await resolveProjectRef(parts.projectRef);
  return { ...parts, project: resolved.project, alias: resolved.alias };
}

async function normalizeParticipant(value, roomProject) {
  const info = await resolveParticipant(value, roomProject);
  validateAgent(info.name);
  if (info.alias && normProject(info.project) !== normProject(roomProject)) {
    return `${info.name}@${info.alias}`;
  }
  return info.name;
}

async function readJson(file, fallback) {
  try {
    const text = await fsp.readFile(file, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await withLock(file, async () => {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await fsp.rename(tmp, file);
  });
}

async function withLock(file, fn) {
  const lock = `${file}.lock`;
  await fsp.mkdir(path.dirname(lock), { recursive: true });
  let handle;
  for (let i = 0; i < 120; i++) {
    try {
      handle = await fsp.open(lock, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await sleep(25);
    }
  }
  if (!handle) throw new Error(`lock timeout: ${lock}`);
  try {
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await fsp.rm(lock, { force: true }).catch(() => {});
  }
}

async function loadRooms() {
  return readJson(ROOMS_FILE, []);
}

async function saveRooms(rooms) {
  await writeJson(ROOMS_FILE, rooms);
}

async function loadBindings() {
  return readJson(BINDINGS_FILE, {});
}

async function saveBindings(bindings) {
  await writeJson(BINDINGS_FILE, bindings);
}

async function loadReads() {
  return readJson(READS_FILE, {});
}

async function saveReads(reads) {
  await writeJson(READS_FILE, reads);
}

async function readMessages(roomID) {
  const file = roomFile(roomID);
  try {
    const text = await fsp.readFile(file, "utf8");
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // Skip a torn line, keep the rest.
      }
    }
    return out;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function appendMessage(roomID, message) {
  await fsp.mkdir(ROOMS_DIR, { recursive: true });
  await fsp.appendFile(roomFile(roomID), `${JSON.stringify(message)}\n`, "utf8");
}

async function appendSystemMessage(roomID, text, replyTo = null, hop = 0) {
  await appendMessage(roomID, {
    id: uid("chat_"),
    roomID,
    ts: now(),
    from: "system",
    kind: "system",
    text,
    replyTo,
    hop,
    delivered: [],
    failed: [],
  });
}

async function writeMessages(roomID, messages) {
  const file = roomFile(roomID);
  await withLock(file, async () => {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const text = messages.length
      ? `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`
      : "";
    await fsp.writeFile(tmp, text, "utf8");
    await fsp.rename(tmp, file);
  });
}

function roomFile(roomID) {
  return path.join(ROOMS_DIR, `${roomID}.jsonl`);
}

function truncate(value, limit = 4000) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n… (обрезано)`;
}

/* ------------------------------------------------------------------ */
/* OpenCode API                                                       */
/* ------------------------------------------------------------------ */

let cachedOpencode = null;

function opencodeExe() {
  if (cachedOpencode) return cachedOpencode;
  if (process.env.OPENCODE_BIN) {
    cachedOpencode = process.env.OPENCODE_BIN;
    return cachedOpencode;
  }
  try {
    const finder = process.platform === "win32" ? "where.exe" : "which";
    const out = execFileSync(finder, ["opencode"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const candidates = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const candidate of candidates) {
      const lower = candidate.toLowerCase();
      if (lower.endsWith(".exe") && fs.existsSync(candidate)) {
        cachedOpencode = candidate;
        return cachedOpencode;
      }
      if (lower.endsWith(".cmd")) {
        const exe = path.join(
          path.dirname(candidate),
          "node_modules",
          "@opencode",
          "cli",
          "bin",
          "opencode.exe",
        );
        if (fs.existsSync(exe)) {
          cachedOpencode = exe;
          return cachedOpencode;
        }
      }
      if (process.platform !== "win32" && fs.existsSync(candidate)) {
        cachedOpencode = candidate;
        return cachedOpencode;
      }
    }
  } catch {
    // Fall through to PATH lookup.
  }
  cachedOpencode = "opencode";
  return cachedOpencode;
}

function oc(args) {
  try {
    return execFileSync(opencodeExe(), ["api", ...args], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    const detail = (error.stderr || error.stdout || "").toString().trim();
    throw new Error(
      `opencode api ${args[0]} failed${detail ? `: ${detail}` : `: ${error.message}`}`,
    );
  }
}

function ocJson(args) {
  const text = oc(args).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sessionProbe(sessionID) {
  try {
    const result = ocJson([
      "session.get",
      "--param",
      `sessionID=${sessionID}`,
    ]);
    return { ok: true, session: result?.data || null };
  } catch (error) {
    const detail = error.message || String(error);
    if (/\b404\b|not found/i.test(detail)) {
      return { ok: true, session: null };
    }
    return { ok: false, error: detail };
  }
}

function sessionGet(sessionID) {
  const probe = sessionProbe(sessionID);
  return probe.ok ? probe.session : null;
}

async function checkBindings(force = false) {
  const bindings = await loadBindings();
  const checked = [];
  let changed = false;

  for (const [projectKey, channels] of Object.entries(bindings)) {
    for (const [channel, binding] of Object.entries(channels || {})) {
      if (!binding?.sessionID) continue;
      const age = now() - Number(binding.checkedAt || 0);
      if (!force && binding.checkedAt && age < BINDING_CHECK_MS) {
        checked.push({ projectKey, channel, binding });
        continue;
      }

      const probe = sessionProbe(binding.sessionID);
      binding.checkedAt = now();
      changed = true;
      if (!probe.ok) {
        binding.checkError = probe.error;
        checked.push({ projectKey, channel, binding, error: probe.error });
        continue;
      }
      delete binding.checkError;
      binding.alive = Boolean(probe.session);
      if (probe.session?.title && probe.session.title !== binding.title) {
        binding.title = probe.session.title;
      }
      checked.push({ projectKey, channel, binding });
    }
  }

  if (changed) await saveBindings(bindings);
  return checked;
}

function sessionList(project) {
  const result = ocJson([
    "session.list",
    "--param",
    `directory=${project}`,
    "--param",
    "parentID=null",
    "--param",
    "limit=100",
    "--param",
    "order=desc",
  ]);
  return Array.isArray(result?.data) ? result.data : [];
}

function sessionActive() {
  try {
    const result = ocJson(["session.active"]);
    return result?.data || {};
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* Rooms                                                              */
/* ------------------------------------------------------------------ */

function findRoom(rooms, reference, project, options = {}) {
  if (!reference) throw new Error("room name is required");
  const includeArchived = Boolean(options.includeArchived);
  const available = includeArchived
    ? rooms
    : rooms.filter((room) => !room.archivedAt);
  const archived = rooms.filter((room) => room.archivedAt);

  if (String(reference).startsWith("room_")) {
    const byID = available.find((room) => room.id === reference);
    if (byID) return byID;
    const archivedByID = archived.find((room) => room.id === reference);
    if (archivedByID) {
      throw new Error(
        `room "${archivedByID.name}" is archived; unarchive it first: agent-chat unarchive "${archivedByID.name}"`,
      );
    }
  }
  const all = available.filter(
    (room) => room.name.toLowerCase() === String(reference).toLowerCase(),
  );
  const matches = project
    ? all.filter((room) => normProject(room.project) === normProject(project))
    : all;
  if (matches.length === 1) return matches[0];
  if (matches.length === 0 && all.length === 1) return all[0];
  if (matches.length === 0) {
    const archivedMatch = archived.find(
      (room) => room.name.toLowerCase() === String(reference).toLowerCase(),
    );
    if (archivedMatch) {
      throw new Error(
        `room "${archivedMatch.name}" is archived; unarchive it first: agent-chat unarchive "${archivedMatch.name}"`,
      );
    }
    throw new Error(
      `room "${reference}" not found in ${project}${
        all.length ? ` (but exists in ${all.map((room) => room.project).join(", ")})` : ""
      }`,
    );
  }
  throw new Error(
    `room "${reference}" is ambiguous; use the room id: ${matches
      .map((room) => `${room.id} (${room.project})`)
      .join(", ")}`,
  );
}

function lastMessage(messages) {
  return messages.length ? messages[messages.length - 1] : null;
}

function unreadFor(messages, reads, roomID, reader) {
  if (!messages.length) return 0;
  const lastRead = reads[roomID]?.[reader];
  const index = lastRead ? messages.findIndex((message) => message.id === lastRead) : -1;
  return messages
    .slice(index + 1)
    .filter((message) => message.from !== reader && message.kind !== "system").length;
}

function roomView(
  room,
  messages,
  reads,
  bindings,
  active,
  projects,
  reader = "user",
) {
  const last =
    [...messages].reverse().find((message) => message.kind !== "system") ||
    null;
  return {
    ...room,
    projectAlias: aliasOf(projects, room.project),
    last,
    unread: unreadFor(messages, reads, room.id, reader),
    participantsDetail: room.participants.map((id) => {
      const parts = splitParticipant(id, room.project);
      const project = parts.projectRef
        ? projects[parts.alias] || room.project
        : room.project;
      const alias = parts.alias || aliasOf(projects, project);
      const binding = (bindings[normProject(project)] || {})[parts.name];
      const title = binding?.title?.trim() || parts.name;
      const label =
        parts.projectRef && normProject(project) !== normProject(room.project)
          ? `${title}@${alias}`
          : title;
      const bound = Boolean(binding?.sessionID);
      const running = bound ? Boolean(active[binding.sessionID]) : false;
      const dead = bound && binding?.alive === false;
      return {
        id,
        name: parts.name,
        title,
        agent: binding?.agent || null,
        channel: parts.projectRef
          ? `${parts.name}@${alias}`
          : parts.name,
        label,
        project,
        alias,
        bound,
        sessionID: binding?.sessionID || null,
        active: running,
        alive: binding?.alive !== false,
        dead,
        status: !bound
          ? "unbound"
          : running
            ? "running"
            : dead
              ? "dead"
              : "idle",
        unread: unreadFor(messages, reads, room.id, id),
      };
    }),
  };
}

function formatMessage(message) {
  const time = new Date(message.ts).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const reply = message.replyTo ? ` ↩ ${message.replyTo}` : "";
  const refs = (message.refs || [])
    .map((ref) => `\n  ↳ ${ref.kind}: ${ref.value}`)
    .join("");
  return `[${time}] ${message.from}${reply}: ${truncate(message.text, 4000)}${refs}`;
}

function participantMatches(room, id, ref, project, projects) {
  const refParts = splitParticipant(ref, project);
  const parts = splitParticipant(id, room.project);
  if (parts.name !== refParts.name) return false;

  const participantProject = parts.projectRef
    ? projects[parts.alias] || room.project
    : room.project;

  if (refParts.projectRef) {
    const refProject = projects[refParts.alias];
    return refProject
      ? normProject(participantProject) === normProject(refProject)
      : id === ref;
  }
  return normProject(participantProject) === normProject(project);
}

function resolveRoomParticipant(room, ref, project, projects) {
  const matches = room.participants.filter((id) =>
    participantMatches(room, id, ref, project, projects),
  );
  if (String(ref).includes("@") && matches.includes(ref)) return ref;
  return matches[0] || null;
}

async function cmdRooms() {
  const project = currentProject();
  const all = Boolean(opts.all);
  const from = opts.from;
  const archivedOnly = Boolean(opts.archived);
  const includeArchived = Boolean(opts["include-archived"]);
  const [rooms, reads, bindings, active, projects] = await Promise.all([
    loadRooms(),
    loadReads(),
    loadBindings(),
    Promise.resolve(sessionActive()),
    loadProjects(),
  ]);
  await ensureProject(project);

  const visible = rooms
    .filter((room) => {
      if (archivedOnly && !room.archivedAt) return false;
      if (!archivedOnly && !includeArchived && room.archivedAt) return false;
      if (from === "user") return true;
      if (from) {
        return room.participants.some((id) =>
          participantMatches(room, id, from, project, projects),
        );
      }
      return all || normProject(room.project) === normProject(project);
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const views = [];
  for (const room of visible) {
    const messages = await readMessages(room.id);
    const reader =
      from && from !== "user"
        ? resolveRoomParticipant(room, from, project, projects) || "user"
        : "user";
    views.push(
      roomView(room, messages, reads, bindings, active, projects, reader),
    );
  }

  if (opts.json) {
    console.log(JSON.stringify({ project, all, rooms: views }, null, 2));
    return;
  }

  if (!views.length) {
    console.log(
      archivedOnly
        ? "Архивных комнат нет."
        : "Комнат пока нет. Создай: agent-chat create \"general\" --from <агент>",
    );
    return;
  }

  for (const room of views) {
    const last = room.last
      ? `${room.last.from}: ${oneLine(room.last.text, 60)}`
      : "пусто";
    const unread = room.unread ? ` ●${room.unread}` : "";
    const archived = room.archivedAt ? " [архив]" : "";
    console.log(
      `${room.name}${unread}  [${room.projectAlias}]${archived}\n  id: ${room.id}\n  участники: ${room.participants.join(", ") || "—"}\n  последнее: ${last}`,
    );
  }
}

function oneLine(value, limit) {
  const line = String(value).replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

async function cmdCreate() {
  const name = opts._[0];
  if (!name) throw new Error('usage: agent-chat create "<название>"');
  let project = process.cwd();
  if (opts.project) {
    project = fs.existsSync(opts.project)
      ? path.resolve(opts.project)
      : (await resolveProjectRef(opts.project)).project;
  }
  const projectKey = normProject(project);
  const projectAlias = await ensureProject(project);

  let from = opts.from || "user";
  if (from !== "user") {
    if (!from.includes("@") && normProject(project) !== normProject(process.cwd())) {
      from = `${from}@${await ensureProject(process.cwd())}`;
    }
    const info = await resolveParticipant(from, project);
    validateAgent(info.name);
    from =
      info.alias && normProject(info.project) !== normProject(project)
        ? `${info.name}@${info.alias}`
        : info.name;
  }

  const rooms = await loadRooms();
  if (
    rooms.some(
      (room) =>
        normProject(room.project) === projectKey &&
        room.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new Error(`room "${name}" already exists in ${project}`);
  }

  const bindings = await loadBindings();
  let participants = [];
  if (opts.with) {
    participants = String(opts.with)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  } else {
    participants = Object.keys(bindings[projectKey] || {});
  }
  participants = [...new Set(participants.map((value) => value.trim()).filter(Boolean))];
  participants = await Promise.all(
    participants.map((value) => normalizeParticipant(value, project)),
  );
  if (from !== "user" && !participants.includes(from)) participants.unshift(from);

  const room = {
    id: uid("room_"),
    name,
    description: opts.description ? String(opts.description) : "",
    project,
    participants,
    createdBy: from,
    createdAt: now(),
    updatedAt: now(),
  };
  rooms.push(room);
  await saveRooms(rooms);
  await appendMessage(room.id, {
    id: uid("chat_"),
    roomID: room.id,
    ts: now(),
    from: "system",
    kind: "system",
    text: `room "${name}" created by ${from}`,
    replyTo: null,
    hop: 0,
    delivered: [],
    failed: [],
  });

  if (opts.json) {
    console.log(JSON.stringify({ room: { ...room, projectAlias } }, null, 2));
  } else {
    console.log(`Создана комната "${name}" (${room.id}) [${projectAlias}]`);
    console.log(`Участники: ${participants.join(", ") || "—"}`);
  }
}

async function cmdInvite() {
  const reference = opts._[0];
  const names = opts._.slice(1);
  if (!reference || !names.length) {
    throw new Error('usage: agent-chat invite "<комната>" <агент...>');
  }
  const project = currentProject();
  const rooms = await loadRooms();
  const room = findRoom(rooms, reference, project);

  let from = opts.from || "user";
  if (from !== "user") {
    if (
      !from.includes("@") &&
      normProject(room.project) !== normProject(process.cwd())
    ) {
      from = `${from}@${await ensureProject(process.cwd())}`;
    }
    const info = await resolveParticipant(from, room.project);
    validateAgent(info.name);
    from =
      info.qualified && normProject(info.project) !== normProject(room.project)
        ? `${info.name}@${info.alias}`
        : info.name;
  }

  const ids = [];
  for (const name of names) {
    ids.push(await normalizeParticipant(name, room.project));
  }
  for (const id of ids) {
    if (!room.participants.includes(id)) room.participants.push(id);
  }
  room.updatedAt = now();
  await saveRooms(rooms);
  await appendMessage(room.id, {
    id: uid("chat_"),
    roomID: room.id,
    ts: now(),
    from: "system",
    kind: "system",
    text: `${from} invited ${ids.join(", ")}`,
    replyTo: null,
    hop: 0,
    delivered: [],
    failed: [],
  });

  console.log(`В комнату "${room.name}" добавлены: ${ids.join(", ")}`);
}

async function cmdUpdate() {
  const reference = opts._[0];
  if (!reference) {
    throw new Error(
      'usage: agent-chat update "<комната>" [--name "..."] [--description "..."]',
    );
  }
  const project = currentProject();
  const rooms = await loadRooms();
  const room = findRoom(rooms, reference, project);
  let from = opts.from || "user";
  if (from !== "user") {
    const info = await resolveParticipant(from, room.project);
    validateAgent(info.name);
    from = info.qualified ? `${info.name}@${info.alias}` : info.name;
  }

  if (opts.name !== undefined) {
    const name = String(opts.name).trim();
    if (!name) throw new Error("room name is empty");
    const duplicate = rooms.some(
      (item) =>
        item.id !== room.id &&
        normProject(item.project) === normProject(room.project) &&
        item.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      throw new Error(`room "${name}" already exists in ${room.project}`);
    }
    room.name = name;
  }
  if (opts.description !== undefined) {
    room.description = String(opts.description);
  }
  room.updatedAt = now();
  await saveRooms(rooms);
  await appendMessage(room.id, {
    id: uid("chat_"),
    roomID: room.id,
    ts: now(),
    from: "system",
    kind: "system",
    text: `room updated by ${from}`,
    replyTo: null,
    hop: 0,
    delivered: [],
    failed: [],
  });

  if (opts.json) {
    console.log(JSON.stringify({ room }, null, 2));
  } else {
    console.log(`Обновлена комната "${room.name}" (${room.id})`);
    if (room.description) console.log(`Описание: ${room.description}`);
  }
}

async function normalizeActor(value, roomProject) {
  let from = value || "user";
  if (from === "user") return from;
  if (!from.includes("@") && normProject(roomProject) !== normProject(process.cwd())) {
    from = `${from}@${await ensureProject(process.cwd())}`;
  }
  const info = await resolveParticipant(from, roomProject);
  validateAgent(info.name);
  return info.qualified && normProject(info.project) !== normProject(roomProject)
    ? `${info.name}@${info.alias}`
    : info.name;
}

async function cmdArchive(archived) {
  const reference = opts._[0];
  if (!reference) {
    throw new Error(
      `usage: agent-chat ${archived ? "archive" : "unarchive"} "<комната>"`,
    );
  }
  const project = currentProject();
  const rooms = await loadRooms();
  const room = findRoom(rooms, reference, project, { includeArchived: true });
  const from = await normalizeActor(opts.from, room.project);
  const isArchived = Boolean(room.archivedAt);

  if (archived === isArchived) {
    console.log(
      `Комната "${room.name}" уже ${archived ? "в архиве" : "не в архиве"}.`,
    );
    return;
  }
  if (archived) room.archivedAt = now();
  else delete room.archivedAt;
  room.updatedAt = now();
  await saveRooms(rooms);
  await appendSystemMessage(
    room.id,
    `${from} ${archived ? "archived" : "unarchived"} room`,
  );

  if (opts.json) {
    console.log(JSON.stringify({ room }, null, 2));
    return;
  }
  console.log(
    `${archived ? "В архиве" : "Возвращена из архива"}: "${room.name}" (${room.id})`,
  );
}

async function moveRoomToTrash(room) {
  await fsp.mkdir(TRASH_DIR, { recursive: true });
  const source = roomFile(room.id);
  const target = path.join(TRASH_DIR, `${room.id}-${now()}.jsonl`);
  try {
    await fsp.rename(source, target);
    return target;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function cmdDelete() {
  const reference = opts._[0];
  if (!reference) throw new Error('usage: agent-chat delete "<комната>" --yes');
  if (!opts.yes) {
    throw new Error(
      `удаление необратимо (история уйдёт в ${TRASH_DIR}); подтверди: --yes`,
    );
  }
  const project = currentProject();
  const rooms = await loadRooms();
  const room = findRoom(rooms, reference, project, { includeArchived: true });
  const target = await moveRoomToTrash(room);
  await saveRooms(rooms.filter((item) => item.id !== room.id));
  const reads = await loadReads();
  delete reads[room.id];
  await saveReads(reads);

  if (opts.json) {
    console.log(JSON.stringify({ room, trash: target }, null, 2));
    return;
  }
  console.log(`Удалена комната "${room.name}" (${room.id})`);
  console.log(target ? `История: ${target}` : "Истории не было.");
}

async function pruneMessages(days, { dryRun = false } = {}) {
  const cutoff = now() - days * DAY_MS;
  const rooms = await loadRooms();
  const reads = await loadReads();
  const details = [];
  let removed = 0;

  for (const room of rooms) {
    const messages = await readMessages(room.id);
    if (!messages.length) continue;
    const kept = messages.filter((message) => Number(message.ts || 0) >= cutoff);
    const count = messages.length - kept.length;
    if (!count) continue;
    details.push({
      room: room.name,
      roomID: room.id,
      removed: count,
      kept: kept.length,
    });
    removed += count;
    if (dryRun) continue;

    await writeMessages(room.id, kept);
    const keptIDs = new Set(kept.map((message) => message.id));
    const pointers = reads[room.id] || {};
    for (const reader of Object.keys(pointers)) {
      if (!keptIDs.has(pointers[reader])) {
        if (kept.length) pointers[reader] = kept[kept.length - 1].id;
        else delete pointers[reader];
      }
    }
    if (!Object.keys(pointers).length) delete reads[room.id];
  }
  if (!dryRun) await saveReads(reads);
  return { removed, details };
}

async function maybeAutoPrune() {
  try {
    const config = await loadConfig();
    if (!config.retentionDays) return;
    if (
      config.lastPruneAt &&
      now() - Number(config.lastPruneAt) < DAY_MS
    ) {
      return;
    }
    await pruneMessages(Number(config.retentionDays));
    config.lastPruneAt = now();
    await saveConfig(config);
  } catch {
    // Retention must never block sending a message.
  }
}

async function cmdPrune() {
  const config = await loadConfig();
  const dryRun = Boolean(opts["dry-run"]);
  const days =
    opts.days !== undefined ? Number(opts.days) : Number(config.retentionDays);
  const archivedDays =
    opts["archived-days"] !== undefined
      ? Number(opts["archived-days"])
      : Number(config.archivedRetentionDays);

  if (!opts.rooms && !opts.trash && (!days || days <= 0)) {
    throw new Error(
      "retention выключен. Укажи --days N или включи: agent-chat config --retention-days 30",
    );
  }
  if (opts.days !== undefined && (!Number.isFinite(days) || days < 0)) {
    throw new Error("--days must be a non-negative number");
  }

  const result = {
    days,
    archivedDays,
    dryRun,
    messages: { removed: 0, details: [] },
    rooms: [],
    trash: 0,
  };

  if (days > 0) {
    result.messages = await pruneMessages(days, { dryRun });
  }

  if (opts.rooms && archivedDays > 0) {
    const cutoff = now() - archivedDays * DAY_MS;
    const rooms = await loadRooms();
    const reads = await loadReads();
    const keep = [];
    for (const room of rooms) {
      if (!room.archivedAt || Number(room.archivedAt) >= cutoff) {
        keep.push(room);
        continue;
      }
      result.rooms.push({
        name: room.name,
        id: room.id,
        archivedAt: room.archivedAt,
      });
      if (!dryRun) {
        await moveRoomToTrash(room);
        delete reads[room.id];
      }
    }
    if (!dryRun && result.rooms.length) {
      await saveRooms(keep);
      await saveReads(reads);
    }
  }

  if (opts.trash && days > 0) {
    const cutoff = now() - days * DAY_MS;
    const entries = await fsp.readdir(TRASH_DIR).catch(() => []);
    for (const entry of entries) {
      const file = path.join(TRASH_DIR, entry);
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat || !stat.isFile() || stat.mtimeMs >= cutoff) continue;
      result.trash++;
      if (!dryRun) await fsp.rm(file, { force: true });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `${dryRun ? "Проверка" : "Очистка"}: сообщений ${result.messages.removed}, комнат ${result.rooms.length}, файлов корзины ${result.trash}.`,
  );
  for (const item of result.messages.details) {
    console.log(`  ${item.room}: −${item.removed}, осталось ${item.kept}`);
  }
  for (const room of result.rooms) {
    console.log(`  архивная комната: ${room.name} (${room.id})`);
  }
}

/* ------------------------------------------------------------------ */
/* Messages                                                           */
/* ------------------------------------------------------------------ */

async function cmdPost(wake) {
  const reference = opts._[0];
  const text = opts["text-file"]
    ? (await fsp.readFile(String(opts["text-file"]), "utf8")).trim()
    : opts._.slice(1).join(" ").trim();
  if (!reference || !text) {
    throw new Error(
      `usage: agent-chat ${wake ? "wake" : "post"} "<комната>" "<текст>" --from <агент>`,
    );
  }
  assertText(text);

  const project = currentProject();
  const rooms = await loadRooms();
  const room = findRoom(rooms, reference, project);

  let from = opts.from || (opts.user ? "user" : "");
  if (!from) throw new Error("--from is required (your agent name)");
  if (!wake && from === "user") {
    throw new Error('use "agent-chat say" for user messages');
  }
  if (from !== "user") {
    if (
      !from.includes("@") &&
      normProject(room.project) !== normProject(process.cwd())
    ) {
      from = `${from}@${await ensureProject(process.cwd())}`;
    }
    const info = await resolveParticipant(from, room.project);
    validateAgent(info.name);
    from =
      info.qualified && normProject(info.project) !== normProject(room.project)
        ? `${info.name}@${info.alias}`
        : info.name;
  }
  if (from !== "user" && !room.participants.includes(from)) {
    throw new Error(`agent "${from}" is not a participant of "${room.name}"`);
  }

  const messages = await readMessages(room.id);
  const replyTo = opts["reply-to"] || null;
  let hop = Number(opts.hop || 0);
  if (replyTo) {
    const original = messages.find((message) => message.id === replyTo);
    if (!original) throw new Error(`reply target ${replyTo} not found`);
    hop = Number(original.hop || 0) + 1;
  }
  if (hop > MAX_HOPS && !opts.force) {
    throw new Error(
      `hop ${hop} > ${MAX_HOPS}: останови переписку или передай --force, если это осознанно`,
    );
  }

  const recipients = wake
    ? await resolveWakeRecipients(room, from, text)
    : room.participants.filter((name) => name !== from);

  const message = {
    id: uid("chat_"),
    roomID: room.id,
    ts: now(),
    from,
    kind: wake ? "wake" : "note",
    text,
    refs: collectRefs(text),
    replyTo,
    hop,
    delivered: [],
    failed: [],
  };
  await appendMessage(room.id, message);

  const mode = wake ? "wake" : "note";
  const timeout = Number(opts.timeout || 300);

  for (const agent of recipients) {
    const result = await deliver(agent, room, message, mode, timeout);
    if (result.ok) message.delivered.push({ agent, sessionID: result.sessionID });
    else message.failed.push({ agent, error: result.error });
  }

  room.updatedAt = now();
  await saveRooms(rooms);
  await appendMessage(room.id, {
    id: uid("chat_"),
    roomID: room.id,
    ts: message.ts,
    from: "system",
    kind: "system",
    text: `delivery: ok=${message.delivered.length} failed=${message.failed.length}`,
    replyTo: message.id,
    hop,
    delivered: [],
    failed: [],
  });
  await maybeAutoPrune();

  printDelivery(message, wake);
}

async function cmdSay() {
  const reference = opts._[0];
  const text = opts["text-file"]
    ? (await fsp.readFile(String(opts["text-file"]), "utf8")).trim()
    : opts._.slice(1).join(" ").trim();
  if (!reference || !text) {
    throw new Error('usage: agent-chat say "<комната>" "<текст>"');
  }
  assertText(text);

  const project = currentProject();
  const rooms = await loadRooms();
  const room = findRoom(rooms, reference, project);

  const message = {
    id: uid("chat_"),
    roomID: room.id,
    ts: now(),
    from: "user",
    kind: "message",
    text,
    refs: collectRefs(text),
    replyTo: null,
    hop: 0,
    delivered: [],
    failed: [],
  };
  await appendMessage(room.id, message);

  const roomOnly = Boolean(opts["room-only"]);
  let recipients = roomOnly ? [] : room.participants;
  if (!roomOnly && opts.to) {
    const values = String(opts.to)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length) throw new Error("no recipients selected");
    recipients = [];
    for (const value of values) {
      const id = await normalizeParticipant(value, room.project);
      if (!room.participants.includes(id)) {
        throw new Error(`agent "${id}" is not a participant of "${room.name}"`);
      }
      recipients.push(id);
    }
  }

  const timeout = Number(opts.timeout || 300);
  for (const agent of recipients) {
    const result = await deliver(agent, room, message, "user", timeout);
    if (result.ok) message.delivered.push({ agent, sessionID: result.sessionID });
    else message.failed.push({ agent, error: result.error });
  }

  room.updatedAt = now();
  await saveRooms(rooms);
  await maybeAutoPrune();
  printDelivery(message, false);
}

async function resolveWakeRecipients(room, from, text) {
  let raw = [];
  if (opts.to) {
    raw = String(opts.to)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  } else {
    const mentioned = new Set();
    for (const match of text.matchAll(/@([a-z0-9._-]+)/gi)) {
      mentioned.add(match[1].toLowerCase());
    }
    raw = room.participants.filter((id) => {
      const parts = splitParticipant(id, room.project);
      const label = parts.alias ? `${parts.name}@${parts.alias}` : parts.name;
      return (
        mentioned.has(parts.name.toLowerCase()) ||
        mentioned.has(label.toLowerCase())
      );
    });
  }
  if (!raw.length) {
    raw = room.participants.filter((id) => id !== from);
  }

  const recipients = [];
  for (const value of raw) {
    const id = await normalizeParticipant(value, room.project);
    if (!room.participants.includes(id)) {
      throw new Error(`agent "${id}" is not a participant of "${room.name}"`);
    }
    recipients.push(id);
  }
  return [...new Set(recipients.filter((id) => id !== from))];
}

function composeNote(room, message) {
  return [
    `[agent-chat][note] room="${room.name}" from=${message.from} id=${message.id} hop=${message.hop}`,
    `Проект комнаты: ${room.project}`,
    "",
    message.text + refsBlock(message),
    "",
    "---",
    "Это автоматическое уведомление от другого агента, не от пользователя.",
    "Отвечать не обязательно. Если ответ полезен, отправь его в комнату:",
    `  agent-chat post "${room.name}" "<ответ>" --from <твоё-имя> --reply-to ${message.id}`,
  ].join("\n");
}

function composeWake(room, message) {
  const fromUser = message.from === "user";
  return [
    `[agent-chat][wake] room="${room.name}" from=${message.from} id=${message.id} hop=${message.hop}`,
    `Проект комнаты: ${room.project}`,
    "",
    message.text + refsBlock(message),
    "",
    "---",
    fromUser
      ? "Пользователь разбудил тебя в чате. Это сигнал обратить внимание, а не обычный диалог."
      : `Тебя разбудил агент ${message.from}, а не пользователь.`,
    "Действуй, только если это в твоей зоне ответственности.",
    "Твой финальный ответ будет автоматически опубликован в комнате.",
    'Если действий не требуется, ответь ровно: "действий не требуется" и остановись.',
  ].join("\n");
}

function composeUser(room, message) {
  return [
    `[agent-chat][user] room="${room.name}" id=${message.id}`,
    `Проект комнаты: ${room.project}`,
    "",
    message.text + refsBlock(message),
    "",
    "---",
    "Это сообщение пользователя в комнате. Ответь как обычно;",
    "твой финальный ответ будет автоматически опубликован в комнате.",
    "Не публикуй его повторно вручную.",
  ].join("\n");
}

async function deliver(participantId, room, message, mode, timeout) {
  if (mode === "note") {
    // Passive notifications stay in the bus inbox. They must not be injected
    // into the session context: otherwise a pending note can hijack the next
    // user/wake turn.
    return { ok: true, sessionID: null, queued: true };
  }

  const info = await resolveParticipant(participantId, room.project);
  const projectKey = normProject(info.project);
  const bindings = await loadBindings();
  const binding = bindings[projectKey]?.[info.name];
  if (!binding?.sessionID) {
    return {
      ok: false,
      error: `agent "${info.name}" в проекте "${info.alias}" не привязан. Открой его окно: agent-chat bind ${info.name} --project "${info.project}"`,
    };
  }

  const probe = sessionProbe(binding.sessionID);
  if (!probe.ok) {
    binding.checkedAt = now();
    binding.checkError = probe.error;
    await saveBindings(bindings);
    return {
      ok: false,
      error: `не удалось проверить сессию ${binding.sessionID}: ${probe.error}`,
    };
  }
  if (!probe.session) {
    binding.alive = false;
    binding.checkedAt = now();
    delete binding.checkError;
    await saveBindings(bindings);
    return {
      ok: false,
      error: `сессия ${binding.sessionID} мертва; привяжи заново: agent-chat bind ${info.name} --project "${info.project}"`,
    };
  }
  binding.alive = true;
  binding.checkedAt = now();
  if (probe.session.title) binding.title = probe.session.title;
  await saveBindings(bindings);

  const unread = unreadFor(
    await readMessages(room.id),
    await loadReads(),
    room.id,
    participantId,
  );
  const digest =
    unread > 0
      ? `\n\n[agent-chat] Непрочитанных уведомлений: ${unread}. Проверь: agent-chat inbox ${info.name}`
      : "";
  const text =
    (mode === "wake" ? composeWake(room, message) : composeUser(room, message)) +
    digest;

  try {
    spawnWakeOne({
      sessionID: binding.sessionID,
      project: info.project,
      roomID: room.id,
      agent: participantId,
      replyTo: message.id,
      hop: Number(message.hop || 0) + 1,
      timeout,
      text,
    });
    return { ok: true, sessionID: binding.sessionID };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function printDelivery(message, wake) {
  if (opts.json) {
    console.log(JSON.stringify({ message }, null, 2));
    return;
  }
  if (message.kind === "note") {
    console.log(`Уведомление ${message.id} в комнате ${message.roomID}`);
    console.log(
      `В inbox: ${message.delivered.map((item) => item.agent).join(", ") || "—"}`,
    );
    if (message.failed.length) {
      console.log(
        `Не доставлено: ${message.failed
          .map((item) => `${item.agent}: ${item.error}`)
          .join("; ")}`,
      );
    }
    return;
  }
  if (!message.delivered.length && !message.failed.length) {
    console.log(`Записано в чат ${message.roomID} без получателей.`);
    return;
  }
  console.log(
    `${wake ? "Пробуждение" : "Сообщение"} ${message.id} в комнате ${message.roomID}`,
  );
  if (message.delivered.length) {
    console.log(
      `Доставлено: ${message.delivered
        .map((item) => `${item.agent} (${item.sessionID})`)
        .join(", ")}`,
    );
  }
  if (message.failed.length) {
    console.log(
      `Не доставлено: ${message.failed
        .map((item) => `${item.agent}: ${item.error}`)
        .join("; ")}`,
    );
  }
}

const SECRET_PATTERNS = [
  {
    label: "private key",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/i,
  },
  {
    label: "API key (sk-)",
    re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    label: "GitHub token",
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    label: "AWS access key",
    re: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    label: "Google API key",
    re: /\bAIza[0-9A-Za-z_-]{30,}\b/,
  },
  {
    label: "Slack token",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    label: "Stripe key",
    re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  },
  {
    label: "JWT",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    label: "Bearer token",
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
  },
  {
    label: "secret assignment",
    re: /\b(?:api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{12,})/i,
    validate: (match) =>
      !/^(?:process\.env|\$\{|<|example|dummy|sample|test|xxxx|redacted|\*+)/i.test(
        match[1],
      ),
  },
  {
    label: ".env value",
    re: /^(?:export\s+)?[A-Z][A-Z0-9_]{2,}\s*=\s*["']?([A-Za-z0-9_./+=-]{20,})/m,
    validate: (match) =>
      !/^(?:process\.env|\$\{|<|example|dummy|sample|test|xxxx|redacted|\*+)/i.test(
        match[1],
      ),
  },
];

function findSecrets(text) {
  const found = [];
  for (const pattern of SECRET_PATTERNS) {
    const match = pattern.re.exec(String(text));
    if (!match) continue;
    if (pattern.validate && !pattern.validate(match)) continue;
    found.push(pattern.label);
  }
  return [...new Set(found)];
}

function assertNoSecrets(text) {
  const found = findSecrets(text);
  if (found.length) {
    throw new Error(
      `в сообщении найден возможный секрет (${found.join(", ")}); сообщение не отправлено`,
    );
  }
}

function addRef(refs, kind, value) {
  const text = String(value).trim().replace(/^["']|["']$/g, "");
  if (!text) return;
  refs.push({ kind, value: text });
}

function collectRefs(text) {
  const refs = [];
  for (const match of String(text).matchAll(/@file:([^\s]+)/gi)) {
    addRef(refs, "file", match[1]);
  }
  for (const match of String(text).matchAll(/@test:([^\n]+)/gi)) {
    addRef(refs, "test", match[1]);
  }
  for (const match of String(text).matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
    const value = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
    if (!/[./\\]/.test(value) && !/\.[a-z0-9]{1,8}$/i.test(value)) continue;
    addRef(refs, "file", value);
  }
  if (typeof opts.file === "string") {
    for (const value of opts.file.split(",")) addRef(refs, "file", value);
  }
  if (typeof opts.test === "string") {
    for (const value of opts.test.split(",")) addRef(refs, "test", value);
  }
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref.kind}\0${ref.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function refsBlock(message) {
  if (!message.refs?.length) return "";
  return `\nСсылки:\n${message.refs
    .map((ref) => `  ${ref.kind}: ${ref.value}`)
    .join("\n")}`;
}

function assertText(text) {
  if (!text || !text.trim()) throw new Error("message text is empty");
  if (text.length > MAX_TEXT) {
    throw new Error(`message is too long (${text.length} > ${MAX_TEXT})`);
  }
  const extras = [
    typeof opts.file === "string" ? opts.file : "",
    typeof opts.test === "string" ? opts.test : "",
  ];
  assertNoSecrets([text, ...extras].join("\n"));
}

function validateAgent(name) {
  if (!/^[a-z0-9._-]+$/i.test(name)) {
    throw new Error(`invalid agent name "${name}"`);
  }
}

/* ------------------------------------------------------------------ */
/* Reading                                                            */
/* ------------------------------------------------------------------ */

async function cmdRead() {
  const reference = opts._[0];
  if (!reference) throw new Error('usage: agent-chat read "<комната>"');
  const project = currentProject();
  const reader = opts.from || "user";

  const [rooms, projects] = await Promise.all([loadRooms(), loadProjects()]);
  const room = findRoom(rooms, reference, project, { includeArchived: true });
  const messages = await readMessages(room.id);

  let readerId = reader;
  if (reader !== "user") {
    if (reader.includes("@")) {
      const info = await resolveParticipant(reader, room.project);
      readerId =
        info.qualified && normProject(info.project) !== normProject(room.project)
          ? `${info.name}@${info.alias}`
          : info.name;
    } else {
      const matches = room.participants.filter((id) => {
        const parts = splitParticipant(id, room.project);
        if (parts.name !== reader) return false;
        const participantProject = parts.projectRef
          ? projects[parts.alias] || room.project
          : room.project;
        return normProject(participantProject) === normProject(project);
      });
      readerId = matches[0] || reader;
    }
  }

  if (
    messages.length &&
    (reader === "user" || room.participants.includes(readerId))
  ) {
    const reads = await loadReads();
    reads[room.id] = reads[room.id] || {};
    reads[room.id][readerId] = messages[messages.length - 1].id;
    await saveReads(reads);
  }

  if (opts.json) {
    console.log(JSON.stringify({ room, messages }, null, 2));
    return;
  }
  if (!messages.length) {
    console.log(`Комната "${room.name}" пуста.`);
    return;
  }
  console.log(`# ${room.name} (${room.id})`);
  console.log(`# участники: ${room.participants.join(", ") || "—"}`);
  for (const message of messages) {
    if (message.kind === "system") continue;
    console.log(formatMessage(message));
  }
}

async function cmdInbox() {
  const agentRef = opts._[0] || opts.from;
  if (!agentRef) throw new Error("usage: agent-chat inbox <агент>");
  const project = currentProject();
  const [rooms, reads, projects] = await Promise.all([
    loadRooms(),
    loadReads(),
    loadProjects(),
  ]);
  const result = [];

  for (const room of rooms) {
    if (room.archivedAt) continue;
    let ids = [];
    if (String(agentRef).includes("@")) {
      const info = await resolveParticipant(agentRef, room.project);
      const id =
        info.qualified &&
        normProject(info.project) !== normProject(room.project)
          ? `${info.name}@${info.alias}`
          : info.name;
      if (room.participants.includes(id)) ids = [id];
    } else {
      const matches = room.participants.filter((id) => {
        const parts = splitParticipant(id, room.project);
        if (parts.name !== agentRef) return false;
        const participantProject = parts.projectRef
          ? projects[parts.alias] || room.project
          : room.project;
        return normProject(participantProject) === normProject(project);
      });
      ids = matches.slice(0, 1);
    }

    for (const id of ids) {
      const messages = await readMessages(room.id);
      const lastRead = reads[room.id]?.[id];
      const index = lastRead
        ? messages.findIndex((message) => message.id === lastRead)
        : -1;
      const unread = messages
        .slice(index + 1)
        .filter(
          (message) => message.from !== id && message.kind !== "system",
        );
      if (unread.length) result.push({ room, participant: id, messages: unread });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ agent: agentRef, rooms: result }, null, 2));
    return;
  }
  if (!result.length) {
    console.log(`Непрочитанных нет (${agentRef}).`);
    return;
  }
  for (const item of result) {
    console.log(
      `# ${item.room.name} (${item.room.id}) — ${item.participant} — ${item.messages.length}`,
    );
    for (const message of item.messages) {
      console.log(formatMessage(message));
    }
  }
}

async function cmdMessages() {
  const reference = opts._[0];
  if (!reference) throw new Error('usage: agent-chat messages "<комната>"');
  const project = currentProject();
  const rooms = await loadRooms();
  const room = findRoom(rooms, reference, project, { includeArchived: true });
  const limit = Number(opts.n || 80);
  const all = await readMessages(room.id);
  const messages = all.slice(-limit);

  if (opts.from) {
    const reads = await loadReads();
    reads[room.id] = reads[room.id] || {};
    if (all.length) reads[room.id][opts.from] = all[all.length - 1].id;
    await saveReads(reads);
  }

  if (opts.json) {
    console.log(JSON.stringify({ room, messages }, null, 2));
    return;
  }
  for (const message of messages) {
    console.log(formatMessage(message));
  }
}

function searchSnippet(text, query, limit = 180) {
  const source = String(text).replace(/\s+/g, " ").trim();
  const index = source.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return oneLine(source, limit);
  const start = Math.max(0, index - 60);
  const end = Math.min(source.length, index + query.length + 100);
  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${
    end < source.length ? "…" : ""
  }`;
}

async function cmdSearch() {
  const query = opts._.join(" ").trim();
  if (!query) {
    throw new Error(
      'usage: agent-chat search "<текст>" [--room <комната>] [--from <агент>] [--limit 30] [--include-archived] [--current]',
    );
  }
  const project = currentProject();
  const [rooms, projects] = await Promise.all([loadRooms(), loadProjects()]);
  const includeArchived = Boolean(opts["include-archived"]);
  const limit = Math.max(1, Number(opts.limit || 30));
  let selected = includeArchived
    ? rooms
    : rooms.filter((room) => !room.archivedAt);

  if (opts.current) {
    selected = selected.filter(
      (room) => normProject(room.project) === normProject(project),
    );
  }
  if (opts.room) {
    selected = [
      findRoom(rooms, opts.room, project, { includeArchived }),
    ];
  }

  const results = [];
  for (const room of selected) {
    const messages = await readMessages(room.id);
    let expectedFrom = null;
    if (opts.from) {
      if (opts.from === "user") {
        expectedFrom = "user";
      } else {
        const info = await resolveParticipant(opts.from, room.project);
        expectedFrom =
          info.qualified &&
          normProject(info.project) !== normProject(room.project)
            ? `${info.name}@${info.alias}`
            : info.name;
      }
    }

    for (const message of messages) {
      if (message.kind === "system") continue;
      if (expectedFrom && message.from !== expectedFrom) continue;
      const refsText = (message.refs || [])
        .map((ref) => `${ref.kind}: ${ref.value}`)
        .join(" ");
      const haystack = `${message.text || ""}\n${refsText}`.toLowerCase();
      if (!haystack.includes(query.toLowerCase())) continue;
      results.push({
        room: {
          id: room.id,
          name: room.name,
          project: room.project,
          projectAlias: aliasOf(projects, room.project),
          archived: Boolean(room.archivedAt),
        },
        message,
        snippet:
          message.text &&
          message.text.toLowerCase().includes(query.toLowerCase())
            ? searchSnippet(message.text, query)
            : refsText,
      });
    }
  }

  results.sort((a, b) => Number(b.message.ts) - Number(a.message.ts));
  const sliced = results.slice(0, limit);

  if (opts.json) {
    console.log(
      JSON.stringify(
        { query, count: results.length, results: sliced },
        null,
        2,
      ),
    );
    return;
  }
  if (!results.length) {
    console.log(`Ничего не найдено: "${query}".`);
    return;
  }
  console.log(`# "${query}" — найдено: ${results.length}`);
  for (const item of sliced) {
    const time = new Date(item.message.ts).toLocaleString("ru-RU");
    console.log(
      `\n${item.room.name} [${item.room.projectAlias}]${item.room.archived ? " [архив]" : ""} · ${time} · ${item.message.from}`,
    );
    console.log(`  ${item.snippet}`);
    for (const ref of item.message.refs || []) {
      console.log(`  ↳ ${ref.kind}: ${ref.value}`);
    }
    console.log(`  id: ${item.message.id}`);
  }
  if (results.length > sliced.length) {
    console.log(`\nПоказано ${sliced.length} из ${results.length}.`);
  }
}

async function cmdAuditSecrets() {
  const rooms = await loadRooms();
  const findings = [];
  for (const room of rooms) {
    const messages = await readMessages(room.id);
    for (const message of messages) {
      const haystack = [
        message.text || "",
        ...(message.refs || []).map((ref) => ref.value),
      ].join("\n");
      if (!haystack.trim()) continue;
      const kinds = findSecrets(haystack);
      if (!kinds.length) continue;
      findings.push({
        room: room.name,
        roomID: room.id,
        messageID: message.id,
        from: message.from,
        ts: message.ts,
        kinds,
      });
    }
  }
  if (opts.json) {
    console.log(JSON.stringify({ count: findings.length, findings }, null, 2));
    return;
  }
  if (!findings.length) {
    console.log("Возможных секретов в истории нет.");
    return;
  }
  console.log(`Найдено сообщений с возможными секретами: ${findings.length}`);
  for (const item of findings) {
    console.log(
      `  ${item.room} · ${item.messageID} · ${item.from} · ${item.kinds.join(", ")}`,
    );
  }
  console.log("Текст не выводится. Удали или отредактируй такие сообщения вручную.");
}

/* ------------------------------------------------------------------ */
/* Sessions                                                           */
/* ------------------------------------------------------------------ */

async function cmdBind() {
  const agent = opts._[0];
  if (!agent) throw new Error("usage: agent-chat bind <агент> [--session ses_...]");
  validateAgent(agent);
  let project = process.cwd();
  if (opts.project) {
    project = fs.existsSync(opts.project)
      ? path.resolve(opts.project)
      : (await resolveProjectRef(opts.project)).project;
  }
  const projectKey = normProject(project);
  const projectAlias = await ensureProject(project);

  let session;
  if (opts.session) {
    session = sessionGet(String(opts.session));
    if (!session) throw new Error(`session ${opts.session} not found`);
    if (session.agent && session.agent !== agent) {
      throw new Error(
        `session ${session.id} runs agent "${session.agent}", not "${agent}"`,
      );
    }
    if (
      session.location?.directory &&
      normProject(session.location.directory) !== normProject(project)
    ) {
      throw new Error(
        `session ${session.id} belongs to ${session.location.directory}, not ${project}`,
      );
    }
  } else {
    const candidates = sessionList(project)
      .filter((item) => item.agent === agent)
      .filter((item) => !item.parentID);
    if (!candidates.length) {
      throw new Error(
        `no session with agent "${agent}" in ${project}. Open that agent first.`,
      );
    }
    if (candidates.length > 1 && !opts.yes) {
      console.log(`Несколько сессий с агентом "${agent}":`);
      for (const item of candidates) {
        console.log(
          `  ${item.id}  ${item.title || "(без названия)"}  updated=${new Date(
            item.time.updated,
          ).toLocaleString("ru-RU")}`,
        );
      }
      throw new Error("выбери сессию через --session <id> или добавь --yes");
    }
    session = candidates[0];
  }

  const bindings = await loadBindings();
  bindings[projectKey] = bindings[projectKey] || {};
  bindings[projectKey][agent] = {
    sessionID: session.id,
    agent,
    title: session.title || "",
    alive: true,
    checkedAt: now(),
    updatedAt: now(),
  };
  await saveBindings(bindings);

  if (opts.json) {
    console.log(
      JSON.stringify(
        { binding: bindings[projectKey][agent], projectAlias },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `Привязано: ${agent}@${projectAlias} -> ${session.id} (${session.title || "без названия"})`,
    );
  }
}

async function cmdUnbind() {
  const agent = opts._[0];
  if (!agent && !opts.stale) {
    throw new Error(
      "usage: agent-chat unbind <агент> [--project <alias|dir>] | unbind --stale [--all]",
    );
  }
  let project = process.cwd();
  if (opts.project) {
    project = fs.existsSync(opts.project)
      ? path.resolve(opts.project)
      : (await resolveProjectRef(opts.project)).project;
  }
  const projectKey = normProject(project);
  const projectAlias = await ensureProject(project);

  if (opts.stale) {
    const checked = await checkBindings(true);
    const bindings = await loadBindings();
    const scope = opts.all ? null : projectKey;
    const stale = checked.filter(
      (item) =>
        item.binding.alive === false &&
        (!scope || item.projectKey === scope),
    );
    for (const item of stale) {
      const channels = bindings[item.projectKey];
      if (channels) delete channels[item.channel];
    }
    if (stale.length) await saveBindings(bindings);
    if (opts.json) {
      console.log(JSON.stringify({ removed: stale.map((item) => ({
        project: item.projectKey,
        channel: item.channel,
        sessionID: item.binding.sessionID,
      })) }, null, 2));
      return;
    }
    if (!stale.length) {
      console.log("Мёртвых привязок нет.");
      return;
    }
    for (const item of stale) {
      console.log(
        `Отвязано: ${item.channel} -> ${item.binding.sessionID}`,
      );
    }
    return;
  }

  const bindings = await loadBindings();
  if (bindings[projectKey]) delete bindings[projectKey][agent];
  await saveBindings(bindings);
  console.log(`Отвязано: ${agent}@${projectAlias}`);
}

async function cmdChannels() {
  await checkBindings(Boolean(opts.check));
  const bindings = await loadBindings();
  const projects = await loadProjects();
  const active = sessionActive();
  const all = Boolean(opts.all);
  const project = currentProject();
  await ensureProject(project);
  const targets = all
    ? Object.entries(projects)
    : [[await ensureProject(project), project]];

  const result = targets.map(([alias, dir]) => ({
    alias,
    project: dir,
    channels: Object.entries(bindings[normProject(dir)] || {})
      .map(([channel, binding]) => {
        const state = binding.alive === false
          ? "dead"
          : binding.sessionID
            ? active[binding.sessionID]
              ? "running"
              : "idle"
            : "unbound";
        return { channel, ...binding, state };
      })
      .filter((item) => !opts.stale || item.state === "dead"),
  }));

  if (opts.json) {
    console.log(JSON.stringify({ all, projects: result }, null, 2));
    return;
  }
  if (!result.some((item) => item.channels.length)) {
    console.log(opts.stale ? "Мёртвых привязок нет." : "Привязанных каналов нет.");
    return;
  }
  for (const item of result) {
    if (!item.channels.length) continue;
    console.log(`# ${item.alias} (${item.project})`);
    for (const binding of item.channels.sort((a, b) =>
      a.channel.localeCompare(b.channel),
    )) {
      console.log(
        `  ${binding.channel}@${item.alias} -> ${binding.title || "—"} (${binding.agent || "?"}) ${binding.sessionID} [${binding.state}]${binding.checkError ? ` ! ${binding.checkError}` : ""}`,
      );
    }
  }
}

async function cmdSessions() {
  const project = currentProject();
  const alias = await ensureProject(project);
  const sessions = sessionList(project).filter((session) => !session.parentID);
  const agent = opts.agent ? String(opts.agent) : null;
  const limit = Number(opts.limit || 30);
  const filtered = sessions
    .filter((session) => !agent || session.agent === agent)
    .slice(0, limit);

  if (opts.json) {
    console.log(
      JSON.stringify({ project, alias, sessions: filtered }, null, 2),
    );
    return;
  }
  console.log(
    `# ${alias} (${project}) — всего сессий: ${sessions.length}${
      agent ? `, агент: ${agent}` : ""
    }`,
  );
  for (const session of filtered) {
    console.log(
      `${session.id}  ${session.agent || "?"}  ${session.title || "—"}  ${new Date(
        session.time.updated,
      ).toLocaleString("ru-RU")}`,
    );
  }
  console.log("Привязать: agent-chat bind --session <id>");
}

async function cmdProjects() {
  const projects = await loadProjects();
  const entries = Object.entries(projects).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (opts.json) {
    console.log(JSON.stringify(projects, null, 2));
    return;
  }
  if (!entries.length) {
    console.log("Проектов пока нет. Добавь: agent-chat project add <alias> \"<dir>\"");
    return;
  }
  for (const [alias, dir] of entries) console.log(`${alias} -> ${dir}`);
}

async function cmdProject() {
  const action = opts._[0];
  if (action !== "add") {
    throw new Error('usage: agent-chat project add <alias> "<dir>"');
  }
  const alias = opts._[1];
  const dir = opts._[2];
  if (!alias || !dir) {
    throw new Error('usage: agent-chat project add <alias> "<dir>"');
  }
  if (!/^[a-z0-9._-]+$/i.test(alias)) {
    throw new Error(`invalid project alias "${alias}"`);
  }
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    throw new Error(`directory not found: ${resolved}`);
  }
  const projects = await loadProjects();
  const existing = Object.entries(projects).find(
    ([, value]) => normProject(value) === normProject(resolved),
  );
  if (existing && existing[0] !== alias) delete projects[existing[0]];
  projects[alias] = resolved;
  await saveProjects(projects);
  console.log(`Проект ${alias} -> ${resolved}`);
}

async function cmdConfig() {
  const config = await loadConfig();
  let changed = false;

  const setNumber = (key, value, label) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error(`${label} must be a non-negative number`);
    }
    return number;
  };

  if (opts["retention-days"] !== undefined) {
    config.retentionDays = setNumber(
      "retention-days",
      opts["retention-days"],
      "--retention-days",
    );
    changed = true;
  }
  if (opts["archived-retention-days"] !== undefined) {
    config.archivedRetentionDays = setNumber(
      "archived-retention-days",
      opts["archived-retention-days"],
      "--archived-retention-days",
    );
    changed = true;
  }
  if (changed) await saveConfig(config);

  if (opts.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  console.log(`store:                 ${ROOT}`);
  console.log(`retention (messages):  ${config.retentionDays || "выключен"} дн.`);
  console.log(`retention (archived):  ${config.archivedRetentionDays || "выключен"} дн.`);
}

async function cmdStatus() {
  const project = currentProject();
  const projectKey = normProject(project);
  const projectAlias = await ensureProject(project);
  await checkBindings(true);
  const [rooms, bindings, active, projects] = await Promise.all([
    loadRooms(),
    loadBindings(),
    Promise.resolve(sessionActive()),
    loadProjects(),
  ]);
  const projectRooms = rooms.filter(
    (room) => normProject(room.project) === projectKey,
  );
  const projectBindings = bindings[projectKey] || {};

  let service = "unknown";
  try {
    const info = ocJson(["server.info"]);
    service = info?.data ? "ok" : "ok";
  } catch {
    service = "down";
  }

  console.log(`agent-chat ${VERSION}`);
  console.log(`store:    ${ROOT}`);
  console.log(`project:  ${project} (${projectAlias})`);
  const dead = Object.values(projectBindings).filter(
    (binding) => binding.alive === false,
  ).length;
  console.log(`service:  ${service}`);
  console.log(`rooms:    ${projectRooms.length}`);
  console.log(`projects: ${Object.keys(projects).length}`);
  console.log(`dead:     ${dead}`);
  console.log("bindings:");
  const names = Object.keys(projectBindings);
  if (!names.length) {
    console.log("  (пусто)");
  } else {
    for (const name of names) {
      const binding = projectBindings[name];
      const state =
        binding.alive === false
          ? "dead"
          : active[binding.sessionID]
            ? "running"
            : "idle";
      console.log(
        `  ${name}@${projectAlias} -> ${binding.sessionID} (${state}) ${binding.title || ""}${binding.checkError ? ` ! ${binding.checkError}` : ""}`,
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Snapshot for the TUI                                               */
/* ------------------------------------------------------------------ */

async function cmdSnapshot() {
  const project = currentProject();
  const all = Boolean(opts.all);
  const includeArchived = Boolean(opts["include-archived"]);
  await checkBindings(false);
  const [rooms, reads, bindings, projects] = await Promise.all([
    loadRooms(),
    loadReads(),
    loadBindings(),
    loadProjects(),
  ]);
  await ensureProject(project);
  const active = sessionActive();

  const visible = rooms
    .filter((room) => all || normProject(room.project) === normProject(project))
    .filter((room) => includeArchived || !room.archivedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const views = [];
  for (const room of visible) {
    const messages = await readMessages(room.id);
    views.push(roomView(room, messages, reads, bindings, active, projects));
  }

  console.log(
    JSON.stringify({
      version: VERSION,
      project,
      projectAlias: aliasOf(projects, project),
      all,
      rooms: views,
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Wake worker                                                        */
/* ------------------------------------------------------------------ */

function spawnWakeOne({ sessionID, project, roomID, agent, replyTo, hop, timeout, text }) {
  const textFile = path.join(CAPTURES_DIR, `${replyTo}-${sessionID}.prompt.txt`);
  fs.mkdirSync(path.dirname(textFile), { recursive: true });
  fs.writeFileSync(textFile, text, "utf8");

  const args = [
    SELF,
    "wake-one",
    "--session",
    sessionID,
    "--project",
    project,
    "--room",
    roomID,
    "--agent",
    agent,
    "--reply-to",
    replyTo,
    "--hop",
    String(hop),
    "--timeout",
    String(timeout),
    "--text-file",
    textFile,
  ];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    cwd: project,
  });
  child.unref();
}

async function cmdWakeOne() {
  const sessionID = opts.session;
  const project = path.resolve(opts.project || process.cwd());
  const roomID = opts.room;
  const agent = opts.agent;
  const replyTo = opts["reply-to"];
  const hop = Number(opts.hop || 1);
  const timeout = Number(opts.timeout || 300);
  const textFile = opts["text-file"];
  if (!sessionID || !roomID || !agent || !replyTo || !textFile) {
    throw new Error("wake-one is internal: missing session/room/agent/reply-to/text-file");
  }
  validateAgent(String(agent).split("@")[0]);
  await ensureDirs();

  const marker = path.join(CAPTURES_DIR, `${replyTo}-${sessionID}.json`);
  try {
    const status = JSON.parse(await fsp.readFile(marker, "utf8"));
    if (
      status.status === "done" ||
      status.status === "blocked" ||
      status.status === "skipped"
    ) {
      return;
    }
    if (status.status === "running" && now() - status.started < 10 * 60 * 1000) {
      return;
    }
    await fsp.rm(marker, { force: true });
  } catch {
    // No marker yet.
  }

  let handle;
  try {
    handle = await fsp.open(marker, "wx");
    await handle.writeFile(
      JSON.stringify({ status: "running", started: now(), sessionID, agent }),
      "utf8",
    );
  } catch (error) {
    if (error.code === "EEXIST") return;
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }

  try {
    const text = await fsp.readFile(textFile, "utf8");
    const started = now();
    const run = await runOpencode(project, sessionID, text, timeout);
    const reply = parseRunText(run.stdout);

    if (!reply) {
      const detail = [run.stderr, run.stdout].filter(Boolean).join("\n").trim();
      await fsp.writeFile(
        marker,
        JSON.stringify({
          status: run.code === 0 ? "timeout" : "error",
          started,
          finished: now(),
          sessionID,
          agent,
          replyTo,
          code: run.code,
          detail: detail.slice(0, 2000),
        }),
        "utf8",
      );
      return;
    }

    const replyRefs = collectRefs(reply);
    const secrets = findSecrets(
      [reply, ...replyRefs.map((ref) => ref.value)].join("\n"),
    );
    if (secrets.length) {
      await appendSystemMessage(
        roomID,
        `ответ ${agent} заблокирован фильтром секретов: ${secrets.join(", ")}`,
        replyTo,
        hop,
      );
      await fsp.writeFile(
        marker,
        JSON.stringify({
          status: "blocked",
          started,
          finished: now(),
          sessionID,
          agent,
          replyTo,
          error: `possible secret: ${secrets.join(", ")}`,
        }),
        "utf8",
      );
      return;
    }

    const currentRooms = await loadRooms();
    const currentRoom = currentRooms.find((item) => item.id === roomID);
    if (!currentRoom || currentRoom.archivedAt) {
      await fsp.writeFile(
        marker,
        JSON.stringify({
          status: "skipped",
          started,
          finished: now(),
          sessionID,
          agent,
          replyTo,
          reason: currentRoom ? "room archived" : "room deleted",
        }),
        "utf8",
      );
      return;
    }

    const message = {
      id: uid("chat_"),
      roomID,
      ts: now(),
      from: agent,
      kind: "reply",
      text: truncate(reply, 16000),
      refs: replyRefs,
      replyTo,
      hop,
      delivered: [],
      failed: [],
    };
    await appendMessage(roomID, message);

    const reads = await loadReads();
    reads[roomID] = reads[roomID] || {};
    reads[roomID][agent] = message.replyTo || message.id;
    await saveReads(reads);

    const rooms = await loadRooms();
    const room = rooms.find((item) => item.id === roomID);
    if (room) {
      room.updatedAt = now();
      await saveRooms(rooms);
    }
    await maybeAutoPrune();

    await fsp.writeFile(
      marker,
      JSON.stringify({
        status: "done",
        started,
        finished: now(),
        sessionID,
        agent,
        replyTo,
        messageID: message.id,
      }),
      "utf8",
    );
  } catch (error) {
    await fsp
      .writeFile(
        marker,
        JSON.stringify({
          status: "error",
          started: now(),
          finished: now(),
          sessionID,
          agent,
          replyTo,
          error: error.message,
        }),
        "utf8",
      )
      .catch(() => {});
    throw error;
  } finally {
    await fsp.rm(textFile, { force: true }).catch(() => {});
  }
}

function runOpencode(project, sessionID, text, timeout) {
  return new Promise((resolve) => {
    const child = spawn(
      opencodeExe(),
      ["run", "--session", sessionID, "--format", "json", text],
      {
        cwd: project,
        env: { ...process.env, OPENCODE_TERMINAL: "1" },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore.
      }
      finish(-1);
    }, Math.max(10, timeout) * 1000);

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      stderr += `\n${error.message}`;
      finish(-1);
    });
    child.on("close", (code) => finish(code ?? -1));
  });
}

function parseRunText(stdout) {
  const texts = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "text" && typeof event.part?.text === "string") {
        if (event.part.text.trim()) texts.push(event.part.text);
      }
    } catch {
      // `opencode run` may print non-JSON log lines.
    }
  }
  return texts.length ? texts[texts.length - 1] : "";
}

/* ------------------------------------------------------------------ */
/* Init                                                               */
/* ------------------------------------------------------------------ */

async function cmdInit() {
  const project = currentProject();
  const rooms = await loadRooms();
  const exists = rooms.some(
    (room) =>
      normProject(room.project) === normProject(project) &&
      room.name.toLowerCase() === "general",
  );
  if (exists) {
    console.log(`Комната "general" уже есть в ${project}`);
    return;
  }
  opts.with = opts.with || undefined;
  opts.from = opts.from || "user";
  opts._ = ["general"];
  await cmdCreate();
}
