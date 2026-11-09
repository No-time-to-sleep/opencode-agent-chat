import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { promisify } from "node:util"
import { rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const execFileAsync = promisify(execFile)
const BUNDLED_SCRIPT = fileURLToPath(new URL("./cli.mjs", import.meta.url))
const LEGACY_SCRIPT = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "bin",
  "agent-chat.mjs",
)
const SCRIPT = process.env.AGENT_CHAT_CLI
  ? path.resolve(process.env.AGENT_CHAT_CLI)
  : existsSync(BUNDLED_SCRIPT)
    ? BUNDLED_SCRIPT
    : LEGACY_SCRIPT

type MessageRef = {
  kind: string
  value: string
}

type Message = {
  id: string
  roomID: string
  ts: number
  from: string
  kind: string
  text: string
  refs?: MessageRef[]
  replyTo: string | null
  hop: number
}

type Participant = {
  id: string
  name: string
  title?: string
  agent?: string | null
  channel?: string
  label: string
  project: string
  alias: string
  bound: boolean
  sessionID: string | null
  active: boolean
  alive: boolean
  dead: boolean
  status: string
  unread: number
}

type Room = {
  id: string
  name: string
  description?: string
  project: string
  projectAlias?: string
  participants: string[]
  participantsDetail: Participant[]
  unread: number
  last: Message | null
  archivedAt?: number | null
}

type Snapshot = {
  project: string
  all: boolean
  rooms: Room[]
}

type MessagesResult = {
  room: Room
  messages: Message[]
}

type SearchHit = {
  room: {
    id: string
    name: string
    project: string
    projectAlias: string
    archived: boolean
  }
  message: Message
  snippet: string
}

type SearchResult = {
  query: string
  count: number
  results: SearchHit[]
}

type DeliveryResult = {
  message: {
    delivered: Array<{ agent: string }>
    failed: Array<{ agent: string; error: string }>
  }
}

type ChatData = {
  sessionID?: string
  agent?: string
  directory?: string
}

async function runRaw(args: string[], project: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "node",
    [SCRIPT, ...args, "--project", project],
    { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
  )
  return stdout
}

async function runJson<T>(args: string[], project: string): Promise<T> {
  const stdout = await runRaw([...args, "--json"], project)
  if (!stdout.trim()) throw new Error("agent-chat returned no output")
  return JSON.parse(stdout) as T
}

function shortTime(value: number) {
  return new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function shortText(value: string, limit: number) {
  const line = value.replace(/\s+/g, " ").trim()
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

function hashName(name: string) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return Math.abs(hash)
}

function Messenger(props: { data?: ChatData }) {
  const context = usePlugin()
  const theme = context.theme
  const project =
    props.data?.directory ?? context.location?.directory ?? process.cwd()

  const [rooms, setRooms] = createSignal<Room[]>([])
  const [selectedID, setSelectedID] = createSignal("")
  const [messages, setMessages] = createSignal<Message[]>([])
  const [composing, setComposing] = createSignal(false)
  const [wakeMode, setWakeMode] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [allProjects, setAllProjects] = createSignal(true)
  const [showArchived, setShowArchived] = createSignal(false)
  const [status, setStatus] = createSignal("")
  const [searchOpen, setSearchOpen] = createSignal(false)
  const [searching, setSearching] = createSignal(false)
  const [searchQuery, setSearchQuery] = createSignal("")
  const [searchHits, setSearchHits] = createSignal<SearchHit[]>([])
  const [selectedAgents, setSelectedAgents] = createSignal<
    Record<string, boolean>
  >({})

  let refreshing = false
  let loadSequence = 0
  let lastRoomID = ""
  let inputRef: any = null

  const currentRoom = () =>
    rooms().find((room) => room.id === selectedID()) ?? rooms()[0]

  const selectedNames = () => {
    const room = currentRoom()
    if (!room) return []
    return room.participants.filter((name) => selectedAgents()[name])
  }

  const selectedLabels = () => {
    const room = currentRoom()
    if (!room) return []
    return room.participantsDetail
      .filter((participant) => selectedAgents()[participant.id])
      .map((participant) => participant.label)
  }

  const notify = (message: string, variant: "info" | "error" = "info") => {
    context.ui.toast.show({ message, variant })
  }

  function senderColor(name: string) {
    if (name === "user") return theme.text.action.primary.base
    const palette = theme.categorical
    const color = palette[hashName(name) % palette.length]?.[400]
    return color ?? theme.text.base
  }

  function participantLabel(id: string) {
    if (id === "user") return "user"
    const room = currentRoom()
    return (
      room?.participantsDetail.find((participant) => participant.id === id)
        ?.label || id
    )
  }

  function statusGlyph(participant: Participant) {
    if (participant.dead) return "✖"
    if (participant.active) return "●"
    if (participant.bound) return "○"
    return "×"
  }

  function statusColor(participant: Participant) {
    if (participant.dead) return theme.text.feedback.error.base
    if (participant.active) return theme.text.feedback.success.base
    if (participant.bound) return theme.text.muted
    return theme.text.feedback.error.base
  }

  function participantState(participant: Participant) {
    if (participant.active) return "работает"
    if (participant.dead) return "сессия мертва"
    if (participant.bound) return "свободен"
    return "не привязан"
  }

  function button(
    label: string,
    onPress: () => void,
    tone: "primary" | "wake" | "muted" = "muted",
  ) {
    const fg =
      tone === "primary"
        ? theme.text.action.primary.base
        : tone === "wake"
          ? theme.text.feedback.warning.base
          : theme.text.muted
    return (
      <box
        flexDirection="row"
        flexShrink={0}
        marginRight={1}
        onMouseDown={onPress}
      >
        <text fg={fg}>{label}</text>
      </box>
    )
  }

  function syncSelection(room: Room) {
    const previous = selectedAgents()
    const next: Record<string, boolean> = {}
    for (const name of room.participants) {
      next[name] = room.id === lastRoomID ? (previous[name] ?? true) : true
    }
    lastRoomID = room.id
    setSelectedAgents(next)
  }

  async function loadMessages(room: Room, markRead: boolean) {
    const sequence = ++loadSequence
    try {
      const data = markRead
        ? await runJson<MessagesResult>(
            ["read", room.id, "--from", "user"],
            room.project,
          )
        : await runJson<MessagesResult>(
            ["messages", room.id, "-n", "100"],
            room.project,
          )
      if (sequence !== loadSequence) return
      setMessages(data.messages.filter((message) => message.kind !== "system"))
    } catch (error) {
      if (sequence === loadSequence) setStatus(String(error))
    }
  }

  async function refresh() {
    if (refreshing) return
    refreshing = true
    try {
      const data = await runJson<Snapshot>(
        [
          "snapshot",
          ...(allProjects() ? ["--all"] : []),
          ...(showArchived() ? ["--include-archived"] : []),
        ],
        project,
      )
      setRooms(data.rooms)
      const room = currentRoom()
      if (!room) {
        setSelectedID("")
        setMessages([])
      } else {
        if (!data.rooms.some((item) => item.id === selectedID())) {
          setSelectedID(room.id)
        }
        syncSelection(room)
        await loadMessages(room, false)
      }
    } catch (error) {
      setStatus(String(error))
    } finally {
      refreshing = false
    }
  }

  function selectRoom(id: string) {
    if (!id) return
    closeSearch()
    setSelectedID(id)
    const room = rooms().find((item) => item.id === id)
    if (room) {
      syncSelection(room)
      void loadMessages(room, true)
    }
  }

  function move(delta: number) {
    const list = rooms()
    if (!list.length) return
    const index = Math.max(
      0,
      list.findIndex((room) => room.id === selectedID()),
    )
    const next = Math.min(list.length - 1, Math.max(0, index + delta))
    if (list[next]) selectRoom(list[next].id)
  }

  function toggleAgent(name: string) {
    setSelectedAgents((previous) => ({
      ...previous,
      [name]: !previous[name],
    }))
  }

  function selectAll(value: boolean) {
    const room = currentRoom()
    if (!room) return
    const next: Record<string, boolean> = {}
    for (const name of room.participants) next[name] = value
    setSelectedAgents(next)
  }

  function compose(mode: "say" | "wake") {
    setWakeMode(mode === "wake")
    setComposing(true)
    setStatus(
      mode === "wake"
        ? "Пробуждение выбранных участников"
        : "Сообщение выбранным участникам",
    )
    setTimeout(() => inputRef?.focus?.(), 50)
  }

  async function send(value?: string) {
    const text = (value ?? draft()).trim()
    const room = currentRoom()
    const targets = selectedNames()
    if (!room || !text) return
    if (wakeMode() && !targets.length) {
      notify("Выбери, кого будить", "error")
      return
    }

    const roomOnly = !wakeMode() && !targets.length
    setComposing(false)
    setDraft("")

    const textFile = path.join(
      os.tmpdir(),
      `agent-chat-${process.pid}-${Date.now()}.txt`,
    )
    setStatus(
      wakeMode()
        ? "Бужу…"
        : roomOnly
          ? "Записываю в чат без получателей…"
          : "Отправляю…",
    )
    try {
      await writeFile(textFile, text, "utf8")
      const args = wakeMode()
        ? [
            "wake",
            room.id,
            "--text-file",
            textFile,
            "--from",
            "user",
            "--to",
            targets.join(","),
            "--timeout",
            "300",
          ]
        : [
            "say",
            room.id,
            "--text-file",
            textFile,
            ...(roomOnly
              ? ["--room-only"]
              : ["--to", targets.join(",")]),
            "--timeout",
            "300",
          ]
      const data = await runJson<DeliveryResult>(args, room.project)
      const failed = data.message?.failed ?? []
      setStatus(
        failed.length
          ? `Не доставлено: ${failed.map((item) => item.agent).join(", ")}`
          : roomOnly
            ? "Записано в чат без получателей"
            : wakeMode()
              ? "Разбудил выбранных"
              : "Отправлено",
      )
      await loadMessages(room, true)
      await refresh()
    } catch (error) {
      setStatus(String(error))
      notify(String(error), "error")
    } finally {
      await rm(textFile, { force: true }).catch(() => {})
    }
  }

  async function editRoom() {
    const room = currentRoom()
    if (!room) return
    const name = await context.ui.dialog.prompt({
      title: "Название чата",
      value: room.name,
    })
    if (name === undefined) return
    const description = await context.ui.dialog.prompt({
      title: "Описание чата",
      description: "Пустая строка уберёт описание",
      value: room.description ?? "",
    })
    if (description === undefined) return
    try {
      await runJson(
        [
          "update",
          room.id,
          "--name",
          name.trim() || room.name,
          "--description",
          description,
          "--from",
          "user",
        ],
        room.project,
      )
      setStatus("Чат обновлён")
      await refresh()
    } catch (error) {
      notify(String(error), "error")
    }
  }

  async function newRoom() {
    const name = await context.ui.dialog.prompt({
      title: "Новый чат",
      placeholder: "например release-1.2",
    })
    if (!name?.trim()) return
    const description = await context.ui.dialog.prompt({
      title: "Описание",
      description: "Можно оставить пустым",
      value: "",
    })
    if (description === undefined) return
    try {
      const data = await runJson<{ room: Room }>(
        [
          "create",
          name.trim(),
          "--description",
          description,
          "--from",
          "user",
        ],
        project,
      )
      setStatus(`Создан чат «${data.room.name}»`)
      await refresh()
      selectRoom(data.room.id)
    } catch (error) {
      notify(String(error), "error")
    }
  }

  async function invite() {
    const room = currentRoom()
    if (!room) return
    const value = await context.ui.dialog.prompt({
      title: `Пригласить в «${room.name}»`,
      placeholder: "tester, searcher",
    })
    if (!value?.trim()) return
    const names = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    if (!names.length) return
    try {
      await runRaw(
        ["invite", room.id, ...names, "--from", "user"],
        room.project,
      )
      setStatus(`Приглашены: ${names.join(", ")}`)
      await refresh()
    } catch (error) {
      notify(String(error), "error")
    }
  }

  async function archiveRoom() {
    const room = currentRoom()
    if (!room) return
    const command = room.archivedAt ? "unarchive" : "archive"
    try {
      await runRaw([command, room.id, "--from", "user"], room.project)
      setStatus(room.archivedAt ? "Возвращено из архива" : "Убрано в архив")
      await refresh()
    } catch (error) {
      notify(String(error), "error")
    }
  }

  async function deleteRoom() {
    const room = currentRoom()
    if (!room) return
    const answer = await context.ui.dialog.prompt({
      title: `Удалить «${room.name}»?`,
      description: "История уйдёт в trash. Напиши DELETE для подтверждения",
      placeholder: "DELETE",
    })
    if ((answer ?? "").trim() !== "DELETE") {
      setStatus("Удаление отменено")
      return
    }
    try {
      await runRaw(["delete", room.id, "--yes"], room.project)
      setStatus("Чат удалён")
      await refresh()
    } catch (error) {
      notify(String(error), "error")
    }
  }

  async function searchMessages() {
    const query = await context.ui.dialog.prompt({
      title: "Поиск по сообщениям",
      placeholder: "текст, @file:путь, @test:название",
    })
    if (!query?.trim()) return
    setSearchQuery(query.trim())
    setSearchOpen(true)
    setSearching(true)
    setSearchHits([])
    try {
      const data = await runJson<SearchResult>(
        [
          "search",
          query.trim(),
          "--limit",
          "50",
          ...(allProjects() ? [] : ["--current"]),
          ...(showArchived() ? ["--include-archived"] : []),
        ],
        project,
      )
      setSearchHits(data.results)
      setStatus(`Найдено: ${data.count}`)
    } catch (error) {
      setStatus(String(error))
      notify(String(error), "error")
    } finally {
      setSearching(false)
    }
  }

  function closeSearch() {
    setSearchOpen(false)
    setSearchQuery("")
    setSearchHits([])
  }

  function openSearchHit(hit: SearchHit) {
    const room = rooms().find((item) => item.id === hit.room.id)
    if (!room) {
      setStatus("Комната не в списке: включи [Архив] и обнови")
      return
    }
    closeSearch()
    selectRoom(room.id)
  }

  function toggleAllProjects() {
    setAllProjects((value) => !value)
    void refresh()
  }

  function toggleArchived() {
    setShowArchived((value) => !value)
    void refresh()
  }

  function composerLabel() {
    const labels = selectedLabels()
    const who = labels.length
      ? shortText(labels.join(", "), 24)
      : wakeMode()
        ? "выбери участника"
        : "только в чат"
    return wakeMode() ? `Пробуждение → ${who}` : `Сообщение → ${who}`
  }

  function close() {
    if (props.data?.sessionID) {
      context.ui.router.navigate({
        type: "session",
        sessionID: props.data.sessionID,
      })
    } else {
      context.ui.router.navigate({ type: "home" })
    }
  }

  onMount(() => {
    void (async () => {
      if (props.data?.sessionID && props.data?.agent) {
        try {
          await runRaw(
            [
              "bind",
              props.data.agent,
              "--session",
              props.data.sessionID,
              "--yes",
            ],
            project,
          )
        } catch {
          // The window can still use the messenger read-only.
        }
      }
      await refresh()
      const room = currentRoom()
      if (room) selectRoom(room.id)
    })()

    const timer = setInterval(() => {
      void refresh()
    }, 1500)
    onCleanup(() => clearInterval(timer))
  })

  context.keymap.layer(() => ({
    mode: "global",
    priority: 20,
    enabled: () => !composing(),
    commands: [
      { id: "agent-chat.down", bind: "j", run: () => move(1) },
      { id: "agent-chat.up", bind: "k", run: () => move(-1) },
      {
        id: "agent-chat.open-room",
        bind: "return",
        run: () => compose("say"),
      },
      { id: "agent-chat.compose-say", bind: "m", run: () => compose("say") },
      {
        id: "agent-chat.compose-wake",
        bind: "w",
        run: () => compose("wake"),
      },
      { id: "agent-chat.new-room", bind: "n", run: () => void newRoom() },
      { id: "agent-chat.invite", bind: "i", run: () => void invite() },
      { id: "agent-chat.edit-room", bind: "e", run: () => void editRoom() },
      { id: "agent-chat.search", bind: "f", run: () => void searchMessages() },
      {
        id: "agent-chat.all-agents",
        bind: "t",
        run: () => selectAll(!selectedNames().length),
      },
      {
        id: "agent-chat.all-projects",
        bind: "a",
        run: () => toggleAllProjects(),
      },
      { id: "agent-chat.refresh", bind: "r", run: () => void refresh() },
      { id: "agent-chat.close", bind: "escape", run: () => close() },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `agent-chat.toggle-${index + 1}`,
        bind: String(index + 1),
        run: () => {
          const participant = currentRoom()?.participants[index]
          if (participant) toggleAgent(participant)
        },
      })),
    ],
  }))

  context.keymap.layer(() => ({
    mode: "global",
    priority: 30,
    enabled: () => composing(),
    commands: [
      {
        id: "agent-chat.cancel",
        bind: "escape",
        run: () => {
          setComposing(false)
          setDraft("")
        },
      },
    ],
  }))

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      backgroundColor={theme.background.base}
    >
      <box
        flexDirection="row"
        height={1}
        paddingLeft={2}
        paddingRight={1}
        backgroundColor={theme.background.raised.base}
        flexShrink={0}
      >
        <text fg={theme.text.action.primary.base}>Agent Chat</text>
        <text fg={theme.text.muted}>
          {"  "}
          {shortText(path.basename(project), 20)} · {rooms().length} чат
        </text>
        <box flexGrow={1} />
        {button("[+ Чат]", () => void newRoom(), "primary")}
        {button("[Проекты]", () => toggleAllProjects())}
        {button(
          "[Архив]",
          () => toggleArchived(),
          showArchived() ? "primary" : "muted",
        )}
        {button("[Обновить]", () => void refresh())}
        {button("[Назад]", () => close())}
      </box>
      <box
        height={1}
        border={["bottom"]}
        borderColor={theme.border.base}
        flexShrink={0}
      />

      <box flexDirection="row" flexGrow={1}>
        <box
          width={18}
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
          border={["right"]}
          borderColor={theme.border.base}
          flexShrink={0}
        >
          <text fg={theme.text.muted}>Чаты</text>
          <Show
            when={rooms().length > 0}
            fallback={<text fg={theme.text.muted}>Нет чатов</text>}
          >
            <scrollbox flexGrow={1}>
              <For each={rooms()}>
                {(room) => (
                  <box
                    flexDirection="column"
                    paddingLeft={1}
                    paddingRight={1}
                    marginTop={1}
                    flexShrink={0}
                    backgroundColor={
                      room.id === currentRoom()?.id
                        ? theme.background.raised.base
                        : undefined
                    }
                    onMouseDown={() => selectRoom(room.id)}
                  >
                    <text
                      fg={
                        room.unread > 0
                          ? theme.text.action.primary.base
                          : theme.text.base
                      }
                      flexShrink={0}
                    >
                      {room.unread > 0 ? "● " : "  "}
                      {shortText(room.name, 13)}
                    </text>
                    <text
                      fg={
                        room.archivedAt
                          ? theme.text.feedback.warning.base
                          : theme.text.muted
                      }
                      flexShrink={0}
                    >
                      {room.archivedAt
                        ? "архив"
                        : room.project.toLowerCase() !== project.toLowerCase()
                          ? `[${room.projectAlias ?? "other"}]`
                          : `${room.participants.length} уч.`}
                    </text>
                  </box>
                )}
              </For>
            </scrollbox>
          </Show>
        </box>

        <box
          flexGrow={1}
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
        >
          <Show
            when={currentRoom()}
            fallback={
              <text fg={theme.text.muted}>
                Создай чат кнопкой [+ Чат].
              </text>
            }
          >
            {(room) => (
              <>
                <box flexDirection="row" height={1} flexShrink={0}>
                  <text
                    fg={theme.text.action.primary.base}
                    flexShrink={0}
                  >
                    {shortText(room().name, 14)}
                  </text>
                  <text fg={theme.text.muted} flexShrink={0}>
                    {"  "}
                    {room().participants.length} уч.
                  </text>
                  <Show when={room().archivedAt}>
                    <text
                      fg={theme.text.feedback.warning.base}
                      flexShrink={0}
                    >
                      {"  "}[архив]
                    </text>
                  </Show>
                  <Show
                    when={
                      room().project.toLowerCase() !== project.toLowerCase()
                    }
                  >
                    <text
                      fg={theme.text.feedback.warning.base}
                      flexShrink={0}
                    >
                      {"  "}
                      [{room().projectAlias ?? "other"}]
                    </text>
                  </Show>
                  <box flexGrow={1} />
                  {button("[Изм.]", () => void editRoom())}
                </box>
                <Show when={room().description}>
                  <text fg={theme.text.muted} flexShrink={0}>
                    {shortText(room().description ?? "", 28)}
                  </text>
                </Show>
                <box
                  height={1}
                  border={["bottom"]}
                  borderColor={theme.border.base}
                  flexShrink={0}
                />

                <Show
                  when={!searchOpen()}
                  fallback={
                    <box flexDirection="column" flexGrow={1}>
                      <box flexDirection="row" flexShrink={0}>
                        <text fg={theme.text.action.primary.base}>
                          Поиск: {shortText(searchQuery(), 20)}
                        </text>
                        <box flexGrow={1} />
                        {button("[Закрыть]", () => closeSearch())}
                      </box>
                      <scrollbox flexGrow={1}>
                        <Show
                          when={!searching()}
                          fallback={
                            <text fg={theme.text.muted}>Ищу…</text>
                          }
                        >
                          <Show
                            when={searchHits().length > 0}
                            fallback={
                              <text fg={theme.text.muted}>
                                Ничего не найдено
                              </text>
                            }
                          >
                            <For each={searchHits()}>
                              {(hit) => (
                                <box
                                  flexDirection="column"
                                  marginBottom={1}
                                  flexShrink={0}
                                  onMouseDown={() => openSearchHit(hit)}
                                >
                                  <box flexDirection="row">
                                    <text
                                      fg={theme.text.action.primary.base}
                                      flexShrink={0}
                                    >
                                      {shortText(hit.room.name, 18)}
                                      {hit.room.archived ? " [архив]" : ""}
                                    </text>
                                    <text
                                      fg={theme.text.muted}
                                      flexShrink={0}
                                    >
                                      {" · "}
                                      {shortTime(hit.message.ts)}
                                      {" · "}
                                      {shortText(hit.message.from, 14)}
                                    </text>
                                  </box>
                                  <text fg={theme.text.base}>
                                    {shortText(
                                      hit.snippet || hit.message.text,
                                      110,
                                    )}
                                  </text>
                                  <For each={hit.message.refs ?? []}>
                                    {(ref) => (
                                      <text fg={theme.text.muted}>
                                        {"  ↳ "}
                                        {ref.kind}:{" "}
                                        {shortText(ref.value, 70)}
                                      </text>
                                    )}
                                  </For>
                                </box>
                              )}
                            </For>
                          </Show>
                        </Show>
                      </scrollbox>
                    </box>
                  }
                >
                  <scrollbox
                    flexGrow={1}
                    stickyScroll
                    stickyStart="bottom"
                  >
                    <For each={messages()}>
                      {(message) => (
                        <box
                          flexDirection="column"
                          marginBottom={1}
                          flexShrink={0}
                        >
                          <box flexDirection="row" flexShrink={0}>
                            <text
                              fg={senderColor(message.from)}
                              flexShrink={0}
                            >
                              {shortText(participantLabel(message.from), 24)}
                            </text>
                            <text
                              fg={theme.text.muted}
                              flexShrink={0}
                            >
                              {" · "}
                              {shortTime(message.ts)}
                            </text>
                            <Show when={message.replyTo}>
                              <text
                                fg={theme.text.muted}
                                flexShrink={0}
                              >
                                {" · ответ"}
                              </text>
                            </Show>
                          </box>
                          <text fg={theme.text.base}>{message.text}</text>
                          <For each={message.refs ?? []}>
                            {(ref) => (
                              <text fg={theme.text.muted} flexShrink={0}>
                                {"  ↳ "}
                                {ref.kind}: {shortText(ref.value, 80)}
                              </text>
                            )}
                          </For>
                        </box>
                      )}
                    </For>
                  </scrollbox>
                </Show>

                <Show
                  when={!room().archivedAt}
                  fallback={
                    <box flexDirection="column" flexShrink={0} marginTop={1}>
                      <text fg={theme.text.feedback.warning.base}>
                        Чат в архиве — отправка недоступна
                      </text>
                      <box flexDirection="row">
                        {button(
                          "[Вернуть]",
                          () => void archiveRoom(),
                          "primary",
                        )}
                        {button(
                          "[Удалить]",
                          () => void deleteRoom(),
                          "wake",
                        )}
                        {button("[Поиск]", () => void searchMessages())}
                      </box>
                    </box>
                  }
                >
                <box flexDirection="column" flexShrink={0} marginTop={1}>
                  <Show
                    when={composing()}
                    fallback={
                      <box flexDirection="column" flexShrink={0}>
                        <box flexDirection="row">
                          {button(
                            "[Написать]",
                            () => compose("say"),
                            "primary",
                          )}
                          {button(
                            "[Разбудить]",
                            () => compose("wake"),
                            "wake",
                          )}
                        </box>
                        <box flexDirection="row">
                          {button("[Позвать]", () => void invite())}
                          {button(
                            "[Поиск]",
                            () => void searchMessages(),
                          )}
                          {button("[В архив]", () => void archiveRoom())}
                        </box>
                        {button(
                          "[Удал.]",
                          () => void deleteRoom(),
                          "wake",
                        )}
                      </box>
                    }
                  >
                    <text
                      fg={
                        wakeMode()
                          ? theme.text.feedback.warning.base
                          : theme.text.action.primary.base
                      }
                      flexShrink={0}
                    >
                      {composerLabel()}
                    </text>
                    <input
                      ref={(element) => {
                        inputRef = element
                      }}
                      focused
                      backgroundColor={theme.background.raised.base}
                      paddingLeft={1}
                      placeholder={
                        wakeMode()
                          ? "Текст пробуждения..."
                          : "Сообщение..."
                      }
                      value={draft()}
                      onInput={(value) => setDraft(value)}
                      onSubmit={(value) =>
                        void send(
                          typeof value === "string" ? value : draft(),
                        )
                      }
                    />
                    <box flexDirection="row" flexShrink={0}>
                      {button(
                        "[Отправить]",
                        () => void send(),
                        "primary",
                      )}
                      {button("[Отмена]", () => {
                        setComposing(false)
                        setDraft("")
                      })}
                    </box>
                  </Show>
                  <text fg={theme.text.muted} flexShrink={0}>
                    {shortText(
                      status() ||
                        (wakeMode()
                          ? selectedLabels().length
                            ? `Будить: ${selectedLabels().join(", ")}`
                            : "Разбудить: выбери участника"
                          : selectedLabels().length
                            ? `Получатели: ${selectedLabels().join(", ")}`
                            : "Получатели: никто — только в чат"),
                      28,
                    )}
                  </text>
                </box>
                </Show>
              </>
            )}
          </Show>
        </box>

        <Show when={currentRoom()}>
          {(room) => (
            <box
              width={28}
              flexDirection="column"
              border={["left"]}
              borderColor={theme.border.base}
              paddingLeft={1}
              paddingRight={1}
              flexShrink={0}
            >
              <text fg={theme.text.muted}>Участники</text>
              <scrollbox flexGrow={1}>
              <For each={room().participantsDetail}>
                {(participant) => (
                  <box
                    flexDirection="column"
                    marginTop={1}
                    onMouseDown={() => toggleAgent(participant.id)}
                  >
                    <box flexDirection="row">
                      <text
                        fg={
                          selectedAgents()[participant.id]
                            ? theme.text.action.primary.base
                            : theme.text.muted
                        }
                      >
                        {selectedAgents()[participant.id] ? "[x] " : "[ ] "}
                      </text>
                      <text fg={statusColor(participant)}>
                        {statusGlyph(participant)}
                      </text>
                      <Show when={participant.unread > 0}>
                        <text fg={theme.text.action.primary.base}>
                          {" "}
                          {participant.unread}
                        </text>
                      </Show>
                    </box>
                    <text fg={theme.text.base}>{participant.label}</text>
                    <text
                      fg={
                        participant.dead
                          ? theme.text.feedback.error.base
                          : theme.text.muted
                      }
                    >
                      {participantState(participant)}
                    </text>
                  </box>
                )}
              </For>
              </scrollbox>
              <box flexDirection="row" marginTop={1}>
                {button("[Все]", () => selectAll(true))}
                {button("[Никого]", () => selectAll(false))}
              </box>
            </box>
          )}
        </Show>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "agent-chat.tui",
  setup(context) {
    const unregisterRoute = context.ui.router.register({
      name: "agent-chat",
      render: (input) => <Messenger data={input.data} />,
    })

    const open = () => {
      const current = context.ui.router.current()
      const sessionID =
        current.type === "session" ? current.sessionID : undefined
      if (sessionID) {
        void context.data.session
          .sync(sessionID)
          .then(() => {
            const session = context.data.session.get(sessionID)
            context.ui.router.navigate({
              type: "plugin",
              name: "agent-chat",
              data: {
                sessionID,
                agent: session?.agent,
                directory: session?.location?.directory,
              },
            })
          })
          .catch(() => {
            context.ui.router.navigate({
              type: "plugin",
              name: "agent-chat",
              data: { sessionID, directory: context.location?.directory },
            })
          })
      } else {
        context.ui.router.navigate({ type: "plugin", name: "agent-chat" })
      }
    }

    const unregisterBadge = context.ui.slot({
      append: "home.footer.status",
      render: () => (
        <text fg={context.theme.text.muted} onMouseDown={open}>
          [agent-chat]
        </text>
      ),
    })

    const unregisterKeymap = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          priority: 15,
          commands: [
            {
              id: "agent-chat.open",
              title: "Agent Chat",
              description: "Открыть мини-мессенджер между агентами",
              group: "Agent Chat",
              bind: "ctrl+g",
              palette: true,
              slash: { name: "chat", aliases: ["chats", "messenger"] },
              suggested: true,
              run: () => open(),
            },
          ],
          bindings: ["agent-chat.open"],
        }))
        return null
      },
    })

    return () => {
      unregisterRoute()
      unregisterBadge()
      unregisterKeymap()
    }
  },
})
