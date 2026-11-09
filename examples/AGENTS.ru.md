# Agent Chat

Между сессиями OpenCode работает общая шина сообщений. Она нужна для
координации агентов и пользователя, а не для обычной болтовни.

## Проверь inbox

Если ты участвуешь в комнате:

```powershell
agent-chat rooms --from <твоё-имя>
agent-chat inbox <твоё-имя>
agent-chat read "<комната>" --from <твоё-имя>
```

`inbox` ищет непрочитанное по всем проектам, где ты участвуешь. `--all` для
этого не нужен.

## Комнаты

Комнаты должны быть небольшими и привязанными к задаче: обычно хватает 2–5
участников.

```powershell
agent-chat create "bug-123" --description "login regression" --from user --with programmer,tester
agent-chat invite "bug-123" reviewer --from programmer
```

Не добавляй в комнату все сессии. Каждое пробуждение — отдельный вызов модели.

## Отправка

- `post` — пассивная заметка. Никого не будит; получатель увидит её в `inbox`.
  Используй для FYI и статусов.
- `wake` — активно запускает выбранных агентов. Используй, если другой агент
  должен действовать сейчас.
- `say` — сообщение от лица пользователя. Используй только если тебя попросили
  говорить от имени пользователя.

```powershell
agent-chat post "bug-123" "build is green" --from tester
agent-chat wake "bug-123" "please review the branch" --from programmer --to reviewer
agent-chat say "bug-123" "ship it" --to programmer
```

`--to a,b` ограничивает получателей. Без него сообщение уходит всем остальным
участникам.

Если русский текст ломается в PowerShell, передай его файлом:

```powershell
agent-chat say "bug-123" --text-file C:\Temp\message.txt --to tester
```

## Кросс-проект

Агент из другого проекта адресуется как `имя@alias`:

```powershell
agent-chat wake "release-1.2" "check the build" --from programmer --to tester@frontend
```

В сообщении есть проект комнаты и alias отправителя, поэтому не путай
директории.

## Правила

- Не отправляй секреты, токены, пароли и содержимое `.env`. Фильтр блокирует
  частые шаблоны, но это не гарантия.
- Ссылайся на код и тесты через `@file:путь` и `@test:название` (или
  `--file` / `--test`).
- Не устраивай пинг-понг. После двух кругов отвечай коротко или остановись;
  `hop` больше 3 блокируется.
- Одна комната — одна задача. Когда задача закончена, архивируй комнату:
  `agent-chat archive "<комната>"`.
- Перед удалением предпочитай архив; `delete --yes` переносит историю в `trash/`.
- Не буди агентов вне задачи. Пассивный `post` дешевле и меньше мешает.

## Полезные команды

```powershell
agent-chat rooms --from <твоё-имя>
agent-chat read "<комната>" --from <твоё-имя>
agent-chat inbox <твоё-имя>
agent-chat search "deploy" --limit 20
agent-chat channels --all --stale
agent-chat audit-secrets
```
