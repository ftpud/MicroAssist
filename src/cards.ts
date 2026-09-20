import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const cardKinds = ["actual", "response", "reminder", "morning", "lunch", "evening", "notice"] as const;
export type CardKind = (typeof cardKinds)[number];

export interface Card {
  id: string;
  kind: CardKind;
  title: string;
  bodyMarkdown: string;
  priority: number;
  createdAt: string;
  visibleFrom?: string;
  visibleUntil?: string;
  notificationAt?: string;
  dismissible: boolean;
  kaomoji?: string;
  source: string;
}

export interface Snapshot {
  schemaVersion: 1;
  version: string;
  generatedAt: string;
  timezone: string;
  actualMarkdown: string;
  cards: Card[];
}

function scalar(value: string): unknown {
  const trimmed = value.trim();
  try { return JSON.parse(trimmed); } catch { return trimmed.replace(/^['"]|['"]$/g, ""); }
}

function metadata(block: string): Record<string, unknown> {
  return Object.fromEntries(block.split("\n").flatMap((line) => {
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    return match ? [[match[1]!, scalar(match[2]!)]] : [];
  }));
}

function iso(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${field} must be ISO-8601`);
  return value;
}

export function parseCards(markdown: string): Card[] {
  const starts = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  return starts.map((start, index) => {
    const section = markdown.slice(start.index!, starts[index + 1]?.index ?? markdown.length);
    const match = section.match(/^##\s+.+\n+```ya?ml\n([\s\S]*?)\n```\n*([\s\S]*)$/);
    if (!match) throw new Error(`Invalid card section: ${start[1]}`);
    const meta = metadata(match[1]!);
    const id = String(meta.id ?? start[1]).trim();
    const kind = String(meta.kind ?? "notice") as CardKind;
    const title = String(meta.title ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(id)) throw new Error(`Invalid card id: ${id}`);
    if (!cardKinds.includes(kind)) throw new Error(`Invalid card kind: ${kind}`);
    if (!title || title.length > 120) throw new Error(`Invalid title for card ${id}`);
    const createdAt = iso(meta.createdAt, "createdAt", true)!;
    const visibleFrom = iso(meta.visibleFrom, "visibleFrom");
    const visibleUntil = iso(meta.visibleUntil, "visibleUntil");
    const notificationAt = iso(meta.notificationAt, "notificationAt");
    if (visibleFrom && visibleUntil && Date.parse(visibleFrom) >= Date.parse(visibleUntil)) {
      throw new Error(`Invalid visibility range for card ${id}`);
    }
    return {
      id, kind, title, bodyMarkdown: match[2]!.trim(),
      priority: Math.max(-100, Math.min(100, Number(meta.priority ?? 0))),
      createdAt, visibleFrom, visibleUntil, notificationAt,
      dismissible: meta.dismissible !== false && meta.dismissible !== "false",
      kaomoji: meta.kaomoji ? String(meta.kaomoji) : undefined,
      source: String(meta.source ?? "system"),
    };
  });
}

export function serializeCards(cards: Card[]): string {
  const sections = cards.map((card) => {
    const values: Array<[string, unknown]> = [
      ["id", card.id], ["kind", card.kind], ["title", card.title], ["priority", card.priority],
      ["createdAt", card.createdAt], ["visibleFrom", card.visibleFrom], ["visibleUntil", card.visibleUntil],
      ["notificationAt", card.notificationAt], ["dismissible", card.dismissible], ["kaomoji", card.kaomoji],
      ["source", card.source],
    ];
    const yaml = values.filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n");
    return `## ${card.id}\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n${card.bodyMarkdown}\n`;
  });
  return `# Cards\n\n${sections.join("\n")}`;
}

export function parseDismissed(markdown: string): Set<string> {
  return new Set([...markdown.matchAll(/^-\s+([^|\s]+)\s+\|/gm)].map((match) => match[1]!));
}

async function optionalFile(path: string, fallback: string): Promise<string> {
  try { return await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function readAllCards(workspace: string): Promise<Card[]> {
  return parseCards(await optionalFile(join(workspace, "CARDS.md"), "# Cards\n"));
}

export async function readSnapshot(workspace: string, timezone: string, now = new Date()): Promise<Snapshot> {
  const [actualMarkdown, cardMarkdown, dismissedMarkdown] = await Promise.all([
    readFile(join(workspace, "ACTUAL.md"), "utf8"),
    optionalFile(join(workspace, "CARDS.md"), "# Cards\n"),
    optionalFile(join(workspace, "DISMISSED.md"), "# Dismissed cards\n"),
  ]);
  const dismissed = parseDismissed(dismissedMarkdown);
  const time = now.getTime();
  const seen = new Set<string>();
  const cards = parseCards(cardMarkdown).filter((card) => {
    if (seen.has(card.id)) throw new Error(`Duplicate card id: ${card.id}`);
    seen.add(card.id);
    return !dismissed.has(card.id)
      && (!card.visibleFrom || Date.parse(card.visibleFrom) <= time)
      && (!card.visibleUntil || Date.parse(card.visibleUntil) > time);
  }).sort((a, b) => b.priority - a.priority || Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 10);
  const material = JSON.stringify({ actualMarkdown, cards, timezone });
  return {
    schemaVersion: 1,
    version: createHash("sha256").update(material).digest("base64url"),
    generatedAt: now.toISOString(),
    timezone,
    actualMarkdown,
    cards,
  };
}

export async function dismissCard(workspace: string, cardId: string, now = new Date()): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(cardId)) throw new Error("Invalid card id");
  const path = join(workspace, "DISMISSED.md");
  const existing = await optionalFile(path, "# Dismissed cards\n\n");
  if (parseDismissed(existing).has(cardId)) return;
  await appendFile(path, `- ${cardId} | ${now.toISOString()}\n`, "utf8");
}

/** Creates the common relative reminder synchronously, so the client can
 * schedule a local notification without waiting for a model turn. */
export async function createRelativeReminder(workspace: string, text: string, now: Date): Promise<Card | undefined> {
  const match = text.match(/(?:через|in)\s+(\d{1,5})\s*(минут(?:у|ы)?|мин|minutes?|mins?|час(?:а|ов)?|hours?|hrs?)/iu);
  const immediate = text.match(/(?:отправь|пришли|покажи|сделай)\s+(?:мне\s+)?(?:нотификаци[а-яё]*|уведомлени[а-яё]*)\s*(?::|с\s+текстом|что)?\s*(.*)$/iu)
    ?? text.match(/напомни\s+(?:мне\s+)?(?:сейчас|прямо\s+сейчас)\s*(.*)$/iu);
  if (!match && !immediate) return undefined;
  const amount = match ? Number(match[1]) : 0;
  const hours = match ? /час|hour|hr/iu.test(match[2]!) : false;
  const delay = match ? amount * (hours ? 60 * 60_000 : 60_000) : 0;
  if (!Number.isSafeInteger(delay) || (match && delay < 60_000) || delay > 365 * 24 * 60 * 60_000) return undefined;

  const notificationAt = new Date(now.getTime() + delay);
  const reminderText = immediate?.[1]?.trim() || text.trim();
  const digest = createHash("sha256").update(`${text.trim()}\n${notificationAt.toISOString()}`).digest("hex").slice(0, 20);
  const card: Card = {
    id: `reminder-${digest}`,
    kind: "reminder",
    title: immediate ? "Уведомление" : "Напоминание",
    bodyMarkdown: reminderText,
    priority: 100,
    createdAt: now.toISOString(),
    visibleFrom: now.toISOString(),
    visibleUntil: new Date(notificationAt.getTime() + 24 * 60 * 60_000).toISOString(),
    notificationAt: notificationAt.toISOString(),
    dismissible: true,
    kaomoji: "( •̀ᴗ•́ )و",
    source: "prompt",
  };
  const path = join(workspace, "CARDS.md");
  const existing = parseCards(await optionalFile(path, "# Cards\n"));
  if (!existing.some((candidate) => candidate.id === card.id)) {
    await writeFile(path, serializeCards([card, ...existing]), "utf8");
  }
  const reminderPath = join(workspace, "REMINDERS.md");
  const reminderState = await optionalFile(reminderPath, "# Reminders\n\n");
  if (!reminderState.includes(`- ${card.id} |`)) {
    await appendFile(reminderPath, `- ${card.id} | scheduled | ${card.notificationAt} | ${JSON.stringify(reminderText)}\n`, "utf8");
  }
  return card;
}

export async function readReminderHistory(workspace: string): Promise<Card[]> {
  const content = await optionalFile(join(workspace, "REMINDERS.md"), "# Reminders\n");
  const cards = await readAllCards(workspace);
  return content.split("\n").flatMap((line) => {
    const current = line.match(/^-\s+([^|\s]+)\s+\|\s+([^|]+)\s+\|\s+([^|]+)\s+\|\s+(.+)$/);
    const legacy = line.match(/^-\s+(\S+)\s+[—–-]\s+(.+)$/);
    const notificationAt = current?.[3]?.trim() ?? legacy?.[1]?.trim();
    if (!notificationAt || Number.isNaN(Date.parse(notificationAt))) return [];
    const matchingCard = cards.find((card) => card.kind === "reminder" && card.notificationAt === notificationAt);
    let body = current?.[4]?.trim() ?? legacy?.[2]?.trim() ?? "";
    try { body = String(JSON.parse(body)); } catch { /* keep human-edited text */ }
    return [{
      id: matchingCard?.id ?? current?.[1] ?? `reminder-${createHash("sha256").update(line).digest("hex").slice(0, 20)}`,
      kind: "reminder" as const,
      title: matchingCard?.title ?? `Напоминание · ${current?.[2]?.trim() ?? "scheduled"}`,
      bodyMarkdown: body, priority: 0, createdAt: notificationAt, notificationAt,
      dismissible: false, source: "reminder-history",
    }];
  });
}

export async function deleteReminder(workspace: string, id: string): Promise<boolean> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(id)) throw new Error("Invalid reminder id");
  const reminderPath = join(workspace, "REMINDERS.md");
  const reminderText = await optionalFile(reminderPath, "# Reminders\n");
  const lines = reminderText.split("\n");
  const cards = await readAllCards(workspace);
  const targetCard = cards.find((card) => card.id === id);
  const keptLines = lines.filter((line) => {
    if (line.startsWith(`- ${id} |`)) return false;
    if (`reminder-${createHash("sha256").update(line).digest("hex").slice(0, 20)}` === id) return false;
    if (!targetCard?.notificationAt) return true;
    const legacy = line.match(/^-\s+(\S+)\s+[—–-]\s+/);
    return legacy?.[1] !== targetCard.notificationAt;
  });
  const keptCards = cards.filter((card) => card.id !== id);
  const existed = keptLines.length !== lines.length || keptCards.length !== cards.length;
  if (!existed) return false;
  await Promise.all([
    writeFile(reminderPath, `${keptLines.join("\n").replace(/\n+$/, "")}\n`, "utf8"),
    writeFile(join(workspace, "CARDS.md"), serializeCards(keptCards), "utf8"),
  ]);
  return true;
}
