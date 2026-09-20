import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApnsClient } from "./push.js";
import { ApnsError } from "./push.js";
import { readSnapshot } from "./cards.js";
import type { Mutex } from "./mutex.js";

const tokenPattern = /^[a-fA-F0-9]{32,256}$/;
export type ApnsEnvironment = "sandbox" | "production";
export interface DeviceRegistration { token: string; environment?: ApnsEnvironment }

async function optional(path: string, fallback: string): Promise<string> {
  try { return await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function deviceRegistrations(workspace: string): Promise<DeviceRegistration[]> {
  const content = await optional(join(workspace, "DEVICES.md"), "# Devices\n");
  return [...content.matchAll(/^-\s+(?:(sandbox|production)\s+\|\s+)?([a-fA-F0-9]+)$/gm)]
    .map((match) => ({ token: match[2]!.toLowerCase(), environment: match[1] as ApnsEnvironment | undefined }))
    .filter(({ token }) => tokenPattern.test(token));
}

export async function registerDevice(workspace: string, token: string, environment?: ApnsEnvironment): Promise<void> {
  if (!tokenPattern.test(token)) throw new Error("Invalid APNs device token");
  const path = join(workspace, "DEVICES.md");
  const normalized = token.toLowerCase();
  const registrations = (await deviceRegistrations(workspace)).filter((value) => value.token !== normalized);
  registrations.push({ token: normalized, environment });
  await writeRegistrations(path, registrations);
}

export async function unregisterDevice(workspace: string, token: string): Promise<void> {
  const registrations = (await deviceRegistrations(workspace)).filter((value) => value.token !== token.toLowerCase());
  await writeRegistrations(join(workspace, "DEVICES.md"), registrations);
}

async function writeRegistrations(path: string, registrations: DeviceRegistration[]): Promise<void> {
  const lines = registrations.map(({ token, environment }) => `- ${environment ? `${environment} | ` : ""}${token}`);
  await writeFile(path, `# Devices\n\n${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}

export class ReminderScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private workspace: string, private timezone: string, private apns?: ApnsClient, private stateMutex?: Mutex) {}

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
      await (this.stateMutex?.runExclusive(() => this.deliver(now)) ?? this.deliver(now));
    } finally { this.running = false; }
  }

  private async deliver(now: Date): Promise<void> {
    const [snapshot, deliveredText, tokens] = await Promise.all([
        readSnapshot(this.workspace, this.timezone, now),
        optional(join(this.workspace, "DELIVERED.md"), "# Delivered notifications\n"),
        deviceRegistrations(this.workspace),
      ]);
      const delivered = new Set([...deliveredText.matchAll(/^-\s+([^|\s]+)\s+\|/gm)].map((match) => match[1]!));
      for (const card of snapshot.cards) {
        if (!card.notificationAt || Date.parse(card.notificationAt) > now.getTime() || delivered.has(card.id)) continue;
        if (tokens.length === 0) continue;
        const results = await Promise.allSettled(
          tokens.map(({ token, environment }) => this.apns!.send(token, card.title, card.bodyMarkdown.slice(0, 180), card.id, environment ? environment === "production" : undefined)),
        );
        const deliveredCount = results.filter((result) => result.status === "fulfilled").length;
        for (const [index, result] of results.entries()) {
          if (result.status === "rejected") {
            console.error("APNs delivery failed", result.reason);
            if (result.reason instanceof ApnsError && result.reason.invalidDeviceToken) {
              await unregisterDevice(this.workspace, tokens[index]!.token);
            }
          }
        }
        if (deliveredCount > 0) {
          await appendFile(join(this.workspace, "DELIVERED.md"), `- ${card.id} | ${now.toISOString()}\n`, "utf8");
          console.log(`[apns] delivered card=${card.id} devices=${deliveredCount}/${tokens.length}`);
        } else {
          console.error(`[apns] delivery failed for all devices card=${card.id}`);
        }
      }
  }
}
