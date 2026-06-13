import { loadConfig } from "../config.ts";
import { createPool } from "../db/pool.ts";
import { logger, serializeError } from "../logger.ts";
import { SweepAndGoClient } from "./client.ts";
import {
  extractSweepAndGoRows,
  mapSweepAndGoCustomer,
  mapSweepAndGoLead,
} from "./reportingMapper.ts";
import { SweepAndGoReportingStore } from "./reportingStore.ts";

export type SweepAndGoSyncOptions = {
  mode: "historical" | "daily";
  maxPages?: number;
};

export type SweepAndGoSyncResult = {
  recordsRead: number;
  recordsWritten: number;
};

export async function runSweepAndGoReportingSync(options: SweepAndGoSyncOptions): Promise<SweepAndGoSyncResult> {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required for Sweep&Go reporting sync");
  }

  const pool = await createPool(config.databaseUrl);
  const client = new SweepAndGoClient(config);
  const store = new SweepAndGoReportingStore(pool);
  const syncRun = await store.startSyncRun(options.mode === "historical" ? "sweepandgo_historical" : "sweepandgo_daily");
  let recordsRead = 0;
  let recordsWritten = 0;

  try {
    const maxPages = options.maxPages ?? (options.mode === "historical" ? 100 : 5);
    const customerSources = [
      { listType: "active" as const, response: await client.getActiveClients({ allPages: true, maxPages }) },
      { listType: "active_no_subscription" as const, response: await client.getActiveClientsWithoutSubscription({ allPages: true, maxPages }) },
      { listType: "inactive" as const, response: await client.getInactiveClients({ allPages: true, maxPages }) }
    ];

    for (const source of customerSources) {
      for (const row of extractSweepAndGoRows(source.response)) {
        recordsRead += 1;
        const mapped = mapSweepAndGoCustomer(row, source.listType);
        if (!mapped) {
          continue;
        }
        await store.upsertCustomer(mapped);
        recordsWritten += 1;
      }
    }

    const leads = await client.getLeads({ allPages: true, maxPages });
    for (const row of extractSweepAndGoRows(leads)) {
      recordsRead += 1;
      const mapped = mapSweepAndGoLead(row);
      if (!mapped) {
        continue;
      }
      await store.upsertLead(mapped);
      recordsWritten += 1;
    }

    await store.completeSyncRun(syncRun.id, { recordsRead, recordsWritten });
    logger.info({ recordsRead, recordsWritten, mode: options.mode }, "Sweep&Go reporting sync completed");
    return { recordsRead, recordsWritten };
  } catch (error) {
    const serialized = serializeError(error);
    await store.failSyncRun(syncRun.id, serialized.message);
    throw error;
  } finally {
    await pool.end();
  }
}

export function maxPagesFromArgs(args: string[], fallback?: number): number | undefined {
  const value = args.find((arg) => arg.startsWith("--max-pages="))?.slice("--max-pages=".length);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--max-pages must be a positive number");
  }

  return Math.floor(parsed);
}
