import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryOnboardingIntakeStore } from "../src/onboarding/inMemoryStore.ts";
import { OnboardingWebhookProcessor, PRIMARY_ONBOARDING_EVENT } from "../src/onboarding/intake.ts";
import type { SweepAndGoClient } from "../src/sweepandgo/client.ts";
import type { WebhookEvent } from "../src/webhooks/store.ts";

describe("Sweep&Go onboarding intake", () => {
  it("captures recurring onboarding webhooks and records verified and missing details", async () => {
    const store = new InMemoryOnboardingIntakeStore();
    const sweepandgoClient = {
      async getClientDetailsAndPayments(client: string) {
        assert.equal(client, "cus_123");
        return {
          client,
          customer_name: "Samantha White",
          email: "samantha@example.com",
          phone: "602-555-0100",
          service_address: "123 Anthem Way",
          status: "active",
          dog_count: 2,
          gate_notes: "Gate code is in customer notes",
          payment_status: "card on file",
          next_service_date: "2026-06-15",
          tags: ["$79mo", "$50initial", "1x weekly"]
        };
      },
      async searchClientByEmail() {
        throw new Error("search should not run when the webhook includes a client id");
      }
    } as unknown as SweepAndGoClient;

    const processor = new OnboardingWebhookProcessor(store, sweepandgoClient);
    const event: WebhookEvent = {
      id: "1",
      eventType: PRIMARY_ONBOARDING_EVENT,
      eventFingerprint: "client:client_onboarding_recurring:evt_1",
      sweepandgoEventId: "evt_1",
      receivedAt: "2026-06-12T12:00:00.000Z",
      processingStatus: "received",
      payload: {
        event_id: "evt_1",
        event_type: PRIMARY_ONBOARDING_EVENT,
        client: "cus_123"
      }
    };

    await processor.process(event);
    const intakes = await store.listIntakes(10, 0);

    assert.equal(intakes.length, 1);
    assert.equal(intakes[0].eventType, PRIMARY_ONBOARDING_EVENT);
    assert.equal(intakes[0].clientIdentifier, "cus_123");
    assert.equal(intakes[0].customerEmail, "samantha@example.com");
    assert.equal(intakes[0].customerName, "Samantha White");
    assert.equal(intakes[0].status, "captured");
    assert(intakes[0].sourcesChecked.includes("sweepandgo_client_details_and_payments"));
    assert.deepEqual(intakes[0].missingDetails, []);
    assert(intakes[0].calculationNotes.some((note) => note.includes("Estimated scooping per-visit amount")));
  });
});
