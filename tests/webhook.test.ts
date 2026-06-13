import http from "node:http";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { AppConfig } from "../src/config.ts";
import { createRequestHandler } from "../src/http/app.ts";
import { InMemoryWebhookEventStore } from "../src/webhooks/inMemoryStore.ts";

const config: AppConfig = {
  nodeEnv: "test",
  port: 0,
  host: "127.0.0.1",
  webhookPathSecret: "test-secret",
  databaseUrl: "postgres://example",
  sweepgoApiToken: undefined,
  sweepgoBaseUrl: "https://openapi.sweepandgo.com"
};

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        })
    )
  );
});

async function createTestServer() {
  const store = new InMemoryWebhookEventStore();
  const handler = createRequestHandler({
    config,
    webhookStore: store,
    webhookProcessor: {
      async process() {
        return;
      }
    },
    startedAt: new Date("2026-06-12T12:00:00.000Z")
  });

  const server = http.createServer(handler);
  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");

  return {
    store,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function waitForProcessing() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("Sweep&Go webhook receiver", () => {
  it("returns health status without exposing secrets", async () => {
    const { baseUrl } = await createTestServer();

    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.service, "doo-doo-patrol-sweepandgo-integration");
    assert.equal(body.sweepandgoApiConfigured, false);
    assert.equal(body.databaseConfigured, true);
    assert(!JSON.stringify(body).includes("test-secret"));
  });

  it("rejects webhook requests that do not include the configured path secret", async () => {
    const { baseUrl } = await createTestServer();

    const response = await postJson(`${baseUrl}/webhooks/sweepandgo/wrong-secret`, {
      event_type: "client:changed_info"
    });

    assert.equal(response.status, 404);
  });

  it("stores the original payload and marks the event processed asynchronously", async () => {
    const { baseUrl, store } = await createTestServer();
    const payload = {
      id: "evt_123",
      event_type: "client:changed_info",
      nested: {
        keep: "everything"
      }
    };

    const response = await postJson(`${baseUrl}/webhooks/sweepandgo/test-secret`, payload);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.duplicate, false);
    assert.equal(body.status, "received");

    await waitForProcessing();
    const events = await store.listEvents(10, 0);

    assert.equal(events.length, 1);
    assert.equal(events[0].sweepandgoEventId, "evt_123");
    assert.equal(events[0].eventType, "client:changed_info");
    assert.equal(events[0].processingStatus, "processed");
    assert.deepEqual(events[0].payload, payload);
  });

  it("prevents duplicate processing for the same Sweep&Go event", async () => {
    const { baseUrl, store } = await createTestServer();
    const payload = {
      event_id: "evt_duplicate",
      event_type: "job:completed",
      value: "same"
    };

    await postJson(`${baseUrl}/webhooks/sweepandgo/test-secret`, payload);
    const duplicateResponse = await postJson(`${baseUrl}/webhooks/sweepandgo/test-secret`, payload);
    const duplicateBody = await duplicateResponse.json();

    await waitForProcessing();
    const events = await store.listEvents(10, 0);

    assert.equal(duplicateResponse.status, 200);
    assert.equal(duplicateBody.ok, true);
    assert.equal(duplicateBody.duplicate, true);
    assert.equal(duplicateBody.status, "duplicate");
    assert.equal(events.length, 1);
  });
});
