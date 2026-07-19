import crypto from "node:crypto";

export type SweepAndGoCompletedJobFact = {
  externalJobId?: string;
  jobFingerprint: string;
  serviceDate: string;
  technicianKey?: string;
  technicianName?: string;
  jobStatus: string;
  jobType?: string;
  serviceCategory: "scooping" | "spray" | "initial" | "one_time" | "recurring" | "custom" | "other";
  allocatedServicePrice?: number;
  recordedDurationMinutes?: number;
  stopFingerprint: string;
  isScoop: boolean;
  isSpray: boolean;
  isInitial: boolean;
  isOneTime: boolean;
  isRecurring: boolean;
  source: "completed_jobs_report";
};

export type CompletedJobMappingSummary = {
  rowsFound: number;
  rowsEligible: number;
  rowsExcludedByStatus: number;
  rowsMissingPrice: number;
  rowsMissingOrZeroDuration: number;
  techniciansFound: number;
};

const SPRAY_PATTERN = /fresh poo|vipoo|king poo|spray|deodorizer|deodoriser|sanitize|sanitizer|doo doo destroyer/i;
const INITIAL_PATTERN = /\binitial\b|initial cleanup|initial clean|first cleanup|first clean|initial service/i;
const INVALID_STATUS_PATTERN = /\b(skip|skipped|missed|canceled|cancelled|incomplete)\b/i;
const ROUTE_BOUNDARY_PATTERN = /^(start|finish|end)$/i;

export function extractCompletedJobReportRows(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) {
    return response.filter(isRecord);
  }
  if (!isRecord(response)) {
    return [];
  }
  for (const key of ["job_list", "data", "jobs", "rows", "results"]) {
    const value = response[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  return [];
}

export function mapSweepAndGoCompletedJob(
  row: Record<string, unknown>,
  fallbackDate?: string
): SweepAndGoCompletedJobFact | undefined {
  const serviceDate = dateValue(row.date) ?? fallbackDate;
  if (!serviceDate) {
    return undefined;
  }

  const jobType = stringValue(row.type) ?? stringValue(row.job_type);
  const jobStatus = normalizedStatus(row);
  const externalJobId = positiveId(row.id) ?? positiveId(row.job_id);
  const technicianKey = stringValue(row.assigned_to_id)
    ?? stableHash(["technician", row.assigned_to_name, row.employee_id]);
  const technicianName = stringValue(row.assigned_to_name);
  const classificationText = [
    row.type,
    row.job_type,
    row.pricing_plan_name,
    row.service_plan_name,
    row.service_label,
    row.name
  ].map((value) => stringValue(value) ?? "").join(" ");
  const isSpray = SPRAY_PATTERN.test(classificationText);
  const isInitial = INITIAL_PATTERN.test(classificationText);
  const isOneTime = /\bone[_ -]?time\b|one time/i.test(classificationText);
  const isRecurring = /\brecurring\b/i.test(classificationText);
  const isBoundary = ROUTE_BOUNDARY_PATTERN.test((jobType ?? "").trim());
  const serviceCategory = isSpray
    ? "spray"
    : isInitial
      ? "initial"
      : isOneTime
        ? "one_time"
        : isRecurring
          ? "recurring"
          : jobType === "custom"
            ? "custom"
            : "other";
  const stopFingerprint = stableHash([
    "stop",
    serviceDate,
    row.client_location_id,
    row.client_id,
    row.client,
    row.customer_id,
    row.customer,
    row.first_name,
    row.last_name,
    row.address,
    row.street,
    row.service_address,
    row.full_address,
    row.latitude,
    row.longitude
  ]);
  const jobFingerprint = externalJobId
    ? stableHash(["job-id", externalJobId])
    : stableHash([
      "job",
      serviceDate,
      technicianKey,
      stopFingerprint,
      jobStatus,
      jobType,
      row.start_time,
      row.end_time,
      row.duration,
      row.price,
      row.pricing_plan_name,
      row.service_plan_name
    ]);

  return {
    externalJobId,
    jobFingerprint,
    serviceDate,
    technicianKey,
    technicianName,
    jobStatus,
    jobType,
    serviceCategory,
    allocatedServicePrice: moneyValue(row.price),
    recordedDurationMinutes: durationMinutes(row.duration) ?? durationBetween(row.start_time, row.end_time),
    stopFingerprint: isBoundary ? jobFingerprint : stopFingerprint,
    isScoop: !isSpray && !isInitial && !isBoundary,
    isSpray,
    isInitial,
    isOneTime,
    isRecurring,
    source: "completed_jobs_report"
  };
}

export function summarizeCompletedJobFacts(facts: SweepAndGoCompletedJobFact[]): CompletedJobMappingSummary {
  const eligible = facts.filter((fact) => isKpiEligibleCompletedJob(fact));
  return {
    rowsFound: facts.length,
    rowsEligible: eligible.length,
    rowsExcludedByStatus: facts.length - eligible.length,
    rowsMissingPrice: eligible.filter((fact) => fact.allocatedServicePrice === undefined).length,
    rowsMissingOrZeroDuration: eligible.filter((fact) => (fact.recordedDurationMinutes ?? 0) <= 0).length,
    techniciansFound: new Set(facts.map((fact) => fact.technicianKey).filter(Boolean)).size
  };
}

export function isKpiEligibleCompletedJob(fact: Pick<SweepAndGoCompletedJobFact, "jobStatus" | "jobType">): boolean {
  return fact.jobStatus === "completed"
    && !INVALID_STATUS_PATTERN.test(fact.jobStatus)
    && !INVALID_STATUS_PATTERN.test(fact.jobType ?? "")
    && !ROUTE_BOUNDARY_PATTERN.test((fact.jobType ?? "").trim());
}

function normalizedStatus(row: Record<string, unknown>): string {
  const status = stringValue(row.status_name) ?? stringValue(row.status);
  if (status) {
    return status.toLowerCase();
  }
  const statusId = Number(row.status_id);
  if (statusId === 2) {
    return "completed";
  }
  if (statusId === 3) {
    return "skipped";
  }
  if (statusId === 4) {
    return "missed";
  }
  return "unknown";
}

function positiveId(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw || raw === "0") {
    return undefined;
  }
  return raw;
}

function dateValue(value: unknown): string | undefined {
  const raw = stringValue(value)?.slice(0, 10);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

function durationMinutes(value: unknown): number | undefined {
  const raw = stringValue(value);
  if (!raw) {
    return undefined;
  }
  const parts = raw.split(":").map((part) => Number(part));
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return roundNumber(parts[0] * 60 + parts[1]);
  }
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return roundNumber(parts[0] * 60 + parts[1] + parts[2] / 60);
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? roundNumber(parsed) : undefined;
}

function durationBetween(start: unknown, end: unknown): number | undefined {
  const startParts = timeParts(start);
  const endParts = timeParts(end);
  if (!startParts || !endParts) {
    return undefined;
  }
  const startMinutes = startParts.hours * 60 + startParts.minutes + startParts.seconds / 60;
  const endMinutes = endParts.hours * 60 + endParts.minutes + endParts.seconds / 60;
  return endMinutes >= startMinutes ? roundNumber(endMinutes - startMinutes) : undefined;
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
  return Number.isFinite(parsed) ? roundNumber(parsed) : undefined;
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

function stableHash(parts: unknown[]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(parts.map((part) => stringValue(part) ?? null)))
    .digest("hex");
}

function roundNumber(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
