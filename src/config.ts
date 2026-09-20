import { resolve } from "node:path";

export interface Config {
  token: string;
  host: string;
  port: number;
  timezone: string;
  workspaceDir: string;
  backupDir: string;
  logLevel: string;
  apns?: { keyId: string; teamId: string; topic: string; keyPath: string; production: boolean };
}

function validTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    throw new Error(`Invalid TIMEZONE: ${value}`);
  }
}

export function loadConfig(env = process.env): Config {
  const token = env.ASSISTANT_TOKEN?.trim();
  if (!token) throw new Error("ASSISTANT_TOKEN is required");

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  const apnsValues = [env.APNS_KEY_ID, env.APNS_TEAM_ID, env.APNS_TOPIC, env.APNS_KEY_PATH];
  if (apnsValues.some(Boolean) && !apnsValues.every(Boolean)) {
    throw new Error("APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC, and APNS_KEY_PATH must be set together");
  }
  return {
    token,
    host: env.HOST ?? "127.0.0.1",
    port,
    timezone: validTimezone(env.TIMEZONE ?? "Europe/Riga"),
    workspaceDir: resolve(env.WORKSPACE_DIR ?? "workspace"),
    backupDir: resolve(env.BACKUP_DIR ?? "backups"),
    logLevel: env.LOG_LEVEL ?? "info",
    apns: apnsValues.every(Boolean) ? {
      keyId: env.APNS_KEY_ID!, teamId: env.APNS_TEAM_ID!, topic: env.APNS_TOPIC!,
      keyPath: resolve(env.APNS_KEY_PATH!), production: env.APNS_PRODUCTION === "true",
    } : undefined,
  };
}

export function assertTimezone(value: string): void {
  validTimezone(value);
}
