import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Assistant } from "../src/assistant.js";
import { buildServer } from "../src/server.js";

class FakeAssistant implements Assistant {
  healthy = true;
  prompts: string[] = [];
  active = 0;
  maxActive = 0;

  async run(prompt: string): Promise<void> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.prompts.push(prompt);
    this.active -= 1;
  }

  async close(): Promise<void> {}
}

async function fixture() {
  const workspaceDir = await mkdtemp(join(tmpdir(), "micro-assist-test-"));
  await writeFile(join(workspaceDir, "ACTUAL.md"), "# Актуальное\n", "utf8");
  const assistant = new FakeAssistant();
  const app = buildServer({ token: "secret", timezone: "Europe/Riga", workspaceDir, assistant });
  return { app, assistant };
}

test("health reports ACP state without authentication", async () => {
  const { app } = await fixture();
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { node: "ok", acp: "ok" });
  await app.close();
});

test("protected routes require the bearer token", async () => {
  const { app } = await fixture();
  const response = await app.inject({ method: "GET", url: "/actual.md" });
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers["www-authenticate"], "Bearer");
  await app.close();
});

test("actual.md supports ETag revalidation", async () => {
  const { app } = await fixture();
  const first = await app.inject({ method: "GET", url: "/actual.md", headers: { authorization: "Bearer secret" } });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers["content-type"], "text/markdown; charset=utf-8");
  assert.ok(first.headers.etag);
  const second = await app.inject({
    method: "GET",
    url: "/actual.md",
    headers: { authorization: "Bearer secret", "if-none-match": first.headers.etag },
  });
  assert.equal(second.statusCode, 304);
  await app.close();
});

test("prompt validates input and passes time context to the assistant", async () => {
  const { app, assistant } = await fixture();
  const response = await app.inject({
    method: "POST",
    url: "/prompt",
    headers: { authorization: "Bearer secret" },
    payload: { text: "Купить хлеб", now: "2026-09-20T14:35:00+03:00", timezone: "Europe/Riga" },
  });
  assert.equal(response.statusCode, 200);
  assert.match(assistant.prompts[0]!, /Купить хлеб/);
  assert.match(assistant.prompts[0]!, /2026-09-20T14:35:00\+03:00/);
  await app.close();
});

test("invalid timezone is rejected", async () => {
  const { app } = await fixture();
  const response = await app.inject({
    method: "POST",
    url: "/prompt",
    headers: { authorization: "Bearer secret" },
    payload: { text: "Купить хлеб", timezone: "Moon/Base" },
  });
  assert.equal(response.statusCode, 400);
  await app.close();
});
