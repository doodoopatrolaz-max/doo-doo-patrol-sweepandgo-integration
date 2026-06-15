import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppConfig } from "../src/config.ts";
import { GoHighLevelWebhookProcessor, parseGoHighLevelWebhook } from "../src/gohighlevel/webhookProcessor.ts";
import type {
  ExistingOpportunityRecord,
  GoHighLevelStageHistoryInput,
  GoHighLevelWebhookOpportunityInput,
  GoHighLevelWebhookStore,
  ReconciliationIssueInput
} from "../src/gohighlevel/store.ts";
import type { NormalizedCustomerSource } from "../src/reporting/sourceNormalization.ts";
import type { IntegrationEventRecord } from "../src/webhooks/integrationEventStore.ts";

const config: AppConfig = {
  nodeEnv: "test",
  port: 0,
  host: "127.0.0.1",
  webhookPathSecret: "sweep-secret",
  databaseUrl: "postgres://example",
  sweepgoApiToken: undefined,
  sweepgoBaseUrl: "https://openapi.sweepandgo.com",
  dailyDashboardEnabled: false,
  dailyDashboardRecipient: "bryan@doodoopatrol.com",
  dailyDashboardFrom: undefined,
  dailyDashboardTimeZone: "America/Phoenix",
  smtpHost: undefined,
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: undefined,
  smtpPassword: undefined,
  goHighLevelWebhookSecret: "ghl-secret",
  goHighLevelPrivateIntegrationToken: undefined,
  goHighLevelApiBaseUrl: "https://services.leadconnectorhq.com",
  goHighLevelApiVersion: "2021-07-28",
  goHighLevelLocationId: "loc_SANITIZED",
  goHighLevelPipelineId: "pipe_TARGET",
  goHighLevelPipelineName: "Fresh Leads to Onboarding",
  goHighLevelFacebookStageId: "stage_FACEBOOK",
  goHighLevelFacebookStageName: "Facebook New Lead",
  goHighLevelWebsiteStageId: "stage_WEBSITE",
  goHighLevelWebsiteStageName: "Website Quote Lead",
  gmailWebhookSecret: undefined,
  metaAdsWebhookSecret: undefined,
  googleAdsWebhookSecret: undefined
};

function integrationEvent(
  payload: Record<string, unknown>,
  id = "evt_test"
): IntegrationEventRecord {
  return {
    id,
    provider: "gohighlevel",
    eventType: String(payload.event_type ?? payload.type ?? "unknown"),
    externalEventId: String(payload.eventId ?? id),
    eventFingerprint: `fingerprint_${id}`,
    receivedAt: "2026-06-13T12:00:00.000Z",
    processingStatus: "received",
    payload
  };
}

class FakeGoHighLevelWebhookStore implements GoHighLevelWebhookStore {
  readonly contacts = new Map<string, string>();
  readonly opportunities = new Map<string, ExistingOpportunityRecord>();
  readonly stageHistory: GoHighLevelStageHistoryInput[] = [];
  readonly issues: ReconciliationIssueInput[] = [];

  async upsertContactByExternalId(externalContactId: string): Promise<string> {
    const existing = this.contacts.get(externalContactId);
    if (existing) {
      return existing;
    }

    const id = `contact_${this.contacts.size + 1}`;
    this.contacts.set(externalContactId, id);
    return id;
  }

  async findOpportunity(externalOpportunityId: string): Promise<ExistingOpportunityRecord | undefined> {
    return this.opportunities.get(externalOpportunityId);
  }

  async upsertOpportunity(input: GoHighLevelWebhookOpportunityInput): Promise<ExistingOpportunityRecord> {
    const existing = this.opportunities.get(input.externalOpportunityId);
    const contactId = input.externalContactId
      ? await this.upsertContactByExternalId(input.externalContactId)
      : existing?.contactId;
    const originalLeadSource = resolveOriginalSource(existing?.originalLeadSource, input.originalLeadSource);
    const currentStageEnteredAt = resolveCurrentStageEnteredAt(
      existing?.currentStageEnteredAt,
      input.currentStageEnteredAt
    );
    const updateCurrentStage = !existing?.currentStageEnteredAt ||
      (input.currentStageEnteredAt
        ? new Date(input.currentStageEnteredAt) >= new Date(existing.currentStageEnteredAt)
        : false);
    const record: ExistingOpportunityRecord = {
      id: existing?.id ?? `opportunity_${this.opportunities.size + 1}`,
      contactId,
      externalOpportunityId: input.externalOpportunityId,
      pipelineId: input.pipelineId ?? existing?.pipelineId,
      stageId: updateCurrentStage ? input.stageId ?? existing?.stageId : existing?.stageId,
      stageName: updateCurrentStage ? input.stageName : existing?.stageName ?? input.stageName,
      status: input.status ?? existing?.status,
      originalLeadSource,
      originalLeadDate: existing?.originalLeadDate ?? input.originalLeadDate,
      currentStageEnteredAt,
      metadata: { ...existing?.metadata, ...input.metadata }
    };

    this.opportunities.set(input.externalOpportunityId, record);
    return record;
  }

  async insertStageHistory(input: GoHighLevelStageHistoryInput): Promise<boolean> {
    const duplicate = this.stageHistory.some((history) => {
      if (history.eventFingerprint && input.eventFingerprint) {
        return history.eventFingerprint === input.eventFingerprint ||
          history.externalOpportunityId === input.externalOpportunityId &&
          history.stageId === input.stageId &&
          history.enteredAt === input.enteredAt;
      }
      return history.externalOpportunityId === input.externalOpportunityId &&
        history.stageId === input.stageId &&
        history.enteredAt === input.enteredAt;
    });

    if (duplicate) {
      return false;
    }

    this.stageHistory.push(input);
    return true;
  }

  async createReconciliationIssue(input: ReconciliationIssueInput): Promise<void> {
    this.issues.push(input);
  }
}

describe("GoHighLevel webhook processor", () => {
  it("classifies a configured Facebook stage event once and records stage history", async () => {
    const store = new FakeGoHighLevelWebhookStore();
    const processor = new GoHighLevelWebhookProcessor(store, config);
    const payload = {
      event_type: "pipeline_stage_updated",
      eventId: "ghl_event_1",
      opportunityId: "opp_SANITIZED_FACEBOOK",
      contactId: "ct_SANITIZED_FACEBOOK",
      locationId: "loc_SANITIZED",
      pipelineId: "pipe_TARGET",
      pipelineStageId: "stage_FACEBOOK",
      timestamp: "2026-06-13T08:00:00.000Z"
    };

    await processor.process(integrationEvent(payload, "evt_1"));
    await processor.process(integrationEvent(payload, "evt_1_duplicate"));

    const opportunity = store.opportunities.get("opp_SANITIZED_FACEBOOK");
    assert.equal(opportunity?.originalLeadSource, "facebook");
    assert.equal(opportunity?.originalLeadDate, "2026-06-13T08:00:00.000Z");
    assert.equal(store.contacts.size, 1);
    assert.equal(store.opportunities.size, 1);
    assert.equal(store.stageHistory.length, 1);
  });

  it("classifies website lead stages without treating follow-up stages as new leads", async () => {
    const store = new FakeGoHighLevelWebhookStore();
    const processor = new GoHighLevelWebhookProcessor(store, config);

    await processor.process(integrationEvent({
      event_type: "pipeline_stage_updated",
      eventId: "ghl_event_2",
      opportunityId: "opp_SANITIZED_WEBSITE",
      contactId: "ct_SANITIZED_WEBSITE",
      pipelineId: "pipe_TARGET",
      pipelineStageId: "stage_WEBSITE",
      timestamp: "2026-06-13T09:00:00.000Z"
    }, "evt_2"));
    await processor.process(integrationEvent({
      event_type: "pipeline_stage_updated",
      eventId: "ghl_event_3",
      opportunityId: "opp_SANITIZED_WEBSITE",
      contactId: "ct_SANITIZED_WEBSITE",
      pipelineId: "pipe_TARGET",
      pipelineStageId: "stage_FOLLOW_UP",
      timestamp: "2026-06-13T10:00:00.000Z"
    }, "evt_3"));

    const opportunity = store.opportunities.get("opp_SANITIZED_WEBSITE");
    assert.equal(opportunity?.originalLeadSource, "website");
    assert.equal(opportunity?.originalLeadDate, "2026-06-13T09:00:00.000Z");
    assert.equal(opportunity?.stageId, "stage_FOLLOW_UP");
    assert.equal(store.stageHistory.length, 2);
  });

  it("stores wrong-pipeline events without classifying original lead source", async () => {
    const store = new FakeGoHighLevelWebhookStore();
    const processor = new GoHighLevelWebhookProcessor(store, config);

    await processor.process(integrationEvent({
      event_type: "pipeline_stage_updated",
      opportunityId: "opp_SANITIZED_WRONG_PIPELINE",
      contactId: "ct_SANITIZED_WRONG_PIPELINE",
      pipelineId: "pipe_OTHER",
      pipelineStageId: "stage_FACEBOOK",
      timestamp: "2026-06-13T11:00:00.000Z"
    }, "evt_4"));

    assert.equal(store.opportunities.get("opp_SANITIZED_WRONG_PIPELINE")?.originalLeadSource, "unknown");
    assert.equal(store.stageHistory[0].source, "unknown");
  });

  it("status updates preserve status without creating a new original lead", async () => {
    const store = new FakeGoHighLevelWebhookStore();
    const processor = new GoHighLevelWebhookProcessor(store, config);

    await processor.process(integrationEvent({
      event_type: "opportunity_status_changed",
      opportunityId: "opp_SANITIZED_STATUS",
      contactId: "ct_SANITIZED_STATUS",
      pipelineId: "pipe_TARGET",
      pipelineStageId: "stage_FACEBOOK",
      status: "won",
      timestamp: "2026-06-13T12:00:00.000Z"
    }, "evt_5"));

    const opportunity = store.opportunities.get("opp_SANITIZED_STATUS");
    assert.equal(opportunity?.status, "won");
    assert.equal(opportunity?.originalLeadSource, "unknown");
    assert.equal(store.stageHistory.length, 0);
  });

  it("creates reconciliation issues for missing opportunity IDs and cross-source stage changes", async () => {
    const store = new FakeGoHighLevelWebhookStore();
    const processor = new GoHighLevelWebhookProcessor(store, config);

    await processor.process(integrationEvent({
      event_type: "pipeline_stage_updated",
      pipelineId: "pipe_TARGET",
      pipelineStageId: "stage_FACEBOOK"
    }, "evt_missing"));

    await processor.process(integrationEvent({
      event_type: "pipeline_stage_updated",
      opportunityId: "opp_SANITIZED_CONFLICT",
      pipelineId: "pipe_TARGET",
      pipelineStageId: "stage_FACEBOOK",
      timestamp: "2026-06-13T13:00:00.000Z"
    }, "evt_6"));
    await processor.process(integrationEvent({
      event_type: "pipeline_stage_updated",
      opportunityId: "opp_SANITIZED_CONFLICT",
      pipelineId: "pipe_TARGET",
      pipelineStageId: "stage_WEBSITE",
      timestamp: "2026-06-13T13:05:00.000Z"
    }, "evt_7"));

    assert.equal(store.issues.length, 2);
    assert.equal(store.issues[0].issueType, "gohighlevel_webhook_missing_opportunity_id");
    assert.equal(store.issues[1].issueType, "gohighlevel_original_source_conflict");
    assert.equal(store.opportunities.get("opp_SANITIZED_CONFLICT")?.originalLeadSource, "facebook");
  });

  it("does not roll current stage backward when an out-of-order event arrives", async () => {
    const store = new FakeGoHighLevelWebhookStore();
    const processor = new GoHighLevelWebhookProcessor(store, config);

    await processor.process(integrationEvent({
      event_type: "pipeline_stage_updated",
      opportunityId: "opp_SANITIZED_ORDER",
      pipelineId: "pipe_TARGET",
      pipelineStageId: "stage_FOLLOW_UP",
      timestamp: "2026-06-13T15:00:00.000Z"
    }, "evt_8"));
    await processor.process(integrationEvent({
      event_type: "pipeline_stage_updated",
      opportunityId: "opp_SANITIZED_ORDER",
      pipelineId: "pipe_TARGET",
      pipelineStageId: "stage_FACEBOOK",
      timestamp: "2026-06-13T14:00:00.000Z"
    }, "evt_9"));

    const opportunity = store.opportunities.get("opp_SANITIZED_ORDER");
    assert.equal(opportunity?.currentStageEnteredAt, "2026-06-13T15:00:00.000Z");
    assert.equal(opportunity?.stageId, "stage_FOLLOW_UP");
    assert.equal(opportunity?.originalLeadSource, "facebook");
  });

  it("parses official workflow-style event names and sanitized nested opportunity payloads", () => {
    const parsed = parseGoHighLevelWebhook(integrationEvent({
      event_type: "Pipeline Stage Changed",
      opportunity: {
        id: "opp_SANITIZED_NESTED",
        contactId: "ct_SANITIZED_NESTED",
        pipelineId: "pipe_TARGET",
        pipelineStageId: "stage_FACEBOOK",
        lastStageChangeAt: "2026-06-13T16:00:00.000Z"
      }
    }, "evt_10"));

    assert.equal(parsed.isStageEvent, true);
    assert.equal(parsed.externalOpportunityId, "opp_SANITIZED_NESTED");
    assert.equal(parsed.eventTimestamp, "2026-06-13T16:00:00.000Z");
  });

  it("parses HighLevel workflow customData fields and falls back to received timestamp", () => {
    const parsed = parseGoHighLevelWebhook(integrationEvent({
      contact_id: "ct_SANITIZED_TOP_LEVEL",
      pipeline_id: "pipe_TOP_LEVEL",
      customData: {
        event_type: "opportunity_created",
        opportunity_id: "opp_SANITIZED_CUSTOM",
        contact_id: "ct_SANITIZED_CUSTOM",
        pipeline_id: "pipe_TARGET",
        pipeline_stage_id: "stage_FACEBOOK"
      }
    }, "evt_11"));

    assert.equal(parsed.eventType, "opportunity_created");
    assert.equal(parsed.isOpportunityCreateEvent, true);
    assert.equal(parsed.externalOpportunityId, "opp_SANITIZED_CUSTOM");
    assert.equal(parsed.externalContactId, "ct_SANITIZED_TOP_LEVEL");
    assert.equal(parsed.pipelineId, "pipe_TOP_LEVEL");
    assert.equal(parsed.stageId, "stage_FACEBOOK");
    assert.equal(parsed.eventTimestamp, "2026-06-13T12:00:00.000Z");
  });

  it("parses customData camelCase fields when snake_case is not provided", () => {
    const parsed = parseGoHighLevelWebhook(integrationEvent({
      customData: {
        eventType: "opportunity_created",
        opportunityId: "opp_SANITIZED_CAMEL",
        contactId: "ct_SANITIZED_CAMEL",
        pipelineId: "pipe_TARGET",
        pipelineStageId: "stage_WEBSITE",
        createdAt: "2026-06-13T18:00:00.000Z"
      }
    }, "evt_12"));

    assert.equal(parsed.eventType, "opportunity_created");
    assert.equal(parsed.externalOpportunityId, "opp_SANITIZED_CAMEL");
    assert.equal(parsed.externalContactId, "ct_SANITIZED_CAMEL");
    assert.equal(parsed.pipelineId, "pipe_TARGET");
    assert.equal(parsed.stageId, "stage_WEBSITE");
    assert.equal(parsed.eventTimestamp, "2026-06-13T18:00:00.000Z");
  });

  it("classifies opportunity_created events already in Facebook and website lead stages", async () => {
    const store = new FakeGoHighLevelWebhookStore();
    const processor = new GoHighLevelWebhookProcessor(store, config);

    await processor.process(integrationEvent({
      customData: {
        event_type: "opportunity_created",
        opportunity_id: "opp_SANITIZED_CREATED_FACEBOOK",
        contact_id: "ct_SANITIZED_CREATED_FACEBOOK",
        pipeline_id: "pipe_TARGET",
        pipeline_stage_id: "stage_FACEBOOK",
        created_at: "2026-06-13T19:00:00.000Z"
      }
    }, "evt_13"));
    await processor.process(integrationEvent({
      customData: {
        event_type: "opportunity_created",
        opportunity_id: "opp_SANITIZED_CREATED_WEBSITE",
        contact_id: "ct_SANITIZED_CREATED_WEBSITE",
        pipeline_id: "pipe_TARGET",
        pipeline_stage_id: "stage_WEBSITE",
        created_at: "2026-06-13T19:05:00.000Z"
      }
    }, "evt_14"));

    assert.equal(store.opportunities.get("opp_SANITIZED_CREATED_FACEBOOK")?.originalLeadSource, "facebook");
    assert.equal(store.opportunities.get("opp_SANITIZED_CREATED_FACEBOOK")?.originalLeadDate, "2026-06-13T19:00:00.000Z");
    assert.equal(store.opportunities.get("opp_SANITIZED_CREATED_WEBSITE")?.originalLeadSource, "website");
    assert.equal(store.opportunities.get("opp_SANITIZED_CREATED_WEBSITE")?.originalLeadDate, "2026-06-13T19:05:00.000Z");
    assert.equal(store.stageHistory.length, 2);
    assert.equal(store.stageHistory[0].source, "facebook");
    assert.equal(store.stageHistory[1].source, "website");
  });

  it("does not double count duplicate opportunity_created events or later follow-up stages", async () => {
    const store = new FakeGoHighLevelWebhookStore();
    const processor = new GoHighLevelWebhookProcessor(store, config);
    const createdPayload = {
      customData: {
        event_type: "opportunity_created",
        opportunity_id: "opp_SANITIZED_CREATED_DUPLICATE",
        contact_id: "ct_SANITIZED_CREATED_DUPLICATE",
        pipeline_id: "pipe_TARGET",
        pipeline_stage_id: "stage_FACEBOOK",
        timestamp: "2026-06-13T20:00:00.000Z"
      }
    };

    await processor.process(integrationEvent(createdPayload, "evt_15"));
    await processor.process(integrationEvent(createdPayload, "evt_15_duplicate"));
    await processor.process(integrationEvent({
      event_type: "pipeline_stage_updated",
      opportunityId: "opp_SANITIZED_CREATED_DUPLICATE",
      contactId: "ct_SANITIZED_CREATED_DUPLICATE",
      pipelineId: "pipe_TARGET",
      pipelineStageId: "stage_FOLLOW_UP",
      timestamp: "2026-06-13T21:00:00.000Z"
    }, "evt_16"));

    const opportunity = store.opportunities.get("opp_SANITIZED_CREATED_DUPLICATE");
    assert.equal(store.opportunities.size, 1);
    assert.equal(store.contacts.size, 1);
    assert.equal(opportunity?.originalLeadSource, "facebook");
    assert.equal(opportunity?.originalLeadDate, "2026-06-13T20:00:00.000Z");
    assert.equal(opportunity?.stageId, "stage_FOLLOW_UP");
    assert.equal(store.stageHistory.length, 2);
  });
});

function resolveOriginalSource(
  existing: NormalizedCustomerSource | undefined,
  next: NormalizedCustomerSource | undefined
): NormalizedCustomerSource {
  if (!existing || existing === "unknown") {
    return next ?? "unknown";
  }
  return existing;
}

function resolveCurrentStageEnteredAt(existing: string | undefined, next: string | undefined): string | undefined {
  if (!existing) {
    return next;
  }
  if (!next) {
    return existing;
  }
  return new Date(next) >= new Date(existing) ? next : existing;
}
