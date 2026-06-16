import { loadConfig } from "../config.ts";
import { createPool } from "../db/pool.ts";
import { MetaAdsClient } from "./client.ts";
import { mapMetaAdsInsightsRow, type MetaAdsInsightsRow } from "./mapper.ts";
import { MetaAdsReportingStore } from "./store.ts";

export type MetaAdsDailySyncOptions = {
  date: string;
  maxPages: number;
  limit: number;
};

export async function runMetaAdsDailySync(options: MetaAdsDailySyncOptions): Promise<{
  status: "completed" | "failed";
  recordsRead: number;
  recordsWritten: number;
}> {
  const config = loadConfig();
  const client = MetaAdsClient.fromConfig(config);
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = await createPool(config.databaseUrl);
  const store = new MetaAdsReportingStore(pool);
  const syncRun = await store.startSyncRun("daily", {
    date: options.date,
    maxPages: options.maxPages,
    level: "campaign"
  });

  try {
    const account = await client.getAdAccount();
    const rows = await client.getInsights({
      since: options.date,
      until: options.date,
      level: "campaign",
      maxPages: options.maxPages,
      limit: options.limit
    });

    let written = 0;
    for (const row of rows) {
      await store.upsertDailyPerformance(mapMetaAdsInsightsRow(row as MetaAdsInsightsRow, {
        accountTimezone: stringValue(account.timezone_name),
        currency: stringValue(account.currency)
      }));
      written += 1;
    }

    await store.completeSyncRun(syncRun.id, {
      recordsRead: rows.length,
      recordsWritten: written
    });

    return {
      status: "completed",
      recordsRead: rows.length,
      recordsWritten: written
    };
  } catch (error) {
    await store.failSyncRun(syncRun.id, error instanceof Error ? error.message : "Meta Ads sync failed");
    throw error;
  } finally {
    await pool.end();
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
