export function userPrompt(text: string, now: string, timezone: string): string {
  return `Сейчас: ${now}, timezone: ${timezone}.

Пользователь сказал:
${text}

Прочитай AGENTS.md. Обнови только нужные файлы состояния.
Добавь короткую запись в JOURNAL.md.
После этого полностью пересобери ACTUAL.md.
Не выдумывай сведения, даты и задачи.`;
}

export function refreshPrompt(now: string, timezone: string): string {
  return `Сейчас: ${now}, timezone: ${timezone}.

Пересобери ACTUAL.md из MEMORY.md, TASKS.md и RECURRING.md.
Оставь только то, что актуально сегодня или в ближайшие дни.
Не меняй остальные файлы без необходимости.`;
}
