import fs from "node:fs";
import path from "node:path";

loadDotEnv();

export type AppConfig = {
  nodeEnv: string;
  port: number;
  host: string;
  webhookPathSecret: string;
  databaseUrl?: string;
  sweepgoApiToken?: string;
  sweepgoBaseUrl: string;
};

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requiredEnv(name: string, fallback?: string): string {
  const value = optionalEnv(name) ?? fallback;
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 3000),
    host: "0.0.0.0",
    webhookPathSecret: requiredEnv("WEBHOOK_PATH_SECRET", "local-dev-secret"),
    databaseUrl: optionalEnv("DATABASE_URL"),
    sweepgoApiToken: optionalEnv("SWEEPGO_API_TOKEN"),
    sweepgoBaseUrl: requiredEnv("SWEEPGO_BASE_URL", "https://openapi.sweepandgo.com").replace(/\/+$/, "")
  };
}

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
