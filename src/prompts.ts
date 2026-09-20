export function userPrompt(text: string, now: string, timezone: string): string {
  return `Сейчас: ${now}, timezone: ${timezone}.

Пользователь сказал:
${text}

Прочитай AGENTS.md. Обнови только нужные файлы состояния.
Добавь короткую запись в JOURNAL.md.
После этого полностью пересобери ACTUAL.md.
Сгруппируй ACTUAL.md по смыслу самих задач, вынеси самое важное наверх и не создавай пустые группы.
Затем обнови CARDS.md по правилам AGENTS.md. Карточки — временный слой над ACTUAL.md, а не замена сводки.
Создай или замени короткую response-карточку с последним полезным ответом. Для явного напоминания вычисли notificationAt от указанного времени, сохрани его в REMINDERS.md строго как \`- <same-card-id> | scheduled | <absolute ISO-8601 notificationAt> | <JSON-string reminder text>\` и создай ровно одну reminder-карточку. visibleUntil напоминания должен быть позже notificationAt.
Если пользователь просит что-либо присылать регулярно, добавь или обнови одну строку в RECURRING.md строго в формате:
- <stable-id> | enabled | <5-field cron> | <IANA timezone> | <JSON-строка с инструкцией>
Например: - recurring-motivation-10 | enabled | 0 10 * * * | Europe/Riga | "Напиши новый короткий мотивационный пост"
Не создавай заранее карточки для будущих повторов: сервер запустит инструкцию в назначенное время.
Не утверждай, что push-уведомление уже отправлено или доставлено: модель только сохраняет состояние, а фактическую APNs-доставку выполняет сервер.
Не выдумывай сведения, даты и задачи.`;
}

export function refreshPrompt(now: string, timezone: string): string {
  return `Сейчас: ${now}, timezone: ${timezone}.

Пересобери ACTUAL.md из MEMORY.md, TASKS.md и RECURRING.md.
Оставь только то, что актуально сегодня или в ближайшие дни.
Выбери конкретные заголовки групп по содержимому задач, поставь самое важное сверху и не создавай пустые группы.
Обнови CARDS.md: удали просроченные карточки. Не создавай общие мотивационные morning, lunch или evening карточки без сработавшего пользовательского события из RECURRING.md.
Не меняй остальные файлы без необходимости.`;
}

export function recurringPrompt(id: string, instruction: string, now: string, timezone: string): string {
  return `Сработало пользовательское повторяющееся событие ${id}.
Сейчас: ${now}, timezone: ${timezone}.
Инструкция пользователя: ${instruction}

Прочитай AGENTS.md и выполни инструкцию. Создай одну новую карточку в CARDS.md с occurrence-specific id, source: ${id}, visibleFrom: ${now}, notificationAt: ${now}, dismissible: true и разумным visibleUntil. Содержимое должно быть свежим для этого запуска, а не заранее заготовленным шаблоном. Полностью пересобери ACTUAL.md, не заменяя его карточкой. Добавь короткую запись в JOURNAL.md. Не изменяй расписание в RECURRING.md.`;
}
