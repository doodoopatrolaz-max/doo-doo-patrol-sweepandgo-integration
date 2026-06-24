import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createConversionMatchDryRun,
  type ActiveClientOpportunityCandidate,
  type LeadCandidate
} from "../src/gohighlevel/conversionMatcher.ts";

const range = {
  rangeStart: "2026-06-01",
  rangeEnd: "2026-06-30"
};

describe("GoHighLevel conversion matcher", () => {
  it("matches recurring conversions by GHL contact ID first", () => {
    const result = run({
      leads: [lead({ contactExternalId: "contact_1", originalLeadSource: "facebook" })],
      activeOpportunities: [active({ contactExternalId: "contact_1" })]
    });

    assert.equal(result.matchCounts.byContactId, 1);
    assert.equal(result.matchCounts.facebookConversions, 1);
    assert.equal(result.closeRates.facebookCloseRatePercent, 100);
  });

  it("matches by same opportunity ID when contact ID does not match", () => {
    const result = run({
      leads: [lead({ externalOpportunityId: "opp_same", originalLeadSource: "website" })],
      activeOpportunities: [active({ externalOpportunityId: "opp_same" })]
    });

    assert.equal(result.matchCounts.bySameOpportunityId, 1);
    assert.equal(result.matchCounts.websiteConversions, 1);
  });

  it("matches by unique normalized email", () => {
    const result = run({
      leads: [lead({ email: " Lead@Example.Invalid " })],
      activeOpportunities: [active({ email: "lead@example.invalid" })]
    });

    assert.equal(result.matchCounts.byEmail, 1);
  });

  it("matches by unique normalized phone", () => {
    const result = run({
      leads: [lead({ phone: "+1 (602) 555-0100" })],
      activeOpportunities: [active({ phone: "6025550100" })]
    });

    assert.equal(result.matchCounts.byPhone, 1);
  });

  it("rejects name-only matching by leaving records unmatched", () => {
    const result = run({
      leads: [lead({})],
      activeOpportunities: [active({})]
    });

    assert.equal(result.matches.length, 0);
    assert.equal(result.matchCounts.unmatchedRecurringEligible, 1);
  });

  it("excludes one-time, paused, and cancelation stages from recurring conversions", () => {
    const result = run({
      leads: [
        lead({ contactExternalId: "contact_1" }),
        lead({ contactExternalId: "contact_2" }),
        lead({ contactExternalId: "contact_3" })
      ],
      activeOpportunities: [
        active({ contactExternalId: "contact_1", stageName: "One Time Clean Up" }),
        active({ contactExternalId: "contact_2", stageName: "Paused Service" }),
        active({ contactExternalId: "contact_3", stageName: "Cancelation" })
      ]
    });

    assert.equal(result.activeOpportunityCounts.oneTimePausedCanceledExcluded, 3);
    assert.equal(result.activeOpportunityCounts.recurringEligible, 0);
    assert.equal(result.matches.length, 0);
  });

  it("routes ambiguous matches to review", () => {
    const result = run({
      leads: [
        lead({ biOpportunityId: "bi_1", contactExternalId: "contact_duplicate" }),
        lead({ biOpportunityId: "bi_2", contactExternalId: "contact_duplicate" })
      ],
      activeOpportunities: [active({ contactExternalId: "contact_duplicate" })]
    });

    assert.equal(result.matchCounts.manualReviewCount, 1);
    assert.equal(result.matchCounts.duplicateOrAmbiguousCount, 1);
    assert.equal(result.matches.length, 0);
  });

  it("enforces the conversion date rule", () => {
    const result = run({
      leads: [lead({ contactExternalId: "contact_1", originalLeadDate: "2026-06-10T00:00:00.000Z" })],
      activeOpportunities: [active({ contactExternalId: "contact_1", updatedAt: "2026-06-09T00:00:00.000Z" })]
    });

    assert.equal(result.matchCounts.dateRuleRejected, 1);
    assert.equal(result.matchCounts.manualReviewCount, 1);
    assert.equal(result.matches.length, 0);
  });

  it("prevents duplicate conversion counting for the same lead", () => {
    const result = run({
      leads: [lead({ contactExternalId: "contact_1" })],
      activeOpportunities: [
        active({ externalOpportunityId: "active_1", contactExternalId: "contact_1" }),
        active({ externalOpportunityId: "active_2", contactExternalId: "contact_1" })
      ]
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matchCounts.manualReviewCount, 1);
    assert.equal(result.matchCounts.duplicateOrAmbiguousCount, 1);
  });

  it("calculates source-specific close rates", () => {
    const result = run({
      leads: [
        lead({ biOpportunityId: "bi_1", contactExternalId: "contact_1", originalLeadSource: "facebook" }),
        lead({ biOpportunityId: "bi_2", contactExternalId: "contact_2", originalLeadSource: "facebook" }),
        lead({ biOpportunityId: "bi_3", contactExternalId: "contact_3", originalLeadSource: "website" })
      ],
      activeOpportunities: [
        active({ externalOpportunityId: "active_1", contactExternalId: "contact_1" }),
        active({ externalOpportunityId: "active_3", contactExternalId: "contact_3" })
      ]
    });

    assert.equal(result.closeRates.facebookCloseRatePercent, 50);
    assert.equal(result.closeRates.websiteCloseRatePercent, 100);
    assert.equal(result.closeRates.totalCloseRatePercent, 66.67);
  });

  it("warns when ad spend coverage is partial", () => {
    const result = run({
      leads: [lead({ contactExternalId: "contact_1" })],
      activeOpportunities: [active({ contactExternalId: "contact_1" })],
      spendRows: [{ platform: "meta", days: 1, spend: 49.24 }]
    });

    assert.equal(result.spendCoverage.costPerNewCustomerStatus, "unavailable_incomplete_spend_coverage");
    assert(result.dataWarnings.some((warning) => warning.includes("Meta spend coverage is incomplete")));
  });
});

function run(input: {
  leads: LeadCandidate[];
  activeOpportunities: ActiveClientOpportunityCandidate[];
  spendRows?: Array<{ platform: string; days: number; spend: number }>;
}) {
  return createConversionMatchDryRun({
    ...range,
    leads: input.leads,
    activeOpportunities: input.activeOpportunities,
    spendRows: input.spendRows ?? []
  });
}

function lead(overrides: Partial<LeadCandidate>): LeadCandidate {
  return {
    biOpportunityId: overrides.biOpportunityId ?? "bi_lead",
    externalOpportunityId: overrides.externalOpportunityId ?? "lead_opp",
    contactExternalId: overrides.contactExternalId,
    originalLeadSource: overrides.originalLeadSource ?? "facebook",
    originalLeadDate: overrides.originalLeadDate ?? "2026-06-10T00:00:00.000Z",
    email: overrides.email,
    phone: overrides.phone
  };
}

function active(overrides: Partial<ActiveClientOpportunityCandidate>): ActiveClientOpportunityCandidate {
  return {
    externalOpportunityId: overrides.externalOpportunityId ?? "active_opp",
    contactExternalId: overrides.contactExternalId,
    stageName: overrides.stageName ?? "Weekly Reoccurring Customers",
    createdAt: overrides.createdAt ?? "2026-06-11T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-12T00:00:00.000Z",
    email: overrides.email,
    phone: overrides.phone
  };
}
