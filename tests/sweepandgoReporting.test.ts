import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeExplicitCustomerSource } from "../src/reporting/sourceNormalization.ts";
import {
  calculateMonthlyRecurringRevenue,
  extractSweepAndGoRows,
  mapSweepAndGoCustomer,
  mapSweepAndGoLead
} from "../src/sweepandgo/reportingMapper.ts";

describe("Sweep&Go reporting mapper", () => {
  it("maps active customers with subscriptions as recurring customers", () => {
    const mapped = mapSweepAndGoCustomer({
      client: "rcl_SANITIZED",
      status: "active",
      subscription_names: "2d1W",
      one_time_client: false,
      cleanup_frequency: "once_a_week",
      tracking_field: "utm_campaign=sanitized&utm_medium=social&utm_source=facebook",
      service_days: "Monday"
    });

    assert(mapped);
    assert.equal(mapped.externalCustomerId, "rcl_SANITIZED");
    assert.equal(mapped.status, "active");
    assert.equal(mapped.hasActiveSubscription, true);
    assert.equal(mapped.serviceCadence, "recurring");
    assert.equal(mapped.source, "facebook");
    assert.equal(mapped.sourceEvidenceField, "tracking_field");
  });

  it("maps direct website signup source markers from Sweep&Go customer rows", () => {
    const mapped = mapSweepAndGoCustomer({
      client: "rcl_SANITIZED_DIRECT",
      status: "active",
      subscription_names: "Weekly",
      cleanup_frequency: "weekly",
      lead_source: "website",
      original_source: "website",
      source_detail: "direct_signup"
    });

    assert(mapped);
    assert.equal(mapped.source, "website");
    assert.equal(mapped.sourceRaw, "website");
    assert.equal(mapped.sourceEvidenceField, "lead_source");
  });

  it("does not count active clients without subscriptions as recurring customers", () => {
    const mapped = mapSweepAndGoCustomer({
      client: "rcl_SANITIZED",
      status: "active",
      subscription_names: null,
      one_time_client: false,
      cleanup_frequency: "once_a_week"
    }, "active_no_subscription");

    assert(mapped);
    assert.equal(mapped.hasActiveSubscription, false);
    assert.equal(mapped.serviceCadence, "unknown");
  });

  it("maps one time clients without pretending they are standalone cleanup revenue", () => {
    const mapped = mapSweepAndGoCustomer({
      client: "rcl_SANITIZED",
      status: "active",
      one_time_client: true,
      cleanup_frequency: "one_time"
    });

    assert(mapped);
    assert.equal(mapped.isOneTimeClient, true);
    assert.equal(mapped.serviceCadence, "one_time");
  });

  it("normalizes only explicit source fields", () => {
    assert.deepEqual(normalizeExplicitCustomerSource({
      email: "facebook-person@example.com",
      first_name: "Facebook"
    }), { normalizedSource: "unknown" });

    assert.deepEqual(normalizeExplicitCustomerSource({
      lead_source: "website",
      original_source: "website",
      source_detail: "direct_signup"
    }), {
      normalizedSource: "website",
      rawSource: "website",
      evidenceField: "lead_source"
    });

    assert.deepEqual(normalizeExplicitCustomerSource({
      original_source: "website",
      source_detail: "direct_signup"
    }), {
      normalizedSource: "website",
      rawSource: "website",
      evidenceField: "original_source"
    });

    assert.deepEqual(normalizeExplicitCustomerSource({
      source_detail: "direct_signup"
    }), { normalizedSource: "unknown" });

    assert.equal(normalizeExplicitCustomerSource({
      how_heard_answer: "Facebook"
    }).normalizedSource, "facebook");

    assert.equal(normalizeExplicitCustomerSource({
      how_heard_about_us: "referred_by_family_or_friend"
    }).normalizedSource, "other");
  });

  it("maps Sweep&Go leads and extracts paginated rows", () => {
    const rows = extractSweepAndGoRows({
      data: [
        {
          lead: "rld_SANITIZED",
          status: "lead",
          type: "out_of_area",
          tracking_field: "utm_source=website"
        }
      ]
    });
    const mapped = mapSweepAndGoLead(rows[0]);

    assert.equal(rows.length, 1);
    assert(mapped);
    assert.equal(mapped.externalLeadId, "rld_SANITIZED");
    assert.equal(mapped.source, "website");
  });

  it("supports documented recurring revenue formulas only when amount and frequency are known", () => {
    assert.equal(calculateMonthlyRecurringRevenue({ amount: 25, frequency: "once_a_week" }), 108.25);
    assert.equal(calculateMonthlyRecurringRevenue({ amount: 50, frequency: "twice_per_month" }), 100);
    assert.equal(calculateMonthlyRecurringRevenue({ amount: undefined, frequency: "once_a_week" }), undefined);
    assert.equal(calculateMonthlyRecurringRevenue({ amount: 25, frequency: "custom" }), undefined);
  });
});
