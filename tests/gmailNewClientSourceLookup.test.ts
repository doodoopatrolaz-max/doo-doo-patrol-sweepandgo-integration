import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSweepAndGoNewClientEmailQuery,
  SweepAndGoNewClientSourceLookupProcessor,
  type NewClientSourceLookupAttemptInput
} from "../src/gmail/newClientSourceLookup.ts";
import type { NewClientSourceApplyResult } from "../src/gmail/newClientSourceStore.ts";
import type { ParsedSweepAndGoNewClientEmail } from "../src/gmail/newClientSourceEmail.ts";
import type { WebhookEvent } from "../src/webhooks/store.ts";

const emailBody = [
  "A new client has just created an account",
  "",
  "Clean Up Frequency",
  "",
  "One Time",
  "",
  "First Name",
  "",
  "Test",
  "",
  "Last Name",
  "",
  "Customer",
  "",
  "Email Address",
  "",
  "lookup@example.invalid",
  "",
  "Cell Phone Number",
  "",
  "5550100",
  "",
  "Home Address",
  "",
  "123 Test St",
  "",
  "How you heard about us",
  "",
  "Vehicle Signage"
].join("\n");

class FakeReader {
  readonly queries: Array<{ query: string; maxResults: number }> = [];
  messages = [
    {
      messageId: "gmail-msg-1",
      subject: "Client with name \"Test Customer\" created new account",
      from: "SweepAndGo noreply@sweepandgo.com",
      receivedAt: "2026-07-26T15:00:00.000Z",
      body: emailBody
    }
  ];

  async searchNewClientEmails(input: { query: string; maxResults: number }) {
    this.queries.push(input);
    return this.messages;
  }
}

class FailingReader {
  async searchNewClientEmails() {
    throw new Error("Gmail read-only request failed with HTTP 503");
  }
}

class FakeEvidenceStore {
  readonly applied: ParsedSweepAndGoNewClientEmail[] = [];
  readonly attempts: NewClientSourceLookupAttemptInput[] = [];
  nextResult: NewClientSourceApplyResult = {
    status: "matched",
    entityType: "one_time_cleanup_intake",
    matchMethod: "email_date",
    sourceBucket: "truck_wrap"
  };

  async apply(parsed: ParsedSweepAndGoNewClientEmail) {
    this.applied.push(parsed);
    return this.nextResult;
  }

  async recordLookupAttempt(input: NewClientSourceLookupAttemptInput) {
    this.attempts.push(input);
  }
}

function webhook(input: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: input.id ?? "00000000-0000-0000-0000-000000000001",
    sweepandgoEventId: "event-1",
    eventType: input.eventType ?? "client:client_onboarding_onetime",
    receivedAt: "2026-07-26T15:00:00.000Z",
    processingStatus: "received",
    payload: input.payload ?? {
      type: "client:client_onboarding_onetime",
      created: "2026-07-26T15:00:00.000Z",
      data: {
        customer_email: "lookup@example.invalid"
      }
    },
    eventFingerprint: input.eventFingerprint ?? "lookup-fingerprint-1"
  };
}

describe("Sweep&Go webhook-triggered Gmail source lookup", () => {
  it("looks up and applies source evidence for a new-client onboarding webhook", async () => {
    const reader = new FakeReader();
    const store = new FakeEvidenceStore();
    const result = await new SweepAndGoNewClientSourceLookupProcessor({ reader, store }).lookupForWebhook(webhook());

    assert.equal(result.status, "matched");
    assert.equal(result.matched, 1);
    assert.equal(store.applied.length, 1);
    assert.equal(store.applied[0].sourceBucket, "truck_wrap");
    assert.equal(store.attempts[0].status, "matched");
    assert(reader.queries[0].query.includes("from:noreply@sweepandgo.com"));
    assert(reader.queries[0].query.includes('subject:"created new account"'));
  });

  it("does not fail webhook processing when Gmail lookup fails", async () => {
    const store = new FakeEvidenceStore();
    const result = await new SweepAndGoNewClientSourceLookupProcessor({
      reader: new FailingReader(),
      store
    }).lookupForWebhook(webhook());

    assert.equal(result.status, "error");
    assert.equal(store.applied.length, 0);
    assert.equal(store.attempts[0].status, "error");
    assert(!JSON.stringify(store.attempts).includes("lookup@example.invalid"));
  });

  it("records a pending not-found lookup for fallback sync", async () => {
    const reader = new FakeReader();
    reader.messages = [];
    const store = new FakeEvidenceStore();
    const result = await new SweepAndGoNewClientSourceLookupProcessor({ reader, store }).lookupForWebhook(webhook());

    assert.equal(result.status, "not_found");
    assert.equal(store.attempts[0].status, "not_found");
    assert.equal(store.attempts[0].reason, "no_matching_new_client_email_found");
  });

  it("safely disables lookup when Gmail reader is not configured", async () => {
    const store = new FakeEvidenceStore();
    const result = await new SweepAndGoNewClientSourceLookupProcessor({ store }).lookupForWebhook(webhook());

    assert.equal(result.status, "disabled");
    assert.equal(store.applied.length, 0);
    assert.equal(store.attempts[0].status, "disabled");
    assert.equal(store.attempts[0].reason, "gmail_readonly_not_configured");
  });

  it("ignores non-new-client webhook events", async () => {
    const store = new FakeEvidenceStore();
    const result = await new SweepAndGoNewClientSourceLookupProcessor({
      reader: new FakeReader(),
      store
    }).lookupForWebhook(webhook({ eventType: "job:completed" }));

    assert.equal(result.status, "ignored");
    assert.equal(store.applied.length, 0);
    assert.equal(store.attempts.length, 0);
  });

  it("builds a narrow search query with a date buffer", () => {
    const query = buildSweepAndGoNewClientEmailQuery("2026-07-26");

    assert(query.includes("after:2026/07/25"));
    assert(query.includes("before:2026/07/28"));
    assert(query.includes("-in:trash"));
  });
});
