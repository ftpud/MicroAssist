import cron, { type ScheduledTask } from "node-cron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface RecurringEvent {
  id: string;
  cron: string;
  timezone: string;
  prompt: string;
  enabled: boolean;
  contextFiles: string[];
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const contextFileAllowlist = new Set(["MEMORY.md", "TASKS.md", "RECURRING.md", "ACTUAL.md", "CARDS.md", "REMINDERS.md"]);

async function optional(path: string, fallback: string): Promise<string> {
  try { return await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export function parseRecurring(markdown: string): RecurringEvent[] {
  return markdown.split("\n").flatMap((line) => {
    const match = line.match(/^-\s+([^|\s]+)\s+\|\s+(enabled|disabled)\s+\|\s+([^|]+)\s+\|\s+([^|]+)\s+\|\s+(.+)$/);
    if (!match) return [];
    const id = match[1]!.trim();
    const expression = match[3]!.trim();
    const timezone = match[4]!.trim();
    let prompt = match[5]!.trim();
    let contextFiles: string[] = [];
    try {
      const parsed: unknown = JSON.parse(prompt);
      if (typeof parsed === "string") prompt = parsed;
      else if (parsed && typeof parsed === "object") {
        const value = parsed as { prompt?: unknown; contextFiles?: unknown };
        prompt = typeof value.prompt === "string" ? value.prompt : "";
        contextFiles = Array.isArray(value.contextFiles)
          ? [...new Set(value.contextFiles.filter((name): name is string => typeof name === "string" && contextFileAllowlist.has(name)))]
          : [];
      }
    } catch { /* human-edited legacy text */ }
    if (!idPattern.test(id) || !cron.validate(expression) || !prompt) return [];
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { return []; }
    return [{ id, cron: expression, timezone, prompt, enabled: match[2] === "enabled", contextFiles }];
  });
}

export async function readRecurring(workspace: string): Promise<RecurringEvent[]> {
  return parseRecurring(await optional(join(workspace, "RECURRING.md"), "# Повторяющиеся события\n"));
}

export async function deleteRecurring(workspace: string, id: string): Promise<boolean> {
  if (!idPattern.test(id)) throw new Error("Invalid recurring event id");
  const path = join(workspace, "RECURRING.md");
  const content = await optional(path, "# Повторяющиеся события\n");
  const lines = content.split("\n");
  const filtered = lines.filter((line) => !line.match(new RegExp(`^-\\s+${escapeRegExp(id)}\\s+\\|`)));
  if (filtered.length === lines.length) return false;
  await writeFile(path, `${filtered.join("\n").replace(/\n+$/, "")}\n`, "utf8");
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class RecurringScheduler {
  private readonly tasks = new Map<string, { fingerprint: string; task: ScheduledTask }>();
  private syncTimer?: NodeJS.Timeout;
  private syncing = false;

  constructor(private readonly workspace: string, private readonly run: (event: RecurringEvent) => Promise<void>) {}

  start(): void {
    void this.sync().catch((error: unknown) => console.error("Recurring schedule sync failed", error));
    this.syncTimer = setInterval(() => {
      void this.sync().catch((error: unknown) => console.error("Recurring schedule sync failed", error));
    }, 15_000);
    this.syncTimer.unref();
  }

  stop(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    for (const value of this.tasks.values()) void value.task.destroy();
    this.tasks.clear();
  }

  async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const events = (await readRecurring(this.workspace)).filter((event) => event.enabled);
      const activeIds = new Set(events.map((event) => event.id));
      for (const [id, value] of this.tasks) {
        if (!activeIds.has(id)) {
          await value.task.destroy();
          this.tasks.delete(id);
        }
      }
      for (const event of events) {
        const fingerprint = JSON.stringify(event);
        if (this.tasks.get(event.id)?.fingerprint === fingerprint) continue;
        const old = this.tasks.get(event.id);
        if (old) await old.task.destroy();
        const task = cron.schedule(event.cron, () => {
          void this.run(event).catch((error: unknown) => console.error(`Recurring event ${event.id} failed`, error));
        }, { timezone: event.timezone, noOverlap: true, name: event.id });
        this.tasks.set(event.id, { fingerprint, task });
      }
    } finally { this.syncing = false; }
  }
}
