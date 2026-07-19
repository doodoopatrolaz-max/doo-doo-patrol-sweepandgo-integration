import { loadConfig } from "../config.ts";
import { createPool } from "../db/pool.ts";
import { calculateCompletedJobRevenueMetricsFromFacts } from "../dashboard/serviceRevenue.ts";
import { logger, serializeError } from "../logger.ts";
import { SweepAndGoClient } from "./client.ts";
import {
  extractCompletedJobReportRows,
  mapSweepAndGoCompletedJob,
  summarizeCompletedJobFacts,
  type SweepAndGoCompletedJobFact
} from "./completedJobsMapper.ts";
import { SweepAndGoCompletedJobsStore } from "./completedJobsStore.ts";

export type SweepAndGoCompletedJobsSyncOptions = {
  startDate: string;
  endDate: string;
  maxPages: number;
  dryRun?: boolean;
};

export type SweepAndGoCompletedJobsSyncResult = {
  status: "dry_run" | "completed";
  startDate: string;
  endDate: string;
  recordsRead: number;
  recordsWritten: number;
  rowsInserted: number;
  rowsUpdated: number;
  completedJobRowsFound: number;
  completedJobRowsEligible: number;
  excludedRows: number;
  rowsMissingPrice: number;
  rowsMissingOrZeroDuration: number;
  distinctStops: number;
  recordedServiceHours: number;
  totalServiceRevenue: number;
  scoopingRevenue: number;
  sprayRevenue: number;
  otherRevenue: number;
  averageRevenuePerServiceHour: number | null;
  revenuePerStop: number | null;
  averageMinutesPerStop: number | null;
  techniciansFound: number;
};

export async function runSweepAndGoCompletedJobsSync(
  options: SweepAndGoCompletedJobsSyncOptions
): Promise<SweepAndGoCompletedJobsSyncResult> {
  const dates = enumerateDates(options.startDate, options.endDate, options.maxPages);
  const config = loadConfig();
  if (!config.databaseUrl && !options.dryRun) {
    throw new Error("DATABASE_URL is required for Sweep&Go completed jobs sync");
  }

  const client = new SweepAndGoClient(config);
  const facts: SweepAndGoCompletedJobFact[] = [];
  let recordsRead = 0;

  for (const date of dates) {
    const response = await client.getCompletedJobsReport({ date });
    const rows = extractCompletedJobReportRows(response);
    recordsRead += rows.length;
    for (const row of rows) {
      const fact = mapSweepAndGoCompletedJob(row, date);
      if (fact) {
        facts.push(fact);
      }
    }
  }

  const mapping = summarizeCompletedJobFacts(facts);
  const metrics = calculateCompletedJobRevenueMetricsFromFacts(facts.map((fact) => ({
    serviceDate: fact.serviceDate,
    technicianKey: fact.technicianKey,
    stopFingerprint: fact.stopFingerprint,
    jobStatus: fact.jobStatus,
    jobType: fact.jobType,
    allocatedServicePrice: fact.allocatedServicePrice,
    recordedDurationMinutes: fact.recordedDurationMinutes,
    isSpray: fact.isSpray,
    isInitial: fact.isInitial
  })), { startDate: options.startDate, endDate: options.endDate, key: "custom", label: "Custom", timeZone: "America/Phoenix" });

  let rowsInserted = 0;
  let rowsUpdated = 0;
  if (!options.dryRun) {
    const pool = await createPool(config.databaseUrl!);
    const store = new SweepAndGoCompletedJobsStore(pool);
    const syncRun = await store.startSyncRun();
    try {
      for (const fact of facts) {
        const result = await store.upsertCompletedJob(fact);
        if (result.inserted) {
          rowsInserted += 1;
        } else if (result.updated) {
          rowsUpdated += 1;
        }
      }
      await store.completeSyncRun(syncRun.id, { recordsRead, recordsWritten: rowsInserted + rowsUpdated });
    } catch (error) {
      await store.failSyncRun(syncRun.id, serializeError(error).message);
      throw error;
    } finally {
      await pool.end();
    }
  }

  const result = {
    status: options.dryRun ? "dry_run" as const : "completed" as const,
    startDate: options.startDate,
    endDate: options.endDate,
    recordsRead,
    recordsWritten: rowsInserted + rowsUpdated,
    rowsInserted,
    rowsUpdated,
    completedJobRowsFound: mapping.rowsFound,
    completedJobRowsEligible: mapping.rowsEligible,
    excludedRows: mapping.rowsExcludedByStatus,
    rowsMissingPrice: mapping.rowsMissingPrice,
    rowsMissingOrZeroDuration: mapping.rowsMissingOrZeroDuration,
    distinctStops: metrics.completedStops,
    recordedServiceHours: metrics.serviceHours,
    totalServiceRevenue: metrics.serviceRevenue,
    scoopingRevenue: metrics.scoopingRevenue,
    sprayRevenue: metrics.sprayRevenue,
    otherRevenue: roundMoney(metrics.serviceRevenue - metrics.scoopingRevenue - metrics.sprayRevenue - metrics.initialCleanupRevenue),
    averageRevenuePerServiceHour: metrics.status === "available" && metrics.serviceHours > 0
      ? roundMoney(metrics.serviceRevenue / metrics.serviceHours)
      : null,
    revenuePerStop: metrics.revenuePerStop,
    averageMinutesPerStop: metrics.averageMinutesPerStop,
    techniciansFound: mapping.techniciansFound
  };

  logger.info({
    status: result.status,
    startDate: result.startDate,
    endDate: result.endDate,
    recordsRead: result.recordsRead,
    recordsWritten: result.recordsWritten,
    completedJobRowsEligible: result.completedJobRowsEligible
  }, "Sweep&Go completed jobs sync finished");

  return result;
}

export function completedJobsSyncOptionsFromArgs(args: string[]): SweepAndGoCompletedJobsSyncOptions {
  const parsed = parseArgs(args);
  const startDate = parsed.start ?? parsed.date;
  const endDate = parsed.end ?? parsed.date ?? startDate;
  if (!startDate || !endDate) {
    throw new Error("--start and --end are required, or pass --date=YYYY-MM-DD");
  }
  return {
    startDate,
    endDate,
    maxPages: positiveInteger(parsed["max-pages"] ?? "25", "--max-pages"),
    dryRun: parsed["dry-run"] === "true" || parsed["dry-run"] === "1" || args.includes("--dry-run")
  };
}

function enumerateDates(startDate: string, endDate: string, maxDays: number): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("Dates must use YYYY-MM-DD format");
  }
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (end < start) {
    throw new Error("--end must be on or after --start");
  }
  const dates: string[] = [];
  for (let cursor = start; cursor <= end && dates.length < maxDays; cursor = new Date(cursor.getTime() + 86_400_000)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function parseArgs(values: string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const value of values) {
    const match = value.match(/^--([^=]+)=(.*)$/);
    if (match) {
      output[match[1]] = match[2];
    }
  }
  return output;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return Math.floor(parsed);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
