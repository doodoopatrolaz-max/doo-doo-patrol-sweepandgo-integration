import { loadConfig } from "../config.ts";
import { createPool } from "../db/pool.ts";
import { GoogleAdsClient } from "./client.ts";
import { mapGoogleAdsCampaignRow } from "./mapper.ts";
import { GoogleAdsReportingStore } from "./store.ts";

export type GoogleAdsDailySyncOptions = {
  date: string;
  maxPages: number;
  pageSize: number;
};

export async function runGoogleAdsDailySync(options: GoogleAdsDailySyncOptions): Promise<{
  status: "completed" | "failed";
  recordsRead: number;
  recordsWritten: number;
  totalSpend: string;
}> {
  const config = loadConfig();
  const client = GoogleAdsClient.fromConfig(config);
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = await createPool(config.databaseUrl);
  const store = new GoogleAdsReportingStore(pool);
  const syncRun = await store.startSyncRun("daily", {
    date: options.date,
    maxPages: options.maxPages,
    level: "campaign"
  });

  try {
    const rows = await client.getCampaignPerformance({
      date: options.date,
      maxPages: options.maxPages,
      pageSize: options.pageSize
    });

    let written = 0;
    let totalSpend = 0;
    for (const row of rows) {
      const mapped = mapGoogleAdsCampaignRow(row);
      await store.upsertDailyPerformance(mapped);
      totalSpend += Number(mapped.spendAmount);
      written += 1;
    }

    await store.completeSyncRun(syncRun.id, {
      recordsRead: rows.length,
      recordsWritten: written
    });

    return {
      status: "completed",
      recordsRead: rows.length,
      recordsWritten: written,
      totalSpend: totalSpend.toFixed(2)
    };
  } catch (error) {
    await store.failSyncRun(syncRun.id, error instanceof Error ? error.message : "Google Ads sync failed");
    throw error;
  } finally {
    await pool.end();
  }
}
