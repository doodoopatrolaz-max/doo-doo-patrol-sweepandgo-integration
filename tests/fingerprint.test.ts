import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEventFingerprint,
  extractEventId,
  extractEventType
} from "../src/webhooks/fingerprint.ts";

describe("webhook fingerprinting", () => {
  it("uses event type and event ID when available", () => {
    const first = createEventFingerprint({
      event_id: "evt_1",
      event_type: "client:changed_info",
      value: "first delivery"
    });
    const second = createEventFingerprint({
      event_id: "evt_1",
      event_type: "client:changed_info",
      value: "redelivery"
    });

    assert.equal(first, second);
  });

  it("uses canonical JSON when Sweep&Go does not provide an event ID", () => {
    const first = createEventFingerprint({ b: 2, a: 1 });
    const second = createEventFingerprint({ a: 1, b: 2 });

    assert.equal(first, second);
  });

  it("extracts common event metadata fields", () => {
    assert.equal(extractEventId({ webhookId: 123 }), "123");
    assert.equal(extractEventType({ webhook_type: "job:completed" }), "job:completed");
  });
});
