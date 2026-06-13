import http from "node:http";
import { loadConfig } from "./config.ts";
import { createPool } from "./db/pool.ts";
import { createRequestHandler } from "./http/app.ts";
import { logger } from "./logger.ts";
import { InMemoryWebhookEventStore } from "./webhooks/inMemoryStore.ts";
import { PostgresWebhookEventStore } from "./webhooks/postgresStore.ts";

const config = loadConfig();

const pool = config.databaseUrl ? await createPool(config.databaseUrl) : undefined;
const webhookStore = pool ? new PostgresWebhookEventStore(pool) : new InMemoryWebhookEventStore();

if (!config.databaseUrl) {
  logger.warn("DATABASE_URL is not configured; using temporary in-memory webhook storage");
}
const app = createRequestHandler({ config, webhookStore });

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
  server.close(async () => {
    await pool?.end();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
