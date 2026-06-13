import type { AppConfig } from "../config.ts";
import { logger, sanitizeForLogs, serializeError } from "../logger.ts";
import { normalizeCustomerSource, type NormalizedCustomerSource } from "../reporting/sourceNormalization.ts";
import type { IntegrationEventRecord } from "../webhooks/integrationEventStore.ts";
import { classifyStage } from "./mapper.ts";
import type { GoHighLevelStageConfig } from "./stageConfig.ts";
import {
  type ExistingOpportunityRecord,
  type GoHighLevelWebhookStore
} from "./store.ts";

export type GoHighLevelWebhookProcessingResult = {
  status: "processed" | "ignored" | "failed";
  action: string;
  source?: NormalizedCustomerSource;
  reconciliationIssue?: string;
};

type ParsedGoHighLevelWebhook = {
  eventType: string;
  externalEventId?: string;
  externalOpportunityId?: string;
  externalContactId?: string;
  locationId?: string;
  pipelineId?: string;
  pipelineName?: string;
  stageId?: string;
  stageName?: string;
  previousStageId?: string;
  previousStageName?: string;
  status?: string;
  assignedTo?: string;
  sourceRaw?: string;
  eventTimestamp: string;
  isStageEvent: boolean;
  isStatusEvent: boolean;
  isOpportunityCreateEvent: boolean;
  isRelevantEvent: boolean;
  testRunId?: string;
};

const STAGE_EVENT_TYPES = new Set([
  "pipeline_stage_updated",
  "pipeline stage changed",
  "opportunitystageupdate",
  "opportunity_stage_update",
  "opportunity.stage.updated"
]);

const STATUS_EVENT_TYPES = new Set([
  "opportunity_status_changed",
  "opportunity status changed",
  "opportunitystatusupdate",
  "opportunity_status_update",
  "opportunity.status.updated"
]);

const OPPORTUNITY_CREATE_EVENT_TYPES = new Set([
  "opportunity_created",
  "opportunity created",
  "opportunitycreate",
  "opportunity_create",
  "opportunity.created"
]);

export class GoHighLevelWebhookProcessor {
  private readonly store: GoHighLevelWebhookStore;
  private readonly stageConfig: GoHighLevelStageConfig;

  constructor(store: GoHighLevelWebhookStore, config: AppConfig) {
    this.store = store;
    this.stageConfig = {
      locationId: config.goHighLevelLocationId,
      pipelineId: config.goHighLevelPipelineId,
      pipelineName: config.goHighLevelPipelineName,
      facebookNewLeadStageId: config.goHighLevelFacebookStageId,
      facebookNewLeadStageName: config.goHighLevelFacebookStageName,
      websiteQuoteLeadStageId: config.goHighLevelWebsiteStageId,
      websiteQuoteLeadStageName: config.goHighLevelWebsiteStageName
    };
  }

  async process(event: IntegrationEventRecord): Promise<GoHighLevelWebhookProcessingResult> {
    try {
      const parsed = parseGoHighLevelWebhook(event);
      if (!parsed.isRelevantEvent) {
        return { status: "ignored", action: "unsupported_event_type" };
      }

      if (!parsed.externalOpportunityId) {
        await this.store.createReconciliationIssue({
          issueType: "gohighlevel_webhook_missing_opportunity_id",
          summary: "GoHighLevel webhook did not include a stable opportunity ID",
          details: safeIssueDetails(parsed, event)
        });
        return {
          status: "processed",
          action: "created_reconciliation_issue",
          reconciliationIssue: "gohighlevel_webhook_missing_opportunity_id"
        };
      }

      const pipelineMatches = this.pipelineMatches(parsed);
      const sourceFromStage = pipelineMatches
        ? classifyStage(parsed.stageId, parsed.stageName, this.stageConfig)
        : undefined;
      const existing = await this.store.findOpportunity(parsed.externalOpportunityId);
      const originalSourceUpdate = await this.resolveOriginalSourceUpdate(
        existing,
        parsed,
        sourceFromStage,
        event
      );

      const statusDates = statusDatePatch(parsed.status, parsed.eventTimestamp);
      const contactId = parsed.externalContactId
        ? await this.store.upsertContactByExternalId(parsed.externalContactId, {
            provider: "gohighlevel",
            locationId: parsed.locationId,
            webhookEventId: event.id
          })
        : undefined;

      const stored = await this.store.upsertOpportunity({
        externalOpportunityId: parsed.externalOpportunityId,
        externalContactId: parsed.externalContactId,
        locationId: parsed.locationId,
        pipelineId: parsed.pipelineId,
        pipelineName: parsed.pipelineName ?? this.stageConfig.pipelineName ?? "unknown",
        stageId: parsed.stageId,
        stageName: parsed.stageName ?? "unknown",
        previousStageId: parsed.previousStageId,
        previousStageName: parsed.previousStageName,
        status: normalizeStatus(parsed.status),
        assignedTo: parsed.assignedTo,
        sourceRaw: parsed.sourceRaw,
        originalLeadSource: originalSourceUpdate.source,
        originalLeadDate: originalSourceUpdate.date,
        currentStageEnteredAt: shouldUpdateCurrentStage(existing, parsed)
          ? parsed.eventTimestamp
          : undefined,
        metadata: {
          provider: "gohighlevel",
          locationId: parsed.locationId,
          sourceRaw: parsed.sourceRaw,
          sourceNormalized: normalizeCustomerSource(parsed.sourceRaw),
          eventType: parsed.eventType,
          webhookEventId: event.id,
          webhookEvidence: parsed.isStageEvent
            ? "stage_event"
            : parsed.isStatusEvent
              ? "status_event"
              : "opportunity_event",
          originalLeadEvidence: originalSourceUpdate.source ? "webhook_stage_history" : undefined,
          outOfOrderEvent: existing?.currentStageEnteredAt
            ? new Date(parsed.eventTimestamp) < new Date(existing.currentStageEnteredAt)
            : false
        },
        ...statusDates
      });

      if (parsed.isStageEvent && parsed.pipelineId && parsed.stageId) {
        await this.store.insertStageHistory({
          externalOpportunityId: parsed.externalOpportunityId,
          contactId: contactId ?? stored.contactId,
          contactExternalId: parsed.externalContactId,
          pipelineId: parsed.pipelineId,
          pipelineName: parsed.pipelineName ?? this.stageConfig.pipelineName,
          stageId: parsed.stageId,
          stageName: parsed.stageName ?? "unknown",
          previousStageId: parsed.previousStageId,
          previousStageName: parsed.previousStageName,
          enteredAt: parsed.eventTimestamp,
          source: sourceFromStage ?? "unknown",
          sourceRaw: parsed.sourceRaw,
          externalEventId: event.externalEventId,
          eventFingerprint: event.eventFingerprint,
          metadata: safeIssueDetails(parsed, event)
        });
      }

      return {
        status: "processed",
        action: pipelineMatches ? "upserted_opportunity" : "stored_wrong_pipeline_without_classification",
        source: originalSourceUpdate.source
      };
    } catch (error) {
      const serialized = sanitizeForLogs(serializeError(error));
      logger.error(
        {
          provider: event.provider,
          eventId: event.id,
          eventType: event.eventType,
          error: serialized
        },
        "GoHighLevel webhook processing failed"
      );
      throw error;
    }
  }

  private pipelineMatches(parsed: ParsedGoHighLevelWebhook): boolean {
    if (!this.stageConfig.pipelineId) {
      return false;
    }
    return parsed.pipelineId === this.stageConfig.pipelineId;
  }

  private async resolveOriginalSourceUpdate(
    existing: ExistingOpportunityRecord | undefined,
    parsed: ParsedGoHighLevelWebhook,
    sourceFromStage: NormalizedCustomerSource | undefined,
    event: IntegrationEventRecord
  ): Promise<{ source?: NormalizedCustomerSource; date?: string }> {
    if (!sourceFromStage || !parsed.isStageEvent) {
      return {};
    }

    if (!existing || existing.originalLeadSource === "unknown") {
      return { source: sourceFromStage, date: parsed.eventTimestamp };
    }

    if (existing.originalLeadSource === sourceFromStage) {
      return {};
    }

    await this.store.createReconciliationIssue({
      issueType: "gohighlevel_original_source_conflict",
      summary: "GoHighLevel opportunity entered more than one configured original lead stage",
      details: {
        ...safeIssueDetails(parsed, event),
        existingOriginalSource: existing.originalLeadSource,
        attemptedOriginalSource: sourceFromStage
      }
    });

    return {};
  }
}

export function parseGoHighLevelWebhook(event: IntegrationEventRecord): ParsedGoHighLevelWebhook {
  const root = asRecord(event.payload) ?? {};
  const opportunity = asRecord(root.opportunity) ?? root;
  const contact = asRecord(root.contact) ?? {};
  const eventType = firstString([
    event.eventType,
    root.event_type,
    root.eventType,
    root.type,
    root.event,
    root.triggeringEvent
  ]) ?? "unknown";
  const eventKey = normalizeEventType(eventType);

  return {
    eventType,
    externalEventId: firstString([event.externalEventId, root.event_id, root.eventId, root.webhookId]),
    externalOpportunityId: firstString([
      opportunity.id,
      opportunity.opportunityId,
      root.opportunityId,
      root.opportunity_id
    ]),
    externalContactId: firstString([
      opportunity.contactId,
      opportunity.contact_id,
      root.contactId,
      root.contact_id,
      contact.id
    ]),
    locationId: firstString([opportunity.locationId, root.locationId, contact.locationId]),
    pipelineId: firstString([opportunity.pipelineId, opportunity.pipeline_id, root.pipelineId, root.pipeline_id]),
    pipelineName: firstString([opportunity.pipelineName, root.pipelineName]),
    stageId: firstString([
      opportunity.pipelineStageId,
      opportunity.pipeline_stage_id,
      opportunity.stageId,
      root.pipelineStageId,
      root.pipeline_stage_id,
      root.stageId
    ]),
    stageName: firstString([
      opportunity.pipelineStageName,
      opportunity.stageName,
      root.pipelineStageName,
      root.stageName
    ]),
    previousStageId: firstString([
      opportunity.previousPipelineStageId,
      opportunity.previousStageId,
      root.previousPipelineStageId,
      root.previousStageId
    ]),
    previousStageName: firstString([
      opportunity.previousPipelineStageName,
      opportunity.previousStageName,
      root.previousPipelineStageName,
      root.previousStageName
    ]),
    status: firstString([opportunity.status, root.status]),
    assignedTo: firstString([opportunity.assignedTo, root.assignedTo]),
    sourceRaw: firstString([opportunity.source, root.source]),
    eventTimestamp: normalizeTimestamp(firstString([
      root.eventTimestamp,
      root.timestamp,
      root.dateAdded,
      root.dateUpdated,
      root.createdAt,
      root.updatedAt,
      opportunity.lastStageChangeAt,
      opportunity.dateAdded,
      opportunity.dateUpdated,
      opportunity.createdAt,
      opportunity.updatedAt,
      event.receivedAt
    ])),
    isStageEvent: STAGE_EVENT_TYPES.has(eventKey),
    isStatusEvent: STATUS_EVENT_TYPES.has(eventKey),
    isOpportunityCreateEvent: OPPORTUNITY_CREATE_EVENT_TYPES.has(eventKey),
    isRelevantEvent:
      STAGE_EVENT_TYPES.has(eventKey) ||
      STATUS_EVENT_TYPES.has(eventKey) ||
      OPPORTUNITY_CREATE_EVENT_TYPES.has(eventKey),
    testRunId: firstString([root.testRunId, opportunity.testRunId])
  };
}

function shouldUpdateCurrentStage(
  existing: ExistingOpportunityRecord | undefined,
  parsed: ParsedGoHighLevelWebhook
): boolean {
  if (!parsed.stageId) {
    return false;
  }
  if (!existing?.currentStageEnteredAt) {
    return true;
  }
  return new Date(parsed.eventTimestamp) >= new Date(existing.currentStageEnteredAt);
}

function statusDatePatch(status: string | undefined, timestamp: string) {
  const normalized = normalizeStatus(status);
  return {
    wonAt: normalized === "won" ? timestamp : undefined,
    lostAt: normalized === "lost" ? timestamp : undefined,
    abandonedAt: normalized === "abandoned" ? timestamp : undefined
  };
}

function normalizeStatus(status: string | undefined): string | undefined {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (["open", "won", "lost", "abandoned"].includes(normalized)) {
    return normalized;
  }
  return normalized;
}

function safeIssueDetails(parsed: ParsedGoHighLevelWebhook, event: IntegrationEventRecord): Record<string, unknown> {
  return {
    provider: "gohighlevel",
    integrationEventId: event.id,
    eventType: parsed.eventType,
    externalEventId: event.externalEventId,
    externalOpportunityId: parsed.externalOpportunityId,
    externalContactId: parsed.externalContactId,
    locationId: parsed.locationId,
    pipelineId: parsed.pipelineId,
    stageId: parsed.stageId,
    previousStageId: parsed.previousStageId,
    status: parsed.status,
    eventTimestamp: parsed.eventTimestamp,
    testRunId: parsed.testRunId
  };
}

function normalizeEventType(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeTimestamp(value: string | undefined): string {
  const parsed = value ? new Date(value) : undefined;
  if (parsed && Number.isFinite(parsed.getTime())) {
    return parsed.toISOString();
  }
  return new Date().toISOString();
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
