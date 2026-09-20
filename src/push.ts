import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect } from "node:http2";

export interface PushConfig {
  keyId: string;
  teamId: string;
  topic: string;
  keyPath: string;
  production: boolean;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export class ApnsError extends Error {
  constructor(public readonly status: number, public readonly reason: string) {
    super(`APNs ${status}: ${reason}`);
    this.name = "ApnsError";
  }

  get invalidDeviceToken(): boolean {
    return this.reason === "BadDeviceToken" || this.reason === "DeviceTokenNotForTopic" || this.reason === "Unregistered";
  }
}

export class ApnsClient {
  private key?: string;
  private jwt?: { value: string; createdAt: number };

  constructor(private readonly config: PushConfig) {}

  async send(deviceToken: string, title: string, body: string, cardId: string, production = this.config.production): Promise<void> {
    // Combining the visible alert with content-available gives iOS an
    // opportunity to refresh the shared snapshot and WidgetKit while the
    // reminder is delivered. The separate silent refresh remains a fallback.
    await this.request(deviceToken, JSON.stringify({
      aps: { alert: { title, body }, sound: "default", "content-available": 1 },
      cardId,
      reason: "card-notification",
    }), "alert", "10", production);
  }

  async sendRefresh(deviceToken: string, production = this.config.production): Promise<void> {
    await this.request(deviceToken, JSON.stringify({ aps: { "content-available": 1 }, reason: "snapshot-updated" }), "background", "5", production);
  }

  private async request(deviceToken: string, payload: string, pushType: "alert" | "background", priority: "10" | "5", production: boolean): Promise<void> {
    const host = production ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
    const client = connect(host);
    try {
      await new Promise<void>((resolve, reject) => {
        client.once("error", reject);
        const request = client.request({
          ":method": "POST",
          ":path": `/3/device/${deviceToken}`,
          authorization: `bearer ${this.token()}`,
          "apns-topic": this.config.topic,
          "apns-push-type": pushType,
          "apns-priority": priority,
          "content-type": "application/json",
        });
        let status = 0;
        let response = "";
        request.setEncoding("utf8");
        request.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
        request.on("data", (chunk) => { response += chunk; });
        request.on("end", () => {
          if (status === 200) return resolve();
          let reason = response;
          try { reason = String((JSON.parse(response) as { reason?: unknown }).reason ?? response); } catch { /* raw APNs response */ }
          reject(new ApnsError(status, reason));
        });
        request.on("error", reject);
        request.end(payload);
      });
    } finally {
      client.close();
    }
  }

  private token(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.jwt && now - this.jwt.createdAt < 45 * 60) return this.jwt.value;
    if (!this.key) throw new Error("APNs key has not been loaded");
    const header = base64url(JSON.stringify({ alg: "ES256", kid: this.config.keyId }));
    const claims = base64url(JSON.stringify({ iss: this.config.teamId, iat: now }));
    const material = `${header}.${claims}`;
    const signature = createSign("SHA256").update(material).sign({ key: this.key, dsaEncoding: "ieee-p1363" });
    const value = `${material}.${base64url(signature)}`;
    this.jwt = { value, createdAt: now };
    return value;
  }

  async start(): Promise<void> {
    this.key = await readFile(this.config.keyPath, "utf8");
  }
}
