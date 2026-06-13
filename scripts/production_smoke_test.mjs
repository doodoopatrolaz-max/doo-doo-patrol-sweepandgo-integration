import fs from "node:fs";
import { Readable } from "node:stream";
import { loadConfig } from "../src/config.ts";
import { createRequestHandler } from "../src/http/app.ts";
import { InMemoryWebhookEventStore } from "../src/webhooks/inMemoryStore.ts";
import { GoHighLevelClient } from "../src/gohighlevel/client.ts";

const requiredVariableNames = [
  "NODE_ENV",
  "DATABASE_URL",
  "WEBHOOK_PATH_SECRET",
  "SWEEPGO_API_TOKEN",
  "SWEEPGO_BASE_URL"
];

const optionalGoHighLevelVariableNames = [
  "GHL_PRIVATE_INTEGRATION_TOKEN",
  "GHL_LOCATION_ID",
  "GHL_API_BASE_URL",
  "GHL_PIPELINE_ID",
  "GHL_FACEBOOK_STAGE_ID",
  "GHL_WEBSITE_STAGE_ID",
  "GOHIGHLEVEL_WEBHOOK_SECRET"
];

const config = loadConfig();
const output = {
  applicationHealth: await checkHealth(config),
  database: await checkDatabase(config.databaseUrl),
  requiredEnvironmentVariables: Object.fromEntries(requiredVariableNames.map((name) => [name, Boolean(process.env[name])])),
  goHighLevelEnvironmentVariables: Object.fromEntries(optionalGoHighLevelVariableNames.map((name) => [name, Boolean(process.env[name])])),
  sweepAndGoModulesPresent: {
    incrementalDailySync: fs.existsSync("src/sweepandgo/incrementalDailySync.ts"),
    sync: fs.existsSync("src/sweepandgo/sync.ts"),
    historicalSync: fs.existsSync("src/sweepandgo/historicalSync.ts"),
    reportingMapper: fs.existsSync("src/sweepandgo/reportingMapper.ts"),
    reportingStore: fs.existsSync("src/sweepandgo/reportingStore.ts")
  },
  goHighLevelModuleLoads: typeof GoHighLevelClient === "function"
};

console.log(JSON.stringify(output, null, 2));

if (!output.applicationHealth.ok || output.database.status === "failed" || !output.goHighLevelModuleLoads) {
  process.exit(1);
}

async function checkHealth(appConfig) {
  const handler = createRequestHandler({
    config: appConfig,
    webhookStore: new InMemoryWebhookEventStore(),
    startedAt: new Date("2026-01-01T00:00:00.000Z")
  });
  const response = await invoke(handler, "GET", "/health");
  return {
    ok: response.status === 200 && response.body?.status === "ok",
    status: response.status,
    secretsExposed: JSON.stringify(response.body).includes(appConfig.webhookPathSecret)
  };
}

async function checkDatabase(databaseUrl) {
  if (!databaseUrl) {
    return {
      configured: false,
      status: "skipped",
      migrationRecords: []
    };
  }

  let createPool;
  try {
    ({ createPool } = await import("../src/db/pool.ts"));
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      return {
        configured: true,
        status: "skipped_missing_local_pg_dependency",
        migrationRecords: []
      };
    }
    throw error;
  }

  let pool;
  try {
    pool = await createPool(databaseUrl);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      return {
        configured: true,
        status: "skipped_missing_local_pg_dependency",
        migrationRecords: []
      };
    }
    throw error;
  }

  try {
    await pool.query("SELECT 1");
    const migrations = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
    return {
      configured: true,
      status: "ok",
      migrationRecords: migrations.rows.map((row) => row.version)
    };
  } catch {
    return {
      configured: true,
      status: "failed",
      migrationRecords: []
    };
  } finally {
    await pool.end();
  }
}

async function invoke(handler, method, url) {
  const chunks = [];
  const request = Readable.from([]);
  request.method = method;
  request.url = url;
  request.headers = {};
  const response = {
    statusCode: 200,
    writeHead(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return this;
    }
  };

  await handler(request, response);
  const text = Buffer.concat(chunks).toString("utf8");
  return {
    status: response.statusCode,
    body: text ? JSON.parse(text) : undefined
  };
}
