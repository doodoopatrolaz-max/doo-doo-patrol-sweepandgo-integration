import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  normalizeDirectSignupForLeadContext,
  SweepAndGoDirectSignupForwarder
} from "../src/sweepandgo/directSignupForwarder.ts";

describe("Sweep&Go direct signup forwarder", () => {
  it("normalizes recurring Search Engine signups for Lead Context onboarding-complete", () => {
    const normalized = normalizeDirectSignupForLeadContext({
      type: "client:client_onboarding_recurring",
      data: {
        first_name: "Safe",
        email: "safe@example.invalid",
        cell_phone: "4805550100",
        clean_up_frequency: "Weekly",
        how_heard_about_us: "Search Engine"
      }
    });

    assert.equal(normalized.event_type, "client:client_onboarding_recurring");
    assert.equal(normalized.source, "sweepandgo_direct_signup");
    assert.equal(normalized.source_bucket, "website_paid");
    assert.equal(normalized.lead_source, "website");
    assert.equal(normalized.original_source, "website");
    assert.equal(normalized.source_detail, "direct_signup");
    assert.equal(normalized.data.dashboard_source_bucket, "website_paid");
  });

  it("normalizes one-time Social Media Facebook signups as Facebook", () => {
    const normalized = normalizeDirectSignupForLeadContext({
      event_type: "client:client_onboarding_onetime",
      data: {
        email: "safe@example.invalid",
        phone: "4805550101",
        clean_up_frequency: "One Time",
        how_heard_about_us: "Social Media",
        how_heard_about_us_details: "Facebook"
      }
    });

    assert.equal(normalized.event_type, "client:client_onboarding_onetime");
    assert.equal(normalized.source_bucket, "facebook");
    assert.equal(normalized.lead_source, "facebook");
  });

  it("forwards only direct signup events to the onboarding-complete route with optional secret", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
    const originalFetch = globalThis.fetch;
    mock.method(globalThis, "fetch", async (url: string, input: any) => {
      calls.push({
        url,
        headers: input.headers,
        body: JSON.parse(input.body)
      });
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true };
        }
      } as Response;
    });

    try {
      const forwarder = new SweepAndGoDirectSignupForwarder({
        leadcontextOnboardingCompleteUrl: "https://leadcontext.example.invalid/webhooks/sweepgo/onboarding-complete",
        leadcontextOnboardingCompleteSecret: "safe-secret"
      });

      await forwarder.process({
        id: "1",
        eventType: "client:client_onboarding_recurring",
        receivedAt: "2026-07-30T18:00:00.000Z",
        processingStatus: "received",
        eventFingerprint: "fp-1",
        payload: {
          type: "client:client_onboarding_recurring",
          data: {
            email: "safe@example.invalid",
            cell_phone: "4805550102",
            clean_up_frequency: "Weekly",
            how_heard_about_us: "Search Engine"
          }
        }
      });
      await forwarder.process({
        id: "2",
        eventType: "job:completed",
        receivedAt: "2026-07-30T18:00:00.000Z",
        processingStatus: "received",
        eventFingerprint: "fp-2",
        payload: { type: "job:completed" }
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://leadcontext.example.invalid/webhooks/sweepgo/onboarding-complete");
    assert.equal(calls[0].headers["x-sweepgo-webhook-secret"], "safe-secret");
    assert.equal(calls[0].headers["x-ddp-source-event-type"], "client:client_onboarding_recurring");
    assert.equal(calls[0].body.source_bucket, "website_paid");
    assert.equal(calls[0].body.data.lead_source, "website");
  });
});
