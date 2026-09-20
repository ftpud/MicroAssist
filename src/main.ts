import cron from "node-cron";
import { mkdir } from "node:fs/promises";
import { CodexAssistant } from "./assistant.js";
import { backupWorkspace } from "./backup.js";
import { loadConfig } from "./config.js";
import { buildServer, refreshActual } from "./server.js";

const config = loadConfig();
await mkdir(config.workspaceDir, { recursive: true });
const assistant = new CodexAssistant(config.workspaceDir);
const app = buildServer({
  token: config.token,
  timezone: config.timezone,
  workspaceDir: config.workspaceDir,
  assistant,
  logger: { level: config.logLevel },
});

const report = (name: string, operation: () => Promise<unknown>) => async () => {
  try {
    await operation();
    app.log.info(`${name} completed`);
  } catch (error) {
    app.log.error({ err: error }, `${name} failed`);
  }
};

const jobs = [
  cron.schedule("0 7 * * *", report("morning refresh", () => refreshActual(assistant, config.timezone)), { timezone: config.timezone }),
  cron.schedule("0 9-21/2 * * *", report("daytime refresh", () => refreshActual(assistant, config.timezone)), { timezone: config.timezone }),
  cron.schedule("30 2 * * *", report("workspace backup", () => backupWorkspace(config.workspaceDir, config.backupDir)), { timezone: config.timezone }),
];

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  for (const job of jobs) job.stop();
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
