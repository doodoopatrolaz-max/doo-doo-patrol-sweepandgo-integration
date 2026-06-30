import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GoHighLevelClient } from "../src/gohighlevel/client.ts";
import { createEventFingerprint } from "../src/webhooks/fingerprint.ts";
import {
  buildOpportunityWebhookDeduplicationKey,
  classifyStage,
  mapGoHighLevelContact,
  mapGoHighLevelOpportunity,
  normalizeEmail,
  normalizePhone
} from "../src/gohighlevel/mapper.ts";
import { prepareOpportunityUpsert } from "../src/gohighlevel/store.ts";

const stageConfig = {
  locationId: "loc_SANITIZED",
  pipelineId: "pipe_SANITIZED",
  pipelineName: "Fresh Leads to Onboarding",
  facebookNewLeadStageId: "stage_FACEBOOK",
  facebookNewLeadStageName: "Facebook New Lead",
  websiteQuoteLeadStageId: "stage_WEBSITE",
  websiteQuoteLeadStageName: "Website Quote Lead"
};

const newLeadPipelineStageConfig = {
  locationId: "loc_SANITIZED",
  pipelineId: "pipe_NEW_LEAD_TO_ONBOARDING",
  pipelineName: "New Lead to Onboarding",
  facebookNewLeadStageId: "stage_NEW_FACEBOOK",
  facebookNewLeadStageName: "Facebook New Lead",
  websiteQuoteLeadStageId: "stage_NEW_WEBSITE",
  websiteQuoteLeadStageName: "Website Quote Lead"
};

describe("GoHighLevel lead classification", () => {
  it("classifies Facebook and website leads by exact stage IDs first", () => {
    assert.equal(classifyStage("stage_FACEBOOK", "Different label", stageConfig), "facebook");
    assert.equal(classifyStage("stage_WEBSITE", "Different label", stageConfig), "website");
  });

  it("falls back to exact configured stage names when IDs are not known yet", () => {
    assert.equal(classifyStage(undefined, "Facebook New Lead", stageConfig), "facebook");
    assert.equal(classifyStage(undefined, "Website Quote Lead", stageConfig), "website");
    assert.equal(classifyStage(undefined, "Website Follow Up", stageConfig), undefined);
  });

  it("classifies the new lead pipeline Facebook and Website stage IDs", () => {
    assert.equal(classifyStage("stage_NEW_FACEBOOK", "Different label", newLeadPipelineStageConfig), "facebook");
    assert.equal(classifyStage("stage_NEW_WEBSITE", "Different label", newLeadPipelineStageConfig), "website");
  });

  it("leaves unknown new-pipeline stages unclassified for review-safe handling", () => {
    assert.equal(classifyStage("stage_UNKNOWN", "Follow Up", newLeadPipelineStageConfig), undefined);
  });

  it("preserves original lead source and flags cross-source stage changes for review", () => {
    const mapped = mapGoHighLevelOpportunity({
      id: "opp_SANITIZED",
      contactId: "ct_SANITIZED",
      pipelineId: "pipe_SANITIZED",
      pipelineStageId: "stage_WEBSITE",
      source: "Facebook Lead Form",
      originalLeadSource: "facebook",
      dateAdded: "2026-01-01T00:00:00.000Z",
      status: "open"
    }, stageConfig);

    assert.equal(mapped.originalLeadSource, "facebook");
    assert.equal(mapped.reconciliationIssue, "opportunity_changed_between_primary_lead_sources");
  });

  it("does not treat current stage alone as confirmed historical stage history", () => {
    const mapped = mapGoHighLevelOpportunity({
      id: "opp_SANITIZED",
      pipelineStageId: "stage_FACEBOOK",
      dateAdded: "2026-01-01T00:00:00.000Z"
    }, stageConfig);

    assert.equal(mapped.originalLeadSource, "facebook");
    assert.equal(mapped.historicalStageSource, "current_stage_only");
    assert.equal(mapped.firstStageEnteredDate, undefined);
  });

  it("normalizes contact matching fields without using names as a merge key", () => {
    const mapped = mapGoHighLevelContact({
      id: "ct_SANITIZED",
      name: "Sanitized Name",
      email: " LEAD@EXAMPLE.INVALID ",
      phone: "+1 (602) 555-0100",
      tags: ["sanitized"],
      customFields: [{ id: "field_SANITIZED", value: "removed" }]
    });

    assert.equal(normalizeEmail(" LEAD@EXAMPLE.INVALID "), "lead@example.invalid");
    assert.equal(normalizePhone("+1 (602) 555-0100"), "6025550100");
    assert.equal(mapped.email, "lead@example.invalid");
    assert.equal(mapped.phone, "6025550100");
    assert.equal(mapped.name, "Sanitized Name");
    assert.equal(mapped.customFields[0].valueType, "string");
  });

  it("prepares opportunity upserts only when a stable opportunity ID exists", () => {
    const mapped = mapGoHighLevelOpportunity({
      id: "opp_SANITIZED",
      contactId: "ct_SANITIZED",
      pipelineId: "pipe_SANITIZED",
      pipelineStageId: "stage_FACEBOOK",
      dateAdded: "2026-01-01T00:00:00.000Z"
    }, stageConfig);

    const prepared = prepareOpportunityUpsert(mapped);
    assert(prepared);
    assert.equal(prepared.externalOpportunityId, "opp_SANITIZED");
    assert.equal(prepared.originalLeadSource, "facebook");

    assert.equal(prepareOpportunityUpsert({ ...mapped, externalOpportunityId: undefined }), undefined);
  });

  it("builds deterministic deduplication keys and provider fingerprints for GHL webhooks", () => {
    const payload = {
      type: "OpportunityStageUpdate",
      id: "opp_SANITIZED",
      pipelineStageId: "stage_FACEBOOK",
      status: "open",
      dateAdded: "2026-01-01T00:00:00.000Z"
    };

    assert.equal(
      buildOpportunityWebhookDeduplicationKey(payload),
      "OpportunityStageUpdate:opp_SANITIZED:stage_FACEBOOK:open:2026-01-01T00:00:00.000Z"
    );
    assert.equal(
      createEventFingerprint(payload, "gohighlevel"),
      createEventFingerprint({ ...payload }, "gohighlevel")
    );
  });
});

describe("GoHighLevel client", () => {
  it("sends the configured pipeline ID in read-only opportunity searches", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ opportunities: [] })
      } as Response;
    }) as typeof fetch;

    try {
      const client = new GoHighLevelClient({
        baseUrl: "https://services.example.invalid",
        apiVersion: "2021-07-28",
        privateIntegrationToken: "token_SANITIZED"
      });
      await client.searchOpportunities({
        locationId: "loc_SANITIZED",
        pipelineId: "pipe_NEW_LEAD_TO_ONBOARDING",
        limit: 2,
        page: 1
      });

      assert.equal(bodies.length, 1);
      assert.equal(bodies[0].locationId, "loc_SANITIZED");
      assert.equal(bodies[0].pipelineId, "pipe_NEW_LEAD_TO_ONBOARDING");
      assert.equal(bodies[0].limit, 2);
      assert.equal(bodies[0].page, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
