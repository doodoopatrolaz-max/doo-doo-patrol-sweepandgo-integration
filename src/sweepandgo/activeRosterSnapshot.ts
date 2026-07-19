import { loadConfig } from "../config.ts";
import { createPool } from "../db/pool.ts";
import { logger, serializeError } from "../logger.ts";
import { SweepAndGoClient } from "./client.ts";
import { extractSweepAndGoRows, mapSweepAndGoCustomer } from "./reportingMapper.ts";
import { SweepAndGoReportingStore } from "./reportingStore.ts";
import { maxPagesFromArgs } from "./sync.ts";

type Queryable = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type ActiveRosterSnapshot = {
  snapshotDate: string;
  source: "sweepandgo_count_active_clients";
  activeClientCount: number;
  activeApiClientCount: number;
  activeNoSubscriptionCount: number;
  derivedActiveWithSubscriptionCount: number;
  derivedActiveRecurringCount: number;
  sourceReportCount: number;
  recordsRead: number;
  recordsWritten: number;
  activePagesFetched?: number;
  activeNoSubscriptionPagesFetched?: number;
};

type ActiveRosterClient = Pick<SweepAndGoClient, "countActiveClients" | "getActiveClients" | "getActiveClientsWithoutSubscription">;

export async function buildActiveRosterSnapshot(input: {
  client: ActiveRosterClient;
  snapshotDate?: string;
  maxPages?: number;
}): Promise<ActiveRosterSnapshot> {
  const snapshotDate = input.snapshotDate ?? new Date().toISOString().slice(0, 10);
  const maxPages = input.maxPages ?? 25;
  const [countResponse, activeResponse, activeNoSubscriptionResponse] = await Promise.all([
    input.client.countActiveClients(),
    input.client.getActiveClients({ allPages: true, maxPages }),
    input.client.getActiveClientsWithoutSubscription({ allPages: true, maxPages })
  ]);

  const sourceReportCount = numericDataValue(countResponse);
  const activeRows = extractSweepAndGoRows(activeResponse);
  const activeNoSubscriptionRows = extractSweepAndGoRows(activeNoSubscriptionResponse);
  const activeClientIds = uniqueIds(activeRows);
  const activeNoSubscriptionIds = uniqueIds(activeNoSubscriptionRows);
  const derivedActiveWithSubscriptionCount = [...activeClientIds].filter((id) => !activeNoSubscriptionIds.has(id)).length;
  const derivedActiveRecurringCount = activeRows.filter((row) => {
    const mapped = mapSweepAndGoCustomer(row, "active");
    return Boolean(mapped?.serviceCadence === "recurring" && !activeNoSubscriptionIds.has(mapped.externalCustomerId));
  }).length;

  return {
    snapshotDate,
    source: "sweepandgo_count_active_clients",
    activeClientCount: sourceReportCount,
    activeApiClientCount: activeClientIds.size,
    activeNoSubscriptionCount: activeNoSubscriptionIds.size,
    derivedActiveWithSubscriptionCount,
    derivedActiveRecurringCount,
    sourceReportCount,
    recordsRead: 1 + activeRows.length + activeNoSubscriptionRows.length,
    recordsWritten: 1,
    activePagesFetched: pagesFetched(activeResponse),
    activeNoSubscriptionPagesFetched: pagesFetched(activeNoSubscriptionResponse)
  };
}

export async function upsertActiveRosterSnapshot(pool: Queryable, snapshot: ActiveRosterSnapshot): Promise<void> {
  await pool.query(
    `INSERT INTO sweepandgo_active_roster_snapshots (
       snapshot_date,
       source,
       active_client_count,
       active_api_client_count,
       active_no_subscription_count,
       derived_active_with_subscription_count,
       derived_active_recurring_count,
       source_report_count,
       metadata
     )
     VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (snapshot_date, source)
     DO UPDATE SET active_client_count = EXCLUDED.active_client_count,
                   active_api_client_count = EXCLUDED.active_api_client_count,
                   active_no_subscription_count = EXCLUDED.active_no_subscription_count,
                   derived_active_with_subscription_count = EXCLUDED.derived_active_with_subscription_count,
                   derived_active_recurring_count = EXCLUDED.derived_active_recurring_count,
                   source_report_count = EXCLUDED.source_report_count,
                   metadata = EXCLUDED.metadata,
                   updated_at = NOW()`,
    [
      snapshot.snapshotDate,
      snapshot.source,
      snapshot.activeClientCount,
      snapshot.activeApiClientCount,
      snapshot.activeNoSubscriptionCount,
      snapshot.derivedActiveWithSubscriptionCount,
      snapshot.derivedActiveRecurringCount,
      snapshot.sourceReportCount,
      JSON.stringify({
        activePagesFetched: snapshot.activePagesFetched,
        activeNoSubscriptionPagesFetched: snapshot.activeNoSubscriptionPagesFetched,
        containsPrivateRosterRows: false
      })
    ]
  );
}

export async function runActiveRosterSnapshotSync(input: { maxPages?: number; dryRun?: boolean } = {}): Promise<ActiveRosterSnapshot> {
  const config = loadConfig();
  const client = new SweepAndGoClient(config);
  if (input.dryRun) {
    const snapshot = await buildActiveRosterSnapshot({ client, maxPages: input.maxPages });
    logger.info({
      dryRun: true,
      activeClientCount: snapshot.activeClientCount,
      activeApiClientCount: snapshot.activeApiClientCount,
      activeNoSubscriptionCount: snapshot.activeNoSubscriptionCount,
      derivedActiveWithSubscriptionCount: snapshot.derivedActiveWithSubscriptionCount,
      derivedActiveRecurringCount: snapshot.derivedActiveRecurringCount
    }, "Sweep&Go active roster snapshot dry run completed");
    return snapshot;
  }

  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required for Sweep&Go active roster snapshot sync");
  }

  const pool = await createPool(config.databaseUrl);
  const store = new SweepAndGoReportingStore(pool);
  const syncRun = await store.startSyncRun("sweepandgo_active_roster_snapshot");

  try {
    const snapshot = await buildActiveRosterSnapshot({ client, maxPages: input.maxPages });
    await upsertActiveRosterSnapshot(pool, snapshot);
    await store.completeSyncRun(syncRun.id, {
      recordsRead: snapshot.recordsRead,
      recordsWritten: snapshot.recordsWritten
    });
    logger.info({
      activeClientCount: snapshot.activeClientCount,
      activeApiClientCount: snapshot.activeApiClientCount,
      activeNoSubscriptionCount: snapshot.activeNoSubscriptionCount,
      derivedActiveWithSubscriptionCount: snapshot.derivedActiveWithSubscriptionCount,
      derivedActiveRecurringCount: snapshot.derivedActiveRecurringCount
    }, "Sweep&Go active roster snapshot completed");
    return snapshot;
  } catch (error) {
    const serialized = serializeError(error);
    await store.failSyncRun(syncRun.id, serialized.message);
    throw error;
  } finally {
    await pool.end();
  }
}

export function activeRosterMaxPagesFromArgs(args: string[]): number {
  return maxPagesFromArgs(args, 25) ?? 25;
}

export function activeRosterDryRunFromArgs(args: string[]): boolean {
  return args.includes("--dry-run");
}

function uniqueIds(rows: Record<string, unknown>[]): Set<string> {
  return new Set(rows.map((row) => stringValue(row.client)).filter(Boolean));
}

function numericDataValue(response: unknown): number {
  const value = isRecord(response) ? response.data : undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Sweep&Go active client count response did not include a numeric data value");
  }
  return Math.trunc(parsed);
}

function pagesFetched(response: unknown): number | undefined {
  if (!isRecord(response)) {
    return undefined;
  }
  const value = response.pagesFetched;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
