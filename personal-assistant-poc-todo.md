# Personal Assistant — простой POC

## Что строим

Минимальный персональный ассистент из двух частей:

- **Сервер:** Node.js + Codex ACP + несколько Markdown-файлов.
- **iPhone:** диктовка текста и виджет, показывающий `ACTUAL.md`.

Модель принимает фразу, меняет Markdown-контекст и генерирует новый `ACTUAL.md`.

```text
Диктовка → POST /prompt → Codex ACP → *.md → ACTUAL.md → виджет
                                      ↑
                                cron несколько раз в день
```

Без БД, APNs, очередей, embeddings, отдельных task/reminder engines и сложного chat UI.

## Примеры

Фраза:

> Надо купить хлеб, молоко и зубную пасту.

Результат в `TASKS.md`:

```md
## Купить

- [ ] Хлеб
- [ ] Молоко
- [ ] Зубная паста
```

Фраза:

> Каждую среду мне надо почесать жопу.

Результат в `RECURRING.md`:

```md
## Каждую среду

- Почесать жопу.
```

В среду cron будит модель. Она получает текущую дату, читает файлы и добавляет дело в `ACTUAL.md`.

Модель не просыпается сама: cron — единственный механизм фонового обновления.

## Файлы состояния

```text
workspace/
├── AGENTS.md
├── MEMORY.md
├── TASKS.md
├── RECURRING.md
├── ACTUAL.md
└── JOURNAL.md
```

### `AGENTS.md`

Правила для Codex:

- `MEMORY.md` — устойчивые факты и предпочтения;
- `TASKS.md` — одноразовые дела и списки;
- `RECURRING.md` — повторяющиеся дела;
- `JOURNAL.md` — короткая история входящих фраз и изменений;
- `ACTUAL.md` — генерируемая сводка для виджета;
- после каждого изменения полностью пересобирать `ACTUAL.md`;
- не выдумывать даты и обязательства;
- не менять формат `ACTUAL.md`.

### `ACTUAL.md`

Единственный файл, который нужен клиенту:

```md
# Актуальное

_Обновлено: 20 сентября, 14:40_

## Сегодня

- Купить хлеб, молоко и зубную пасту.
- В 18:00 забрать посылку.

## Скоро

- В среду почесать жопу.
```

Ограничение: максимум 6–10 коротких пунктов. Это сводка, а не полный storage.

## Сервер

### Стек

- Node.js + TypeScript;
- Fastify;
- `@agentclientprotocol/codex-acp` subprocess;
- одна ACP session с `workspace/` как рабочей директорией;
- один mutex: одновременно выполняется только один model turn;
- `node-cron` или system cron;
- один bearer token.

### `POST /prompt`

```json
{
  "text": "Надо купить хлеб и молоко",
  "now": "2026-09-20T14:35:00+03:00",
  "timezone": "Europe/Riga"
}
```

Сервер:

1. Берёт mutex.
2. Передаёт фразу и текущее время в Codex ACP.
3. Codex обновляет нужные `.md`.
4. Codex пересобирает `ACTUAL.md`.
5. Сервер возвращает содержимое `ACTUAL.md`.

### `GET /actual.md`

Возвращает `ACTUAL.md` как `text/markdown`.

Желательно поддержать `ETag` и `304 Not Modified`, чтобы виджет не скачивал одинаковый файл.

### `GET /health`

Показывает, живы ли Node.js и ACP subprocess.

### Cron refresh

Запускать:

- утром;
- затем раз в 2 часа днём;
- сразу после каждого `/prompt`.

Cron передаёт модели текущие дату и timezone и просит заново собрать `ACTUAL.md`.

### Prompt обработки фразы

```text
Сейчас: {{now}}, timezone: {{timezone}}.

Пользователь сказал:
{{text}}

Прочитай AGENTS.md. Обнови только нужные файлы состояния.
Добавь короткую запись в JOURNAL.md.
После этого полностью пересобери ACTUAL.md.
Не выдумывай сведения, даты и задачи.
```

### Prompt cron refresh

```text
Сейчас: {{now}}, timezone: Europe/Riga.

Пересобери ACTUAL.md из MEMORY.md, TASKS.md и RECURRING.md.
Оставь только то, что актуально сегодня или в ближайшие дни.
Не меняй остальные файлы без необходимости.
```

## iPhone

### Диктовка

Самый простой путь:

1. Shortcut выполняет `Dictate Text`.
2. App Intent отправляет текст в `POST /prompt`.
3. После ответа приложение вызывает `WidgetCenter.shared.reloadAllTimelines()`.

Raw audio и server-side transcription в POC не нужны.

### Виджет

WidgetKit provider:

1. Делает `GET /actual.md`.
2. Сохраняет последний ответ в App Group cache.
3. Показывает первые 6–8 полезных строк.
4. Просит новый timeline через 1–2 часа.
5. Без сети показывает cache и время последнего обновления.

iOS может отложить запрошенный refresh, поэтому точное обновление каждые два часа не гарантируется. После диктовки обновление можно запросить явно.

## TODO — сервер

- [x] Создать Node.js TypeScript project.
- [x] Создать шесть Markdown-файлов.
- [x] Написать правила в `AGENTS.md`.
- [x] Запустить `codex-acp` subprocess.
- [x] Реализовать ACP initialize/session/prompt.
- [x] Добавить mutex для последовательных turn.
- [x] Реализовать bearer auth.
- [x] Реализовать `POST /prompt`.
- [x] Реализовать `GET /actual.md`.
- [x] Добавить `ETag`.
- [x] Реализовать cron refresh.
- [x] Реализовать `GET /health`.
- [x] Ограничить Codex доступом только к `workspace/`.
- [x] Делать ежедневный backup `workspace/`.
- [x] Запускать server через systemd или Docker restart policy.

## TODO — iPhone

- [x] Создать минимальное SwiftUI-приложение.
- [x] Создать WidgetKit extension.
- [x] Настроить App Group cache.
- [x] Загружать и показывать `/actual.md`.
- [x] Показывать cached версию без сети.
- [x] Создать App Intent `SendToAssistant`.
- [ ] Создать Shortcut `Dictate Text → SendToAssistant`.
- [x] После prompt обновлять timeline виджета.
- [x] Хранить server URL и bearer token в Keychain.

## Проверка POC

- [ ] «Купить хлеб и молоко» появляется в `TASKS.md` и виджете.
- [ ] «Хлеб купил» убирает хлеб из актуального.
- [ ] «Каждую среду …» записывается в `RECURRING.md`.
- [ ] В среду после cron refresh дело появляется в `ACTUAL.md`.
- [ ] «Запомни, что …» изменяет `MEMORY.md`.
- [ ] После restart весь контекст сохраняется.
- [ ] Два одновременных prompt не ломают файлы.
- [ ] Виджет работает с cache при недоступном server.

## Пока не делать

- БД;
- APNs и самостоятельные push;
- почту;
- геолокацию;
- tracking API;
- vector DB;
- сложный chatbox;
- несколько пользователей.

После успешного POC новые возможности добавляются MCP-серверами. Они дают Codex внешние данные и действия, но результат по-прежнему сводится в те же Markdown-файлы и `ACTUAL.md`.

## Definition of Done

POC готов, когда фраза, продиктованная через Shortcut, меняет Markdown-контекст на сервере, обновляет `ACTUAL.md` и появляется в виджете. Повторяющееся дело должно само попасть туда в правильный день после cron refresh.
