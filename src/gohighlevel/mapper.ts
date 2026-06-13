import type { NormalizedCustomerSource } from "../reporting/sourceNormalization.ts";
import { normalizeCustomerSource } from "../reporting/sourceNormalization.ts";
import type { GoHighLevelStageConfig } from "./stageConfig.ts";

export type GoHighLevelOpportunityMapping = {
  externalOpportunityId?: string;
  externalContactId?: string;
  locationId?: string;
  pipelineId?: string;
  pipelineName?: string;
  stageId?: string;
  stageName?: string;
  status?: string;
  assignedTo?: string;
  source: NormalizedCustomerSource;
  sourceRaw?: string;
  createdAt?: string;
  updatedAt?: string;
  currentStage?: string;
  originalLeadSource: NormalizedCustomerSource;
  originalLeadDate?: string;
  firstStageEnteredDate?: string;
  historicalStageSource: "webhook_stage_history" | "current_stage_only" | "unavailable";
  reconciliationIssue?: string;
};

export type GoHighLevelContactMapping = {
  externalContactId?: string;
  locationId?: string;
  name?: string;
  email?: string;
  phone?: string;
  createdAt?: string;
  source: NormalizedCustomerSource;
  sourceRaw?: string;
  assignedTo?: string;
  tags: string[];
  customFields: Array<{ id?: string; valueType: string }>;
};

export function mapGoHighLevelOpportunity(
  payload: unknown,
  stageConfig: GoHighLevelStageConfig,
  stageNameById: Record<string, string> = {}
): GoHighLevelOpportunityMapping {
  const record = asRecord(payload) ?? {};
  const stageId = stringValue(record.pipelineStageId ?? record.stageId);
  const stageName = stringValue(record.pipelineStageName ?? record.stageName) ?? (stageId ? stageNameById[stageId] : undefined);
  const sourceRaw = stringValue(record.source);
  const currentStageSource = classifyStage(stageId, stageName, stageConfig);
  const normalizedSource = normalizeCustomerSource(sourceRaw);
  const createdAt = stringValue(record.dateAdded ?? record.createdAt);
  const updatedAt = stringValue(record.dateUpdated ?? record.updatedAt);
  const previousOriginalSource = normalizeStoredSource(record.originalLeadSource);
  const originalLeadSource = previousOriginalSource ?? currentStageSource ?? normalizedSource;
  const originalLeadDate = previousOriginalSource ? stringValue(record.originalLeadDate) : currentStageSource ? createdAt : undefined;
  const reconciliationIssue = previousOriginalSource && currentStageSource && previousOriginalSource !== currentStageSource
    ? "opportunity_changed_between_primary_lead_sources"
    : undefined;

  return {
    externalOpportunityId: stringValue(record.id ?? record.opportunityId),
    externalContactId: stringValue(record.contactId),
    locationId: stringValue(record.locationId),
    pipelineId: stringValue(record.pipelineId),
    pipelineName: stringValue(record.pipelineName),
    stageId,
    stageName,
    status: stringValue(record.status),
    assignedTo: stringValue(record.assignedTo),
    source: normalizedSource,
    sourceRaw,
    createdAt,
    updatedAt,
    currentStage: stageName,
    originalLeadSource,
    originalLeadDate,
    firstStageEnteredDate: undefined,
    historicalStageSource: currentStageSource ? "current_stage_only" : "unavailable",
    reconciliationIssue
  };
}

export function mapGoHighLevelContact(payload: unknown): GoHighLevelContactMapping {
  const record = asRecord(payload) ?? {};
  const sourceRaw = stringValue(record.source);
  const customFields = Array.isArray(record.customFields)
    ? record.customFields.filter(isRecord).map((field) => ({
      id: stringValue(field.id),
      valueType: Array.isArray(field.value) ? "array" : typeof field.value
    }))
    : [];

  return {
    externalContactId: stringValue(record.id ?? record.contactId),
    locationId: stringValue(record.locationId),
    name: stringValue(record.name),
    email: normalizeEmail(record.email),
    phone: normalizePhone(record.phone),
    createdAt: stringValue(record.dateAdded ?? record.createdAt),
    source: normalizeCustomerSource(sourceRaw),
    sourceRaw,
    assignedTo: stringValue(record.assignedTo),
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [],
    customFields
  };
}

export function classifyStage(
  stageId: string | undefined,
  stageName: string | undefined,
  stageConfig: GoHighLevelStageConfig
): NormalizedCustomerSource | undefined {
  if (stageConfig.facebookNewLeadStageId && stageId === stageConfig.facebookNewLeadStageId) {
    return "facebook";
  }
  if (stageConfig.websiteQuoteLeadStageId && stageId === stageConfig.websiteQuoteLeadStageId) {
    return "website";
  }

  const normalizedStageName = stageName?.trim().toLowerCase();
  if (!normalizedStageName) {
    return undefined;
  }

  if (normalizedStageName === stageConfig.facebookNewLeadStageName.trim().toLowerCase()) {
    return "facebook";
  }
  if (normalizedStageName === stageConfig.websiteQuoteLeadStageName.trim().toLowerCase()) {
    return "website";
  }

  return undefined;
}

export function buildOpportunityWebhookDeduplicationKey(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }

  const type = stringValue(record.type);
  const id = stringValue(record.id ?? record.opportunityId);
  const stageId = stringValue(record.pipelineStageId ?? record.stageId);
  const status = stringValue(record.status);
  const date = stringValue(record.dateAdded ?? record.dateUpdated ?? record.updatedAt);
  return type && id ? [type, id, stageId, status, date].filter(Boolean).join(":") : undefined;
}

export function normalizeEmail(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

export function normalizePhone(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits || undefined;
}

function normalizeStoredSource(value: unknown): NormalizedCustomerSource | undefined {
  if (value === "facebook" || value === "website" || value === "other" || value === "unknown") {
    return value;
  }
  return undefined;
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
