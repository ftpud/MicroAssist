import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApnsClient } from "./push.js";
import { readSnapshot } from "./cards.js";

const tokenPattern = /^[a-fA-F0-9]{32,256}$/;

async function optional(path: string, fallback: string): Promise<string> {
  try { return await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function deviceTokens(workspace: string): Promise<string[]> {
  const content = await optional(join(workspace, "DEVICES.md"), "# Devices\n");
  return [...content.matchAll(/^-\s+([a-fA-F0-9]+)$/gm)].map((match) => match[1]!).filter((token) => tokenPattern.test(token));
}

export async function registerDevice(workspace: string, token: string): Promise<void> {
  if (!tokenPattern.test(token)) throw new Error("Invalid APNs device token");
  const path = join(workspace, "DEVICES.md");
  const tokens = new Set(await deviceTokens(workspace));
  tokens.add(token.toLowerCase());
  await writeFile(path, `# Devices\n\n${[...tokens].map((value) => `- ${value}`).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function unregisterDevice(workspace: string, token: string): Promise<void> {
  const tokens = (await deviceTokens(workspace)).filter((value) => value !== token.toLowerCase());
  await writeFile(join(workspace, "DEVICES.md"), `# Devices\n\n${tokens.map((value) => `- ${value}`).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}

export class ReminderScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private workspace: string, private timezone: string, private apns?: ApnsClient) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => console.error("Reminder delivery failed", error));
    }, 15_000);
    this.timer.unref();
    void this.tick().catch((error: unknown) => console.error("Reminder delivery failed", error));
  }

  stop(): void { if (this.timer) clearInterval(this.timer); }

  async tick(now = new Date()): Promise<void> {
    if (this.running || !this.apns) return;
    this.running = true;
    try {
      const [snapshot, deliveredText, tokens] = await Promise.all([
        readSnapshot(this.workspace, this.timezone, now),
        optional(join(this.workspace, "DELIVERED.md"), "# Delivered notifications\n"),
        deviceTokens(this.workspace),
      ]);
      const delivered = new Set([...deliveredText.matchAll(/^-\s+([^|\s]+)\s+\|/gm)].map((match) => match[1]!));
      for (const card of snapshot.cards) {
        if (!card.notificationAt || Date.parse(card.notificationAt) > now.getTime() || delivered.has(card.id)) continue;
        if (tokens.length === 0) continue;
        await Promise.all(tokens.map((token) => this.apns!.send(token, card.title, card.bodyMarkdown.slice(0, 180), card.id)));
        await appendFile(join(this.workspace, "DELIVERED.md"), `- ${card.id} | ${now.toISOString()}\n`, "utf8");
      }
    } finally { this.running = false; }
  }
}
