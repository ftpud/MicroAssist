import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { Mutex } from "./mutex.js";

export interface Assistant {
  readonly healthy: boolean;
  run(prompt: string): Promise<void>;
  close(): Promise<void>;
}

export class CodexAssistant implements Assistant {
  private readonly mutex = new Mutex();
  private child?: ChildProcessWithoutNullStreams;
  private connection?: acp.ClientConnection;
  private session?: acp.ActiveSession;
  private starting?: Promise<void>;
  private stopping = false;

  constructor(private readonly workspaceDir: string) {}

  get healthy(): boolean {
    return Boolean(this.child && this.child.exitCode === null && this.connection && this.session);
  }

  async start(): Promise<void> {
    if (this.healthy) return;
    if (this.starting) return this.starting;
    this.starting = this.startProcess().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  async run(prompt: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.start();
      if (!this.session) throw new Error("ACP session is unavailable");
      const response = await this.session.prompt(prompt);
      if (response.stopReason !== "end_turn") {
        throw new Error(`Codex turn stopped: ${response.stopReason}`);
      }
    });
  }

  async close(): Promise<void> {
    this.stopping = true;
    this.session?.dispose();
    this.session = undefined;
    this.connection?.close();
    this.connection = undefined;
    if (this.child && this.child.exitCode === null) this.child.kill("SIGTERM");
    this.child = undefined;
  }

  private async startProcess(): Promise<void> {
    this.clearDeadProcess();
    const require = createRequire(import.meta.url);
    const entrypoint = require.resolve("@agentclientprotocol/codex-acp/dist/index.js");
    const child = spawn(process.execPath, [entrypoint], {
      cwd: this.workspaceDir,
      env: {
        ...process.env,
        INITIAL_AGENT_MODE: "agent",
        NO_BROWSER: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.on("data", (chunk) => process.stderr.write(`[codex-acp] ${chunk}`));
    child.once("exit", () => {
      if (this.child !== child) return;
      this.session?.dispose();
      this.session = undefined;
      this.connection = undefined;
      if (!this.stopping) console.error("codex-acp subprocess exited");
    });

    const input = Writable.toWeb(child.stdin);
    const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(input, output);
    const connection = acp
      .client({ name: "micro-assist" })
      .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
        const allow = ctx.params.options.find((option) => option.kind === "allow_once");
        return allow
          ? { outcome: { outcome: "selected" as const, optionId: allow.optionId } }
          : { outcome: { outcome: "cancelled" as const } };
      })
      .connect(stream);

    try {
      await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const session = await connection.agent.buildSession(this.workspaceDir).start();
      this.connection = connection;
      this.session = session;
    } catch (error) {
      connection.close(error);
      if (child.exitCode === null) child.kill("SIGTERM");
      this.clearDeadProcess();
      throw error;
    }
  }

  private clearDeadProcess(): void {
    this.session?.dispose();
    this.session = undefined;
    this.connection?.close();
    this.connection = undefined;
    if (this.child?.exitCode === null) this.child.kill("SIGTERM");
    this.child = undefined;
  }
}
