import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SweepAndGoWebhookBiProcessor } from "../src/sweepandgo/webhookBiProcessor.ts";
import type {
  ExistingSweepAndGoCustomer,
  SweepAndGoCancellationInput,
  SweepAndGoCustomerUpsertInput,
  SweepAndGoReconciliationIssueInput,
  SweepAndGoServiceUpsertInput,
  SweepAndGoWebhookBiStore
} from "../src/sweepandgo/webhookBiStore.ts";
import type { WebhookEvent } from "../src/webhooks/store.ts";

class InMemoryBiStore implements SweepAndGoWebhookBiStore {
  customers = new Map<string, ExistingSweepAndGoCustomer & { metadata: Record<string, unknown> }>();
  services = new Map<string, SweepAndGoServiceUpsertInput>();
  cancellations = new Map<string, SweepAndGoCancellationInput>();
  issues = new Map<string, SweepAndGoReconciliationIssueInput>();

  async findCustomer(externalCustomerId: string) {
    return this.customers.get(externalCustomerId);
  }

  async upsertCustomer(input: SweepAndGoCustomerUpsertInput) {
    const existing = this.customers.get(input.externalCustomerId);
    const status = input.statusUpdateMode === "overwrite" || !existing || existing.status === "unknown"
      ? input.status ?? existing?.status ?? "unknown"
      : existing.status;
    const customer = {
      id: existing?.id ?? `customer-${this.customers.size + 1}`,
      externalSweepGoId: input.externalCustomerId,
      status,
      source: existing?.source === "unknown" ? input.source : existing?.source ?? input.source,
      firstRecurringDate: existing?.firstRecurringDate ?? input.firstRecurringDate,
      metadata: { ...(existing?.metadata ?? {}), ...input.metadata }
    } satisfies ExistingSweepAndGoCustomer & { metadata: Record<string, unknown> };
    this.customers.set(input.externalCustomerId, customer);
    return customer;
  }

  async upsertService(input: SweepAndGoServiceUpsertInput) {
    this.services.set(`${input.customerId}:${input.externalServiceId}`, input);
  }

  async upsertCancellation(input: SweepAndGoCancellationInput) {
    this.cancellations.set(input.externalSweepGoId, input);
  }

  async createReconciliationIssue(input: SweepAndGoReconciliationIssueInput) {
    const fingerprint = String(input.details.eventFingerprint ?? "");
    this.issues.set(`${input.issueType}:${fingerprint}`, input);
  }
}

function webhook(input: {
  eventType: string;
  payload: Record<string, unknown>;
  id?: string;
  fingerprint?: string;
  receivedAt?: string;
}): WebhookEvent {
  return {
    id: input.id ?? "webhook-1",
    sweepandgoEventId: input.id ?? "event-1",
    eventType: input.eventType,
    receivedAt: input.receivedAt ?? "2026-06-22T18:00:00.000Z",
    processingStatus: "received",
    payload: { type: input.eventType, created: "2026-06-22T18:00:00.000Z", ...input.payload },
    eventFingerprint: input.fingerprint ?? `fingerprint-${input.eventType}`
  };
}

describe("Sweep&Go webhook BI processor", () => {
  it("creates or updates a customer for recurring onboarding", async () => {
    const store = new InMemoryBiStore();
    const processor = new SweepAndGoWebhookBiProcessor(store);

    await processor.process(webhook({
      eventType: "client:client_onboarding_recurring",
      payload: { data: { client: "client-1", status: "active", tracking_field: "facebook lead" } }
    }));

    const customer = store.customers.get("client-1");
    assert.equal(customer?.status, "active");
    assert.equal(customer?.source, "facebook");
    assert.equal(customer?.firstRecurringDate, "2026-06-22");
    assert.equal(store.services.size, 1);
  });

  it("uses explicit direct website signup source markers from recurring onboarding", async () => {
    const store = new InMemoryBiStore();
    const processor = new SweepAndGoWebhookBiProcessor(store);

    await processor.process(webhook({
      eventType: "client:client_onboarding_recurring",
      payload: {
        data: {
          client: "client-direct-website",
          status: "active",
          lead_source: "website",
          original_source: "website",
          source_detail: "direct_signup"
        }
      }
    }));

    const customer = store.customers.get("client-direct-website");
    assert.equal(customer?.status, "active");
    assert.equal(customer?.source, "website");
    assert.equal(customer?.firstRecurringDate, "2026-06-22");
    assert.equal(customer?.metadata.sourceDetail, "direct_signup");
  });

  it("sets first_recurring_date once", async () => {
    const store = new InMemoryBiStore();
    const processor = new SweepAndGoWebhookBiProcessor(store);

    await processor.process(webhook({
      eventType: "client:client_onboarding_recurring",
      payload: { created: "2026-06-22T18:00:00.000Z", data: { client: "client-1" } },
      fingerprint: "first"
    }));
    await processor.process(webhook({
      eventType: "client:client_onboarding_recurring",
      payload: { created: "2026-06-23T18:00:00.000Z", data: { client: "client-1" } },
      fingerprint: "second"
    }));

    assert.equal(store.customers.get("client-1")?.firstRecurringDate, "2026-06-22");
  });

  it("does not duplicate a customer for duplicate onboarding events", async () => {
    const store = new InMemoryBiStore();
    const processor = new SweepAndGoWebhookBiProcessor(store);
    const event = webhook({
      eventType: "client:client_onboarding_recurring",
      payload: { data: { client: "client-1" } }
    });

    await processor.process(event);
    await processor.process(event);

    assert.equal(store.customers.size, 1);
    assert.equal(store.services.size, 1);
  });

  it("updates service safely for subscription_created", async () => {
    const store = new InMemoryBiStore();
    const processor = new SweepAndGoWebhookBiProcessor(store);

    await processor.process(webhook({
      eventType: "client:subscription_created",
      payload: { data: { client: "client-1", subscription_id: "sub-1", subscription_name: "Weekly cleanup" } }
    }));

    assert.equal(store.customers.size, 1);
    assert.equal([...store.services.values()][0]?.externalServiceId, "client-1:sub-1");
    assert.equal([...store.services.values()][0]?.cadence, "recurring");
  });

  it("creates a reconciliation issue for uncertain subscription_created new-customer counting", async () => {
    const store = new InMemoryBiStore();
    const processor = new SweepAndGoWebhookBiProcessor(store);

    await processor.process(webhook({
      eventType: "client:subscription_created",
      payload: { data: { client: "client-1", subscription_id: "sub-1" } }
    }));

    assert.equal(store.issues.size, 1);
    assert.equal([...store.issues.values()][0]?.issueType, "sweepandgo_subscription_created_new_customer_uncertain");
  });

  it("creates cancellation only when subscription identity is reliable", async () => {
    const store = new InMemoryBiStore();
    const processor = new SweepAndGoWebhookBiProcessor(store);

    await processor.process(webhook({
      eventType: "client:subscription_canceled",
      payload: { data: { client: "client-1", subscription_id: "sub-1", termination_reason: "No longer needs service" } }
    }));

    assert.equal(store.cancellations.size, 1);
    assert.equal([...store.cancellations.values()][0]?.externalSweepGoId, "client-1:sub-1");
  });

  it("updates changed_status without creating a new recurring customer count", async () => {
    const store = new InMemoryBiStore();
    const processor = new SweepAndGoWebhookBiProcessor(store);

    await processor.process(webhook({
      eventType: "client:changed_status",
      payload: { data: { client: "client-1", status: "inactive" } }
    }));

    const customer = store.customers.get("client-1");
    assert.equal(customer?.status, "inactive");
    assert.equal(customer?.firstRecurringDate, undefined);
    assert.equal(store.cancellations.size, 0);
  });

  it("does not let onboarding overwrite a later explicit inactive status", async () => {
    const store = new InMemoryBiStore();
    const processor = new SweepAndGoWebhookBiProcessor(store);

    await processor.process(webhook({
      eventType: "client:changed_status",
      payload: { data: { client: "client-1", status: "inactive" } },
      fingerprint: "status"
    }));
    await processor.process(webhook({
      eventType: "client:client_onboarding_recurring",
      payload: { data: { client: "client-1", status: "active" } },
      fingerprint: "onboarding"
    }));

    assert.equal(store.customers.get("client-1")?.status, "inactive");
    assert.equal(store.customers.get("client-1")?.firstRecurringDate, "2026-06-22");
  });

  it("acknowledges client_assigned without affecting customer KPIs", async () => {
    const store = new InMemoryBiStore();
    const processor = new SweepAndGoWebhookBiProcessor(store);

    await processor.process(webhook({
      eventType: "client:client_assigned",
      payload: { data: { client: "client-1", service_days: [{ service_type: "cleanup" }] } }
    }));

    assert.equal(store.customers.size, 0);
    assert.equal(store.services.size, 0);
    assert.equal(store.cancellations.size, 0);
  });

  it("creates a reconciliation issue when client ID is missing", async () => {
    const store = new InMemoryBiStore();
    const processor = new SweepAndGoWebhookBiProcessor(store);

    await processor.process(webhook({
      eventType: "client:client_onboarding_recurring",
      payload: { data: { status: "active" } }
    }));

    assert.equal(store.issues.size, 1);
    assert.equal([...store.issues.values()][0]?.issueType, "sweepandgo_webhook_missing_client_id");
  });

  it("does not put private payload data in reconciliation details", async () => {
    const store = new InMemoryBiStore();
    const processor = new SweepAndGoWebhookBiProcessor(store);

    await processor.process(webhook({
      eventType: "client:client_onboarding_recurring",
      payload: {
        data: {
          email: "private@example.com",
          cell_phone: "602-555-0101",
          address: "Private Address"
        }
      }
    }));

    const issueJson = JSON.stringify([...store.issues.values()][0]);
    assert(!issueJson.includes("private@example.com"));
    assert(!issueJson.includes("602-555-0101"));
    assert(!issueJson.includes("Private Address"));
  });
});
