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

export class ApnsClient {
  private key?: string;
  private jwt?: { value: string; createdAt: number };

  constructor(private readonly config: PushConfig) {}

  async send(deviceToken: string, title: string, body: string, cardId: string): Promise<void> {
    const host = this.config.production ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
    const client = connect(host);
    try {
      const payload = JSON.stringify({ aps: { alert: { title, body }, sound: "default" }, cardId });
      await new Promise<void>((resolve, reject) => {
        const request = client.request({
          ":method": "POST",
          ":path": `/3/device/${deviceToken}`,
          authorization: `bearer ${this.token()}`,
          "apns-topic": this.config.topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "content-type": "application/json",
        });
        let status = 0;
        let response = "";
        request.setEncoding("utf8");
        request.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
        request.on("data", (chunk) => { response += chunk; });
        request.on("end", () => status === 200 ? resolve() : reject(new Error(`APNs ${status}: ${response}`)));
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
