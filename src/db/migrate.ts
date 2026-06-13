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
  const migrationsDirectory = path.resolve(__dirname, "../../migrations");
  const migrationFiles = (await fs.readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  try {
    for (const file of migrationFiles) {
      const sql = await fs.readFile(path.join(migrationsDirectory, file), "utf8");
      await pool.query(sql);
      logger.info({ migration: file }, "Database migration completed");
    }
  } finally {
    await pool.end();
  }
}

migrate().catch((error) => {
  logger.error({ error }, "Database migration failed");
  process.exit(1);
});
