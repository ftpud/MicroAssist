import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import type { Assistant } from "./assistant.js";
import { assertTimezone } from "./config.js";
import { refreshPrompt, userPrompt } from "./prompts.js";

export interface ServerOptions {
  token: string;
  timezone: string;
  workspaceDir: string;
  assistant: Assistant;
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
      await options.assistant.run(userPrompt(text.trim(), now, timezone));
      const actual = await readFile(join(options.workspaceDir, "ACTUAL.md"), "utf8");
      return reply.type("text/markdown; charset=utf-8").send(actual);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.startsWith("Invalid TIMEZONE") || message.startsWith("now must")) {
        return reply.code(400).send({ error: message });
      }
      request.log.error({ err: error }, "assistant turn failed");
      return reply.code(503).send({ error: "Assistant unavailable" });
    }
  });

  return app;
}

export async function refreshActual(assistant: Assistant, timezone: string, now = new Date()): Promise<void> {
  await assistant.run(refreshPrompt(now.toISOString(), timezone));
}
