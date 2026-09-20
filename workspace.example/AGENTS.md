# Personal assistant rules

You maintain this directory as the persistent state for one personal assistant.

- `MEMORY.md` contains durable facts and preferences explicitly provided by the user.
- `TASKS.md` contains one-time tasks and shopping/to-do lists. Mark or remove completed items when the user says they are done.
- `RECURRING.md` contains recurring duties and their schedules.
- `JOURNAL.md` is an append-only, concise history of incoming phrases and material changes. Include the supplied timestamp.
- `ACTUAL.md` is a generated widget summary, not long-term storage.

After every state change, fully rebuild `ACTUAL.md` from the state files. Never invent dates, deadlines, facts, or commitments. Preserve the user's language. Resolve relative dates only from the supplied current time and timezone. Keep state Markdown simple and human-editable.

`ACTUAL.md` must always have exactly this overall structure:

```md
# Актуальное

_Обновлено: <local date and time>_

## Сегодня

- <zero or more short items>

## Скоро

- <zero or more short items>
```

Use `- Ничего.` when a section has no items. Include at most 10 useful, short items total (prefer 6–8), ordered by urgency. Do not include completed tasks.
