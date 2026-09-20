export function userPrompt(text: string, now: string, timezone: string): string {
  return `Сейчас: ${now}, timezone: ${timezone}.

Пользователь сказал:
${text}

Прочитай AGENTS.md. Обнови только нужные файлы состояния.
Добавь короткую запись в JOURNAL.md.
После этого полностью пересобери ACTUAL.md.
Затем обнови CARDS.md по правилам AGENTS.md. Карточки — временный слой над ACTUAL.md, а не замена сводки.
Создай или замени короткую response-карточку с последним полезным ответом. Для явного напоминания вычисли notificationAt от указанного времени, сохрани его в REMINDERS.md и создай ровно одну reminder-карточку. visibleUntil напоминания должен быть позже notificationAt.
Не выдумывай сведения, даты и задачи.`;
}

export function refreshPrompt(now: string, timezone: string): string {
  return `Сейчас: ${now}, timezone: ${timezone}.

Пересобери ACTUAL.md из MEMORY.md, TASKS.md и RECURRING.md.
Оставь только то, что актуально сегодня или в ближайшие дни.
Обнови CARDS.md: удали просроченные карточки и создай уместную morning, lunch или evening карточку только при наличии полезного содержания.
Не меняй остальные файлы без необходимости.`;
}
