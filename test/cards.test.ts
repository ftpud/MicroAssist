import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRelativeReminder, deleteReminder, dismissCard, parseCards, readReminderHistory, readSnapshot, serializeCards, type Card } from "../src/cards.js";

const card: Card = {
  id: "reminder-2026-09-20-1435",
  kind: "reminder",
  title: "Позвонить маме",
  bodyMarkdown: "**Через пять минут** позвонить маме.",
  priority: 90,
  createdAt: "2026-09-20T14:30:00+03:00",
  visibleFrom: "2026-09-20T14:30:00+03:00",
  visibleUntil: "2026-09-20T15:00:00+03:00",
  notificationAt: "2026-09-20T14:35:00+03:00",
  dismissible: true,
  kaomoji: "( •̀ᴗ•́ )و",
  source: "prompt",
};

test("cards survive Markdown serialization", () => {
  assert.deepEqual(parseCards(serializeCards([card])), [card]);
});

test("snapshot filters future, expired, and dismissed cards", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "cards-test-"));
  await writeFile(join(workspace, "ACTUAL.md"), "# Актуальное\n", "utf8");
  await writeFile(join(workspace, "CARDS.md"), serializeCards([card]), "utf8");
  await writeFile(join(workspace, "DISMISSED.md"), "# Dismissed cards\n", "utf8");
  const active = await readSnapshot(workspace, "Europe/Riga", new Date("2026-09-20T11:34:00Z"));
  assert.equal(active.cards.length, 1);
  await dismissCard(workspace, card.id, new Date("2026-09-20T11:34:30Z"));
  const dismissed = await readSnapshot(workspace, "Europe/Riga", new Date("2026-09-20T11:34:40Z"));
  assert.equal(dismissed.cards.length, 0);
  assert.match(await readFile(join(workspace, "DISMISSED.md"), "utf8"), new RegExp(card.id));
});

test("relative reminder is available before the background model turn", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "micro-assist-reminder-"));
  await writeFile(join(workspace, "ACTUAL.md"), "# Актуальное\n", "utf8");
  const now = new Date("2026-09-20T12:00:00.000Z");
  const card = await createRelativeReminder(workspace, "Напомни через 5 минут проверить духовку", now);
  assert.equal(card?.notificationAt, "2026-09-20T12:05:00.000Z");
  const snapshot = await readSnapshot(workspace, "Europe/Riga", now);
  assert.equal(snapshot.cards[0]?.id, card?.id);
  assert.equal((await readReminderHistory(workspace)).length, 1);
  assert.equal(await deleteReminder(workspace, card!.id), true);
  assert.equal((await readReminderHistory(workspace)).length, 0);
  assert.equal((await readSnapshot(workspace, "Europe/Riga", now)).cards.length, 0);
});

test("legacy model-written reminders are listed and deleted with their card", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "micro-assist-legacy-reminder-"));
  await writeFile(join(workspace, "ACTUAL.md"), "# Актуальное\n", "utf8");
  await writeFile(join(workspace, "CARDS.md"), serializeCards([card]), "utf8");
  await writeFile(join(workspace, "REMINDERS.md"), `# Reminders\n\n- ${card.notificationAt} — Позвонить маме\n`, "utf8");
  const reminders = await readReminderHistory(workspace);
  assert.equal(reminders[0]?.id, card.id);
  assert.equal(reminders[0]?.bodyMarkdown, "Позвонить маме");
  assert.equal(await deleteReminder(workspace, card.id), true);
  assert.equal((await readReminderHistory(workspace)).length, 0);
  assert.equal(parseCards(await readFile(join(workspace, "CARDS.md"), "utf8")).length, 0);
});

test("an immediate notification command creates a due reminder without waiting for Codex", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "micro-assist-immediate-notification-"));
  await writeFile(join(workspace, "ACTUAL.md"), "# Актуальное\n", "utf8");
  const now = new Date("2026-09-20T18:04:41.975Z");
  const created = await createRelativeReminder(workspace, "Отправь нотификацию я лох", now);
  assert.equal(created?.title, "Уведомление");
  assert.equal(created?.bodyMarkdown, "я лох");
  assert.equal(created?.notificationAt, now.toISOString());
  assert.equal((await readReminderHistory(workspace))[0]?.id, created?.id);
});
