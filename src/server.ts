import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import type { Assistant } from "./assistant.js";
import { assertTimezone } from "./config.js";
import { refreshPrompt, userPrompt } from "./prompts.js";
import { createRelativeReminder, deleteReminder, dismissCard, readReminderHistory, readSnapshot } from "./cards.js";
import { registerDevice, unregisterDevice } from "./reminders.js";
import { appendChat, readChat, type BackgroundJob } from "./activity.js";
import { deleteRecurring, readRecurring } from "./schedules.js";
import type { Mutex } from "./mutex.js";

export interface ServerOptions {
  token: string;
  timezone: string;
  workspaceDir: string;
  assistant: Assistant;
  notifySnapshotChanged?: () => Promise<void>;
  deliverReminders?: () => Promise<void>;
  stateMutex?: Mutex;
  logger?: boolean | { level: string };
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const received = Buffer.from(header.slice(7), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return received.length === wanted.length && timingSafeEqual(received, wanted);
}

function normalizedNow(value: unknown): string {
  if (value === undefined) return new Date().toISOString();
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) {
    throw new Error("now must be a valid ISO-8601 date-time");
  }
  return value;
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 32 * 1024 });
  const withState = <T>(operation: () => Promise<T>) => options.stateMutex?.runExclusive(operation) ?? operation();
  const jobs = new Map<string, BackgroundJob>();
  const snapshotWithActivity = async (timezone: string, now = new Date()) => {
    const snapshot = await readSnapshot(options.workspaceDir, timezone, now);
    const activeJobCount = [...jobs.values()].filter((job) => job.status === "pending" || job.status === "running").length;
    return { ...snapshot, version: `${snapshot.version}.${activeJobCount}`, isProcessing: activeJobCount > 0, activeJobCount };
  };
  const enqueuePrompt = async (text: string, now: string, timezone: string) => {
    const immediateReminder = await withState(() => createRelativeReminder(options.workspaceDir, text, new Date(now)));
    const jobId = `prompt-${randomUUID()}`;
    const job: BackgroundJob = { id: jobId, kind: "prompt", status: "pending", createdAt: now, updatedAt: now };
    jobs.set(jobId, job);
    await appendChat(options.workspaceDir, { id: randomUUID(), role: "user", text, createdAt: now });
    const completion = (async () => {
      job.status = "running";
      job.updatedAt = new Date().toISOString();
      try {
        if (immediateReminder) {
          const answer = immediateReminder.notificationAt === now
            ? `Уведомление «${immediateReminder.bodyMarkdown}» принято к немедленной доставке.`
            : `Напоминание «${immediateReminder.bodyMarkdown}» запланировано на ${immediateReminder.notificationAt}.`;
          await appendChat(options.workspaceDir, { id: randomUUID(), role: "assistant", text: answer, createdAt: new Date().toISOString() });
          await options.deliverReminders?.();
          job.status = "completed";
          void options.notifySnapshotChanged?.().catch((error: unknown) => {
            app.log.error({ err: error, jobId }, "snapshot refresh push failed");
          });
          return answer;
        }
        const answer = await withState(() => options.assistant.run(userPrompt(text, now, timezone)));
        if (answer) await appendChat(options.workspaceDir, { id: randomUUID(), role: "assistant", text: answer, createdAt: new Date().toISOString() });
        job.status = "completed";
        if (options.notifySnapshotChanged) {
          void options.notifySnapshotChanged().catch((error: unknown) => {
            app.log.error({ err: error, jobId }, "snapshot refresh push failed");
          });
        }
        return answer;
      } catch (error) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : "Unknown error";
        app.log.error({ err: error, jobId }, "background assistant turn failed");
        throw error;
      } finally {
        job.updatedAt = new Date().toISOString();
      }
    })();
    return { jobId, completion };
  };

  app.get("/health", async (_request, reply) => {
    const status = options.assistant.healthy ? 200 : 503;
    return reply.code(status).send({ node: "ok", acp: options.assistant.healthy ? "ok" : "unavailable" });
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    if (!tokenMatches(request.headers.authorization, options.token)) {
      await reply.header("WWW-Authenticate", "Bearer").code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/actual.md", async (request, reply) => {
    const content = await readFile(join(options.workspaceDir, "ACTUAL.md"), "utf8");
    const etag = `"${createHash("sha256").update(content).digest("base64url")}"`;
    reply.header("ETag", etag).header("Cache-Control", "private, no-cache");
    if (request.headers["if-none-match"]?.split(",").map((value) => value.trim()).includes(etag)) {
      return reply.code(304).send();
    }
    return reply.type("text/markdown; charset=utf-8").send(content);
  });

  app.get("/snapshot", async (request, reply) => {
    const snapshot = await snapshotWithActivity(options.timezone);
    const etag = `"${snapshot.version}"`;
    reply.header("ETag", etag).header("Cache-Control", "private, no-cache");
    if (request.headers["if-none-match"]?.split(",").map((value) => value.trim()).includes(etag)) {
      return reply.code(304).send();
    }
    return snapshot;
  });

  app.get("/cards", async (request, reply) => {
    const snapshot = await readSnapshot(options.workspaceDir, options.timezone);
    const body = { schemaVersion: snapshot.schemaVersion, version: snapshot.version, generatedAt: snapshot.generatedAt, timezone: snapshot.timezone, cards: snapshot.cards };
    const etag = `"${snapshot.version}"`;
    reply.header("ETag", etag).header("Cache-Control", "private, no-cache");
    if (request.headers["if-none-match"]?.split(",").map((value) => value.trim()).includes(etag)) {
      return reply.code(304).send();
    }
    return body;
  });

  app.get("/chat", async () => ({ messages: await readChat(options.workspaceDir) }));

  app.get("/reminders", async () => ({
    reminders: await readReminderHistory(options.workspaceDir),
  }));

  app.delete<{ Params: { id: string } }>("/reminders/:id", async (request, reply) => {
    try {
      return reply.code(await withState(() => deleteReminder(options.workspaceDir, request.params.id)) ? 204 : 404).send();
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/recurring", async () => ({ events: await readRecurring(options.workspaceDir) }));

  app.delete<{ Params: { id: string } }>("/recurring/:id", async (request, reply) => {
    try {
      return reply.code(await withState(() => deleteRecurring(options.workspaceDir, request.params.id)) ? 204 : 404).send();
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/activity", async () => ({
    jobs: [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50),
  }));

  app.post<{ Params: { id: string } }>("/cards/:id/dismiss", async (request, reply) => {
    try {
      return await withState(async () => {
        const snapshot = await readSnapshot(options.workspaceDir, options.timezone);
        const card = snapshot.cards.find((candidate) => candidate.id === request.params.id);
        if (!card) {
          await dismissCard(options.workspaceDir, request.params.id);
          return reply.code(204).send();
        }
        if (!card.dismissible) return reply.code(409).send({ error: "Card is not dismissible" });
        await dismissCard(options.workspaceDir, card.id);
        return reply.code(204).send();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid card";
      return reply.code(400).send({ error: message });
    }
  });

  app.post<{ Body: { token?: unknown; environment?: unknown } }>("/devices/register", async (request, reply) => {
    if (typeof request.body?.token !== "string") return reply.code(400).send({ error: "token is required" });
    if (request.body.environment !== undefined && request.body.environment !== "sandbox" && request.body.environment !== "production") {
      return reply.code(400).send({ error: "environment must be sandbox or production" });
    }
    try {
      await registerDevice(options.workspaceDir, request.body.token, request.body.environment as "sandbox" | "production" | undefined);
      return reply.code(204).send();
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.delete<{ Params: { token: string } }>("/devices/:token", async (request, reply) => {
    await unregisterDevice(options.workspaceDir, request.params.token);
    return reply.code(204).send();
  });

  app.post<{ Body: { text?: unknown; now?: unknown; timezone?: unknown } }>("/prompt", async (request, reply) => {
    const text = request.body?.text;
    if (typeof text !== "string" || !text.trim() || text.length > 10_000) {
      return reply.code(400).send({ error: "text must be a non-empty string of at most 10000 characters" });
    }
    try {
      const now = normalizedNow(request.body.now);
      const timezone = request.body.timezone ?? options.timezone;
      if (typeof timezone !== "string") throw new Error("timezone must be a string");
      assertTimezone(timezone);
      const { jobId, completion } = await enqueuePrompt(text.trim(), now, timezone);
      const snapshot = await snapshotWithActivity(timezone, new Date(now));
      // Codex turns can take tens of seconds. Accept the command first and let
      // the assistant's own mutex process queued turns in order.
      void completion.catch(() => undefined);
      return reply
        .header("ETag", `"${snapshot.version}"`)
        .header("Retry-After", "2")
        .header("X-Job-ID", jobId)
        .code(202)
        .send(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.startsWith("Invalid TIMEZONE") || message.startsWith("now must")) {
        return reply.code(400).send({ error: message });
      }
      request.log.error({ err: error }, "assistant turn failed");
      return reply.code(503).send({ error: "Assistant unavailable" });
    }
  });

  app.post<{ Body: { text?: unknown; now?: unknown; timezone?: unknown } }>("/prompt/blocking", async (request, reply) => {
    const text = request.body?.text;
    if (typeof text !== "string" || !text.trim() || text.length > 10_000) {
      return reply.code(400).send({ error: "text must be a non-empty string of at most 10000 characters" });
    }
    try {
      const now = normalizedNow(request.body.now);
      const timezone = request.body.timezone ?? options.timezone;
      if (typeof timezone !== "string") throw new Error("timezone must be a string");
      assertTimezone(timezone);
      const { jobId, completion } = await enqueuePrompt(text.trim(), now, timezone);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 230_000); });
      const outcome = await Promise.race([completion.then((answer) => ({ answer })), timeout]);
      if (timer) clearTimeout(timer);
      const snapshot = await snapshotWithActivity(timezone);
      return reply
        .header("X-Job-ID", jobId)
        .code(outcome === null ? 202 : 200)
        .send({ completed: outcome !== null, answer: outcome?.answer ?? null, snapshot });
    } catch (error) {
      request.log.error({ err: error }, "blocking assistant turn failed");
      return reply.code(503).send({ error: "Assistant unavailable" });
    }
  });

  return app;
}

export async function refreshActual(assistant: Assistant, timezone: string, now = new Date()): Promise<void> {
  await assistant.run(refreshPrompt(now.toISOString(), timezone), {
    contextFiles: ["MEMORY.md", "TASKS.md", "RECURRING.md", "ACTUAL.md", "CARDS.md"],
    includeJournal: false,
  });
}
