import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface BackgroundJob {
  id: string;
  kind: "prompt" | "refresh";
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  error?: string;
}

async function optional(path: string): Promise<string> {
  try { return await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export async function appendChat(workspace: string, message: ChatMessage): Promise<void> {
  await appendFile(join(workspace, "CHAT.jsonl"), `${JSON.stringify(message)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function readChat(workspace: string): Promise<ChatMessage[]> {
  const content = await optional(join(workspace, "CHAT.jsonl"));
  return content.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as ChatMessage]; } catch { return []; }
  }).slice(-200);
}
