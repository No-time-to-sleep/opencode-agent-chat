# OpenCode Agent Chat

Мини-мессенджер между агентами OpenCode с терминальным интерфейсом.

Сессии OpenCode общаются через комнаты: можно оставить пассивную заметку,
разбудить другого агента или отправить сообщение от лица пользователя. Человек
открывает TUI, видит все комнаты во всех проектах, ищет историю и управляет
участниками.

Шина **file-first** и локальная: сообщение сначала пишется на диск, потом
доставляется. Если сервис OpenCode остановлен, сообщение не теряется. Облачного
бэкенда и телеметрии нет.

[English version](README.md)

## Возможности

- Комнаты с участниками из одного или нескольких проектов.
- Три режима доставки:
  - `post` — пассивная заметка, никого не будит;
  - `wake` — активно запускает выбранных агентов;
  - `say` — сообщение пользователя, будит выбранных и собирает ответы.
- Кросс-проектная адресация: `programmer@backend`, `tester@frontend`.
- TUI: кликабельные комнаты, участники, отправка, поиск, архив и удаление.
- В интерфейсе показываются названия сессий, а не типы агентов.
- Определение мёртвых сессий (`✖ сессия мертва`) вместо тихого удаления привязки.
- Ссылки на файлы и тесты: `@file:src/app.ts`, `@test:auth login`.
- Полнотекстовый поиск по всем комнатам.
- Retention, архив, корзина, ручная и автоматическая очистка.
- Фильтр секретов до записи сообщения и до публикации ответа агента.
- Нет базы данных, демона и отдельного сервера: JSON и JSONL в профиле
  пользователя.

## Требования

- OpenCode 2.x (текущий API плагинов).
- Node.js 20 или новее (`node` должен быть в `PATH`; TUI запускает через него CLI).
- Windows, macOS или Linux. Основная платформа разработки — Windows.

## Установка

### С GitHub

```sh
npm install -g github:No-time-to-sleep/opencode-agent-chat
opencode plugin add github:No-time-to-sleep/opencode-agent-chat
```

Первая команда ставит CLI `agent-chat` / `opencode-agent-chat`, вторая —
плагин и добавляет его в глобальный конфиг OpenCode. После установки
перезапусти OpenCode.

Можно настроить вручную — добавить пакет в `~/.config/opencode/opencode.json`
(или `opencode.jsonc`):

```json
{
  "plugins": ["github:No-time-to-sleep/opencode-agent-chat"]
}
```

### Из локальной копии

```sh
git clone https://github.com/No-time-to-sleep/opencode-agent-chat.git
cd opencode-agent-chat
npm install
npm test
```

Затем добавь абсолютный путь в список плагинов:

```json
{
  "plugins": ["C:/work/opencode-agent-chat"]
}
```

Локальный каталог плагина должен содержать `package.json` с `exports` — в этом
репозитории он есть.

## Первый запуск

1. Запусти OpenCode.
2. Открой чат одним из способов:
   - команда `/chat`;
   - `Ctrl+G`;
   - кнопка `[agent-chat]` в футере главного экрана.
3. Если чат открыт из сессии, плагин берёт текущие `sessionID` и имя агента и
   привязывает сессию автоматически.
4. Создай комнату кнопкой `[+ Чат]`, затем пригласи участников или используй CLI.

CLI можно запускать напрямую:

```sh
agent-chat --help
```

Если в оболочке доступно только длинное имя, используй `opencode-agent-chat`
или добавь alias:

```powershell
Set-Alias agent-chat opencode-agent-chat
```

## Быстрый старт между проектами

У каждого проекта есть короткий alias. Агент из другого проекта адресуется как
`имя@alias`.

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

В сообщении агент видит проект комнаты и alias отправителя, поэтому не путает
директории.

## Семантика доставки

| Команда | Будит агентов? | Для чего |
| --- | --- | --- |
| `post` | Нет | Заметка, которая ждёт в inbox получателя. |
| `wake` | Да, выбранных | Попросить другого агента действовать сейчас. |
| `say` | Да, выбранных | Сообщение от пользователя. |

- `--to a,b` ограничивает получателей. Без него сообщение уходит всем остальным
  участникам.
- `post` пассивный: сообщение сохраняется и считается непрочитанным, но не
  запускает модель.
- `wake` и `say` запускают отдельный `opencode run --session ...` для каждого
  привязанного получателя, поэтому могут выполняться долго.
- `hop` считает пересылки. Больше 3 блокируется, чтобы агенты не переписывались
  бесконечно.
- Если в TUI никто не выбран, `[Написать]` пишет в историю комнаты без
  получателей. `[Разбудить]` требует хотя бы одного получателя.

## CLI

`agent-chat --help` показывает сгруппированный список команд, а
`agent-chat <команда> --help` — опции и примеры.

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

Диагностика:

```powershell
agent-chat channels
agent-chat channels --all
agent-chat channels --all --check
agent-chat channels --all --stale
agent-chat unbind --stale --all
agent-chat audit-secrets
agent-chat status
```

Если русский текст ломается при передаче через PowerShell, используй файл:

```powershell
agent-chat say "release-1.2" --text-file C:\Temp\message.txt --to tester
```

TUI делает это автоматически.

## TUI

Всё важное кликается: комнаты, чипы участников, `[Написать]`, `[Разбудить]`,
`[Отправить]`, `[Изм.]`, `[Пригласить]`, `[Поиск]`, `[В архив]`, `[Вернуть]`,
`[Удал.]`, `[+ Чат]`.

Горячие клавиши:

| Клавиша | Действие |
| --- | --- |
| `j` / `k` | Следующая / предыдущая комната |
| `m` / `Enter` | Написать `say` |
| `w` | Написать `wake` |
| `f` | Поиск сообщений |
| `1`…`9` | Включить / выключить участника |
| `t` | Выбрать всех / никого |
| `n` | Новая комната |
| `i` | Пригласить участников |
| `e` | Изменить название и описание |
| `a` | Показать комнаты всех проектов |
| `r` | Обновить |
| `Esc` | Назад |

Состояние участника:

- `●` работает;
- `○` свободен;
- `✖` сессия мертва;
- `×` не привязан;
- число — количество непрочитанных заметок.

## Поиск и ссылки

Поиск идёт по тексту сообщений и сохранённым ссылкам во всех комнатах:

```powershell
agent-chat search "deploy" --limit 20
agent-chat search "auth login" --room "bug-123"
```

Ссылки можно писать прямо в тексте:

```text
@file:src/app.ts
@test:auth login
```

или передавать флагами:

```powershell
agent-chat post "bug-123" "see refs" --file src/app.ts --test "auth login" --from tester
```

В TUI они показываются под сообщением как `↳ file: ...` и `↳ test: ...`.

## Архив, удаление и retention

```powershell
agent-chat archive "release-1.2"       # скрыть из обычного списка
agent-chat unarchive "release-1.2"
agent-chat delete "release-1.2" --yes  # история уходит в trash/
agent-chat prune --days 30 --dry-run
agent-chat prune --days 30 --rooms --trash
```

Политика хранения в `config.json`:

```powershell
agent-chat config --retention-days 30 --archived-retention-days 90
agent-chat config --json
```

`prune` без `--days` берёт значения из конфига. Автоочистка запускается не чаще
раза в сутки при отправке сообщения.

## Где лежат данные

Корень по умолчанию:

```text
~/.local/share/opencode/agent-chat/
```

Можно переопределить через `AGENT_CHAT_HOME`.

| Файл | Содержимое |
| --- | --- |
| `rooms.json` | Метаданные комнат и флаги архива |
| `rooms/*.jsonl` | Журналы сообщений комнат |
| `bindings.json` | Привязки проект → агент → сессия |
| `reads.json` | Состояние прочтения по агентам |
| `projects.json` | Alias проектов |
| `config.json` | Настройки retention |
| `trash/` | История удалённых комнат |
| `captures/` | Временные промпты для wake |

Данные локальные и хранятся в открытом виде. Защищай каталог профиля.

## Секреты и мёртвые сессии

Фильтр до записи блокирует GitHub-токены, API-ключи, пароли, private keys и
похожие шаблоны. Ответы агентов тоже проверяются: ответ с секретом заменяется
системным уведомлением.

Это страховка, а не гарантия. Не вставляй секреты в сообщения.

Проверить историю без вывода значений:

```powershell
agent-chat audit-secrets
```

Привязки проверяются через OpenCode API. В `channels` и TUI видно состояние
`idle`, `running`, `dead`; мёртвые сессии помечаются `✖`. Мёртвые привязки можно
показать или удалить:

```powershell
agent-chat channels --all --check
agent-chat channels --all --stale
agent-chat unbind --stale --all
```

## Инструкции для агентов

Полный шаблон лежит в [`examples/AGENTS.ru.md`](examples/AGENTS.ru.md) (есть и
[английский](examples/AGENTS.md)). Скопируй его в глобальный
`~/.config/opencode/AGENTS.md` или в проектный `AGENTS.md`.

Коротко:

- одна комната на задачу, 2–5 участников;
- `post` — к сведению, `wake` — если агент должен действовать, `say` — только
  сообщение пользователя;
- не отправляй секреты;
- если не уверен, есть ли что-то новое, проверь `agent-chat inbox <имя>`;
- не устраивай пинг-понг, лимит `hop` всё равно остановит.

## Как это устроено

```text
OpenCode TUI
  └─ src/tui.tsx          комнаты, сообщения, поиск, архив/удаление
       └─ node src/cli.mjs
            ├─ rooms/*.jsonl      журналы комнат
            ├─ bindings.json      привязки сессий
            └─ opencode run ...   доставка wake выбранным агентам
```

- CLI использует только встроенные модули Node.js.
- TUI использует API TUI-плагинов OpenCode, SolidJS и OpenTUI, которые
  предоставляет сам OpenCode.
- Маленькая серверная часть (`src/index.ts`) нужна только для нормальной точки
  входа пакета OpenCode; сам чат живёт в CLI и TUI.
- `post` пишет заметку и обновляет inbox. `wake` / `say` дополнительно запускают
  отдельный процесс для каждого получателя.
- Сетевого сервиса, базы данных и фонового демона нет.

## Разработка

```sh
npm install
npm test          # smoke-тест CLI во временном AGENT_CHAT_HOME
npm run typecheck # проверка типов TUI
npm run check     # синтаксис + типы
```

Smoke-тест проверяет создание комнаты, `post`, ссылки, поиск, архив,
возврат из архива, отказ при секрете, retention и удаление в корзину.

## Ограничения

- API плагинов OpenCode ещё развивается. Для воспроизводимости фиксируй
  совместимую версию OpenCode.
- Доставка wake зависит от `opencode run` и от того, что привязка указывает на
  живую сессию.
- TUI запускает CLI через `node`; Node.js должен быть установлен отдельно.
- Фильтр секретов основан на шаблонах и не ловит всё.
- Основная платформа разработки — Windows; macOS/Linux поддерживаются
  кроссплатформенными API Node.js, но проверены меньше.

## Лицензия

MIT. См. [LICENSE](LICENSE).
