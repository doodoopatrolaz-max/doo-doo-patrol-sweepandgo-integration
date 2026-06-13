import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.ts";
import { createPool } from "./pool.ts";
import { logger } from "../logger.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const pool = await createPool(config.databaseUrl);
  const migrationPath = path.resolve(__dirname, "../../migrations/001_create_webhook_events.sql");
  const sql = await fs.readFile(migrationPath, "utf8");

  try {
    await pool.query(sql);
    logger.info("Database migration completed");
  } finally {
    await pool.end();
  }
}

migrate().catch((error) => {
  logger.error({ error }, "Database migration failed");
  process.exit(1);
});
