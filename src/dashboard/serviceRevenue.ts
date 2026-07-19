import type { DashboardDateRange } from "./dateRange.ts";
import type { DashboardRevenuePerHourMetrics } from "./types.ts";

export type CompletedJobRevenueInputRow = {
  payload: unknown;
  receivedAt?: unknown;
};

export type CompletedJobRevenueFactInputRow = {
  serviceDate?: unknown;
  technicianKey?: unknown;
  stopFingerprint?: unknown;
  jobStatus?: unknown;
  jobType?: unknown;
  allocatedServicePrice?: unknown;
  recordedDurationMinutes?: unknown;
  isSpray?: unknown;
  isInitial?: unknown;
};

type ParsedCompletedJob = {
  routeDate?: string;
  employeeId?: string;
  stopKey?: string;
  status: string;
  type: string;
  price?: number;
  durationMinutes?: number;
  isSpray: boolean;
  isInitial: boolean;
  isBoundary: boolean;
};

const SPRAY_PATTERN = /fresh poo|vipoo|king poo|spray|deodorizer|deodoriser|sanitize|sanitizer|doo doo destroyer/i;
const INITIAL_PATTERN = /\binitial\b|initial cleanup|initial clean|first cleanup|first clean|initial service/i;
const INVALID_STATUS_PATTERN = /\b(skip|skipped|missed|canceled|cancelled|incomplete)\b/i;
const ROUTE_BOUNDARY_PATTERN = /^(start|finish|end)$/i;

export function calculateCompletedJobRevenueMetrics(
  rows: CompletedJobRevenueInputRow[],
  range: DashboardDateRange
): DashboardRevenuePerHourMetrics {
  return calculateParsedCompletedJobRevenueMetrics(rows
    .map(parseCompletedJob)
    .filter((job): job is ParsedCompletedJob => Boolean(job.routeDate))
    .filter((job) => job.routeDate! >= range.startDate && job.routeDate! <= range.endDate), range);
}

export function calculateCompletedJobRevenueMetricsFromFacts(
  rows: CompletedJobRevenueFactInputRow[],
  range: DashboardDateRange
): DashboardRevenuePerHourMetrics {
  return calculateParsedCompletedJobRevenueMetrics(rows.map((row) => ({
    routeDate: stringValue(row.serviceDate)?.slice(0, 10),
    employeeId: stringValue(row.technicianKey),
    stopKey: stringValue(row.stopFingerprint),
    status: (stringValue(row.jobStatus) ?? "unknown").toLowerCase(),
    type: (stringValue(row.jobType) ?? "").toLowerCase(),
    price: numberValue(row.allocatedServicePrice),
    durationMinutes: numberValue(row.recordedDurationMinutes),
    isSpray: booleanValue(row.isSpray),
    isInitial: booleanValue(row.isInitial),
    isBoundary: ROUTE_BOUNDARY_PATTERN.test((stringValue(row.jobType) ?? "").trim())
  })).filter((job) =>
    job.routeDate !== undefined
      && job.routeDate >= range.startDate
      && job.routeDate <= range.endDate
  ), range);
}

function calculateParsedCompletedJobRevenueMetrics(
  parsedJobs: ParsedCompletedJob[],
  _range: DashboardDateRange
): DashboardRevenuePerHourMetrics {
  const completedJobs = parsedJobs.filter((job) => !isExcludedJob(job));
  const missingPriceRows = completedJobs.filter((job) => job.price === undefined).length;
  const pricedJobs = completedJobs.filter((job) => job.price !== undefined);
  const stopGroups = groupJobsByStop(completedJobs);
  const timedCompletedJobs = completedJobs.filter((job) => (job.durationMinutes ?? 0) > 0);
  const serviceRevenue = pricedJobs.reduce((sum, job) => sum + (job.price ?? 0), 0);
  const serviceMinutes = timedCompletedJobs.reduce((sum, job) => sum + (job.durationMinutes ?? 0), 0);
  const serviceHours = serviceMinutes / 60;
  const completedStopKeys = new Set(completedJobs.map(stopGroupKey));
  const scoopSprayCombinedStopGroups = [...stopGroups.values()].filter((jobs) =>
    jobs.some((job) => job.isSpray) && jobs.some((job) => !job.isSpray && !job.isInitial)
  ).length;
  const zeroDurationRows = pricedJobs.filter((job) => (job.durationMinutes ?? 0) <= 0);
  const zeroDurationRowsAttachedToValidStop = zeroDurationRows.filter((job) =>
    stopGroups.get(stopGroupKey(job))?.some((groupJob) => (groupJob.durationMinutes ?? 0) > 0)
  ).length;
  const zeroDurationRowsExcluded = 0;
  const sprayRevenue = pricedJobs
    .filter((job) => job.isSpray)
    .reduce((sum, job) => sum + (job.price ?? 0), 0);
  const initialRevenue = pricedJobs
    .filter((job) => job.isInitial)
    .reduce((sum, job) => sum + (job.price ?? 0), 0);
  const scoopingRevenue = pricedJobs
    .filter((job) => !job.isSpray && !job.isInitial)
    .reduce((sum, job) => sum + (job.price ?? 0), 0);

  return {
    rawCompletedJobRows: parsedJobs.length,
    eligibleRows: completedJobs.length,
    excludedRows: parsedJobs.length - completedJobs.length,
    sameStopGroupsCreated: completedStopKeys.size,
    scoopSprayCombinedStopGroups,
    zeroDurationRows: zeroDurationRows.length,
    zeroDurationRowsAttachedToValidStop,
    zeroDurationRowsExcluded,
    missingPriceRows,
    serviceRevenue: roundMoney(serviceRevenue),
    serviceHours: roundMoney(serviceHours),
    completedJobs: completedJobs.length,
    completedStops: completedStopKeys.size,
    pricedCompletedJobs: pricedJobs.length,
    timedCompletedJobs: timedCompletedJobs.length,
    zeroDurationRevenueJobs: zeroDurationRows.length,
    scoopingRevenue: roundMoney(scoopingRevenue),
    sprayRevenue: roundMoney(sprayRevenue),
    initialCleanupRevenue: roundMoney(initialRevenue),
    revenuePerStop: completedStopKeys.size > 0 ? roundMoney(serviceRevenue / completedStopKeys.size) : null,
    averageMinutesPerStop: completedStopKeys.size > 0 ? roundMoney(serviceMinutes / completedStopKeys.size) : null,
    status: serviceRevenue > 0 && serviceHours > 0 ? "available" : "unavailable",
    unavailableReason: parsedJobs.length === 0
      ? "No stored Sweep&Go completed job rows were available for the selected range."
      : serviceHours <= 0
        ? "Stored completed job rows did not include usable positive service duration."
        : serviceRevenue <= 0
          ? "Stored completed job rows did not include usable positive service revenue."
          : undefined
  };
}

function groupJobsByStop(jobs: ParsedCompletedJob[]): Map<string, ParsedCompletedJob[]> {
  const groups = new Map<string, ParsedCompletedJob[]>();
  for (const job of jobs) {
    const key = stopGroupKey(job);
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return groups;
}

function stopGroupKey(job: ParsedCompletedJob): string {
  return [job.employeeId ?? "unknown", job.routeDate, job.stopKey ?? "unknown"].join(":");
}

function parseCompletedJob(row: CompletedJobRevenueInputRow): ParsedCompletedJob {
  const payload = record(row.payload);
  const data = record(payload.data);
  const routeDate = routeDateFor(data, row.receivedAt);
  const status = (stringValue(data.status_name) ?? stringValue(data.status) ?? "completed").toLowerCase();
  const type = (stringValue(data.type) ?? stringValue(data.job_type) ?? "").toLowerCase();
  const classificationText = [
    data.type,
    data.job_type,
    data.pricing_plan_name,
    data.service_plan_name,
    data.service_label
  ].map((value) => stringValue(value) ?? "").join(" ");

  return {
    routeDate,
    employeeId: stringValue(data.assigned_to_id) ?? stringValue(data.employee_id),
    stopKey: stringValue(data.client_location_id)
      ?? stringValue(data.client_id)
      ?? stringValue([stringValue(data.first_name), stringValue(data.last_name)].filter(Boolean).join(" ").toLowerCase())
      ?? stringValue(data.job_id)
      ?? stringValue(data.id),
    status,
    type,
    price: moneyValue(data.price),
    durationMinutes: durationMinutes(data.duration) ?? durationBetween(data.start_time, data.end_time),
    isSpray: SPRAY_PATTERN.test(classificationText),
    isInitial: INITIAL_PATTERN.test(classificationText),
    isBoundary: ROUTE_BOUNDARY_PATTERN.test(type.trim())
  };
}

function isExcludedJob(job: ParsedCompletedJob): boolean {
  return job.isBoundary
    || INVALID_STATUS_PATTERN.test(job.status)
    || INVALID_STATUS_PATTERN.test(job.type)
    || job.status !== "completed";
}

function routeDateFor(data: Record<string, unknown>, receivedAt: unknown): string | undefined {
  const explicitDate = stringValue(data.date)?.slice(0, 10);
  if (explicitDate && /^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) {
    return explicitDate;
  }
  const received = stringValue(receivedAt)?.slice(0, 10);
  return received && /^\d{4}-\d{2}-\d{2}$/.test(received) ? received : undefined;
}

function durationMinutes(value: unknown): number | undefined {
  const raw = stringValue(value);
  if (!raw) {
    return undefined;
  }
  const parts = raw.split(":").map((part) => Number(part));
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return parts[0] * 60 + parts[1] + parts[2] / 60;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function durationBetween(start: unknown, end: unknown): number | undefined {
  const startParts = timeParts(start);
  const endParts = timeParts(end);
  if (!startParts || !endParts) {
    return undefined;
  }
  const startMinutes = startParts.hours * 60 + startParts.minutes + startParts.seconds / 60;
  const endMinutes = endParts.hours * 60 + endParts.minutes + endParts.seconds / 60;
  return endMinutes >= startMinutes ? endMinutes - startMinutes : undefined;
}

function timeParts(value: unknown): { hours: number; minutes: number; seconds: number } | undefined {
  const raw = stringValue(value);
  const match = raw?.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) {
    return undefined;
  }
  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
    seconds: Number(match[3] ?? 0)
  };
}

function moneyValue(value: unknown): number | undefined {
  const raw = stringValue(value);
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return moneyValue(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    return ["1", "true", "yes"].includes(value.toLowerCase());
  }
  return false;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
