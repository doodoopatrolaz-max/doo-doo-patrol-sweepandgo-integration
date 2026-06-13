import type { NormalizedCustomerSource } from "../reporting/sourceNormalization.ts";
import { normalizeExplicitCustomerSource } from "../reporting/sourceNormalization.ts";

export type SweepAndGoCustomerStatus = "active" | "inactive" | "paused" | "cancelled" | "unknown";
export type SweepAndGoServiceCadence = "recurring" | "one_time" | "unknown";

export type SweepAndGoCustomerReportingRecord = {
  externalCustomerId: string;
  status: SweepAndGoCustomerStatus;
  hasActiveSubscription: boolean;
  isPaused: boolean;
  isOneTimeClient: boolean;
  serviceCadence: SweepAndGoServiceCadence;
  cleanupFrequency?: string;
  subscriptionNames?: string;
  serviceDays?: string;
  source: NormalizedCustomerSource;
  sourceRaw?: string;
  sourceEvidenceField?: string;
  monthlyRecurringRevenue?: number;
  currentAccountBalance?: number;
  raw: Record<string, unknown>;
};

export type SweepAndGoLeadReportingRecord = {
  externalLeadId: string;
  status: string;
  type?: string;
  source: NormalizedCustomerSource;
  sourceRaw?: string;
  sourceEvidenceField?: string;
  raw: Record<string, unknown>;
};

export function extractSweepAndGoRows(response: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(response)
    ? response
    : isRecord(response) && Array.isArray(response.data)
      ? response.data
      : [];

  return rows.filter(isRecord);
}

export function mapSweepAndGoCustomer(
  row: Record<string, unknown>,
  listType: "active" | "active_no_subscription" | "inactive" | "details" = "active"
): SweepAndGoCustomerReportingRecord | undefined {
  const externalCustomerId = stringValue(row.client);
  if (!externalCustomerId) {
    return undefined;
  }

  const status = normalizeStatus(row.status, listType);
  const subscriptionNames = stringValue(row.subscription_names);
  const cleanupFrequency = stringValue(row.cleanup_frequency);
  const isOneTimeClient = booleanValue(row.one_time_client) || cleanupFrequency === "one_time";
  const hasActiveSubscription = status === "active" && listType !== "active_no_subscription" && Boolean(subscriptionNames);
  const serviceCadence = isOneTimeClient ? "one_time" : hasActiveSubscription ? "recurring" : "unknown";
  const source = normalizeExplicitCustomerSource(row);

  return {
    externalCustomerId,
    status,
    hasActiveSubscription,
    isPaused: false,
    isOneTimeClient,
    serviceCadence,
    cleanupFrequency,
    subscriptionNames,
    serviceDays: stringValue(row.service_days),
    source: source.normalizedSource,
    sourceRaw: source.rawSource,
    sourceEvidenceField: source.evidenceField,
    monthlyRecurringRevenue: undefined,
    currentAccountBalance: undefined,
    raw: row
  };
}

export function mapSweepAndGoLead(row: Record<string, unknown>): SweepAndGoLeadReportingRecord | undefined {
  const externalLeadId = stringValue(row.lead);
  if (!externalLeadId) {
    return undefined;
  }

  const source = normalizeExplicitCustomerSource(row);

  return {
    externalLeadId,
    status: stringValue(row.status) ?? "unknown",
    type: stringValue(row.type),
    source: source.normalizedSource,
    sourceRaw: source.rawSource,
    sourceEvidenceField: source.evidenceField,
    raw: row
  };
}

export function calculateMonthlyRecurringRevenue(input: {
  amount?: number;
  frequency?: string;
}): number | undefined {
  if (input.amount === undefined || input.amount < 0 || !input.frequency) {
    return undefined;
  }

  const frequency = input.frequency.toLowerCase();
  if (frequency === "once_a_week" || frequency === "1xw" || frequency === "weekly") {
    return roundCurrency(input.amount * 4.33);
  }

  if (frequency === "two_times_a_week" || frequency === "2xw") {
    return roundCurrency(input.amount * 8.66);
  }

  if (frequency === "bi_weekly" || frequency === "biweekly") {
    return roundCurrency(input.amount * 2.17);
  }

  if (frequency === "twice_per_month") {
    return roundCurrency(input.amount * 2);
  }

  if (frequency === "once_a_month" || frequency === "monthly") {
    return roundCurrency(input.amount);
  }

  return undefined;
}

function normalizeStatus(value: unknown, listType: "active" | "active_no_subscription" | "inactive" | "details"): SweepAndGoCustomerStatus {
  const status = stringValue(value)?.toLowerCase();
  if (status === "active" || status === "inactive" || status === "paused" || status === "cancelled") {
    return status;
  }
  if (listType === "active" || listType === "active_no_subscription") {
    return "active";
  }
  if (listType === "inactive") {
    return "inactive";
  }
  return "unknown";
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

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
