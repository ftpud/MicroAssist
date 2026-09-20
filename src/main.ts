import cron from "node-cron";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CodexAssistant } from "./assistant.js";
import { backupWorkspace } from "./backup.js";
import { loadConfig } from "./config.js";
import { buildServer, refreshActual } from "./server.js";
import { ApnsClient, ApnsError } from "./push.js";
import { deviceRegistrations, ReminderScheduler, unregisterDevice } from "./reminders.js";
import { recurringPrompt } from "./prompts.js";
import { RecurringScheduler } from "./schedules.js";
import { Mutex } from "./mutex.js";

const config = loadConfig();
await mkdir(config.workspaceDir, { recursive: true });
const stateMutex = new Mutex();
const assistant = new CodexAssistant(config.workspaceDir, config.codexModel, config.codexVerbose);
const apns = config.apns ? new ApnsClient(config.apns) : undefined;
if (apns) await apns.start();
else console.warn("APNs push delivery is disabled: configure APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC, and APNS_KEY_PATH");
const reminders = new ReminderScheduler(config.workspaceDir, config.timezone, apns, stateMutex);
reminders.start();
const notifySnapshotChanged = apns ? async () => {
  const tokens = await deviceRegistrations(config.workspaceDir);
  const results = await Promise.allSettled(tokens.map(({ token, environment }) => apns.sendRefresh(token, environment ? environment === "production" : undefined)));
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected" && result.reason instanceof ApnsError && result.reason.invalidDeviceToken) {
      await unregisterDevice(config.workspaceDir, tokens[index]!.token);
    }
  }
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length === results.length && results.length > 0) throw (failures[0] as PromiseRejectedResult).reason;
} : undefined;
const recurring = new RecurringScheduler(config.workspaceDir, async (event) => {
  const now = new Date().toISOString();
  await stateMutex.runExclusive(() => assistant.run(recurringPrompt(event.id, event.prompt, now, event.timezone), {
      contextFiles: ["ACTUAL.md", "CARDS.md", "RECURRING.md", ...event.contextFiles],
      includeJournal: false,
    }));
  await reminders.tick();
  await notifySnapshotChanged?.();
});
recurring.start();
const app = buildServer({
  token: config.token,
  timezone: config.timezone,
  workspaceDir: config.workspaceDir,
  assistant,
  logger: { level: config.logLevel },
  notifySnapshotChanged,
  deliverReminders: () => reminders.tick(),
  stateMutex,
});

const report = (name: string, operation: () => Promise<unknown>) => async () => {
  try {
    await operation();
    app.log.info(`${name} completed`);
  } catch (error) {
    app.log.error({ err: error }, `${name} failed`);
  }
};

async function refreshFingerprint(): Promise<string> {
  const material = await Promise.all(["MEMORY.md", "TASKS.md", "RECURRING.md"].map(async (name) => {
    try { return await readFile(join(config.workspaceDir, name), "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }));
  const localDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return createHash("sha256").update(`${localDay}\n${material.join("\n---\n")}`).digest("base64url");
}

let lastRefreshFingerprint = await refreshFingerprint();
async function refreshIfChanged(): Promise<void> {
  const fingerprint = await refreshFingerprint();
  if (fingerprint === lastRefreshFingerprint) {
    app.log.info("scheduled refresh skipped: source state unchanged");
    return;
  }
  await stateMutex.runExclusive(() => refreshActual(assistant, config.timezone));
  lastRefreshFingerprint = fingerprint;
  await notifySnapshotChanged?.();
}

const jobs = [
  cron.schedule("0 7 * * *", report("morning refresh", refreshIfChanged), { timezone: config.timezone }),
  cron.schedule("0 9-21/2 * * *", report("daytime refresh", refreshIfChanged), { timezone: config.timezone }),
  cron.schedule("30 2 * * *", report("workspace backup", () => stateMutex.runExclusive(() => backupWorkspace(config.workspaceDir, config.backupDir))), { timezone: config.timezone }),
];

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  for (const job of jobs) job.stop();
  reminders.stop();
  recurring.stop();
  await app.close();
  await assistant.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await assistant.start();
} catch (error) {
  app.log.error({ err: error }, "ACP startup failed; prompt requests will retry");
}
await app.listen({ host: config.host, port: config.port });
