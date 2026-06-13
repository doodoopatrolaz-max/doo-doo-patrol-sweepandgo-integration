import http from "node:http";
import { loadConfig } from "./config.ts";
import { createPool } from "./db/pool.ts";
import { createRequestHandler } from "./http/app.ts";
import { logger } from "./logger.ts";
import { InMemoryOnboardingIntakeStore } from "./onboarding/inMemoryStore.ts";
import { OnboardingWebhookProcessor } from "./onboarding/intake.ts";
import { PostgresOnboardingIntakeStore } from "./onboarding/postgresStore.ts";
import { startDailyDashboardScheduler } from "./reports/scheduler.ts";
import { SweepAndGoClient } from "./sweepandgo/client.ts";
import { InMemoryWebhookEventStore } from "./webhooks/inMemoryStore.ts";
import { PostgresWebhookEventStore } from "./webhooks/postgresStore.ts";

const config = loadConfig();

const pool = config.databaseUrl ? await createPool(config.databaseUrl) : undefined;
const webhookStore = pool ? new PostgresWebhookEventStore(pool) : new InMemoryWebhookEventStore();
const onboardingStore = pool ? new PostgresOnboardingIntakeStore(pool) : new InMemoryOnboardingIntakeStore();
const sweepandgoClient = new SweepAndGoClient(config);
const webhookProcessor = new OnboardingWebhookProcessor(onboardingStore, sweepandgoClient);

if (!config.databaseUrl) {
  logger.warn("DATABASE_URL is not configured; using temporary in-memory webhook storage");
}
const app = createRequestHandler({ config, webhookStore, webhookProcessor });
const dailyDashboardTimer = startDailyDashboardScheduler(config);

const server = http.createServer(app).listen(config.port, config.host, () => {
  logger.info(
    {
      port: config.port,
      host: config.host,
      sweepandgoApiConfigured: Boolean(config.sweepgoApiToken)
    },
    "Sweep&Go integration server listening"
  );
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down Sweep&Go integration server");
  if (dailyDashboardTimer) {
    clearInterval(dailyDashboardTimer);
  }
  server.close(async () => {
    await pool?.end();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
