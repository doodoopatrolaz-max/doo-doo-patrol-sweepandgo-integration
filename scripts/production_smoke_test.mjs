import fs from "node:fs";
import { Readable } from "node:stream";
import { loadConfig } from "../src/config.ts";
import { createRequestHandler } from "../src/http/app.ts";
import { InMemoryWebhookEventStore } from "../src/webhooks/inMemoryStore.ts";
import { GoHighLevelClient } from "../src/gohighlevel/client.ts";
import { MetaAdsClient } from "../src/metaAds/client.ts";
import { GoogleAdsClient } from "../src/googleAds/client.ts";

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

const optionalMetaVariableNames = [
  "META_ACCESS_TOKEN",
  "META_AD_ACCOUNT_ID",
  "META_API_VERSION",
  "META_API_BASE_URL",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_BUSINESS_ID"
];

const optionalGoogleAdsVariableNames = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_API_VERSION",
  "GOOGLE_ADS_API_BASE_URL",
  "GOOGLE_ADS_OAUTH_TOKEN_URL"
];

const config = loadConfig();
const output = {
  applicationHealth: await checkHealth(config),
  database: await checkDatabase(config.databaseUrl),
  requiredEnvironmentVariables: Object.fromEntries(requiredVariableNames.map((name) => [name, Boolean(process.env[name])])),
  goHighLevelEnvironmentVariables: Object.fromEntries(optionalGoHighLevelVariableNames.map((name) => [name, Boolean(process.env[name])])),
  metaAdsEnvironmentVariables: Object.fromEntries(optionalMetaVariableNames.map((name) => [name, Boolean(process.env[name])])),
  googleAdsEnvironmentVariables: Object.fromEntries(optionalGoogleAdsVariableNames.map((name) => [name, Boolean(process.env[name])])),
  sweepAndGoModulesPresent: {
    incrementalDailySync: fs.existsSync("src/sweepandgo/incrementalDailySync.ts"),
    sync: fs.existsSync("src/sweepandgo/sync.ts"),
    historicalSync: fs.existsSync("src/sweepandgo/historicalSync.ts"),
    reportingMapper: fs.existsSync("src/sweepandgo/reportingMapper.ts"),
    reportingStore: fs.existsSync("src/sweepandgo/reportingStore.ts")
  },
  goHighLevelModuleLoads: typeof GoHighLevelClient === "function",
  metaAdsModuleLoads: typeof MetaAdsClient === "function",
  googleAdsModuleLoads: typeof GoogleAdsClient === "function"
};

console.log(JSON.stringify(output, null, 2));

if (!output.applicationHealth.ok || output.database.status === "failed" || !output.goHighLevelModuleLoads || !output.metaAdsModuleLoads || !output.googleAdsModuleLoads) {
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
