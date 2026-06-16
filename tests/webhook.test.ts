import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../src/config.ts";
import { createRequestHandler } from "../src/http/app.ts";
import { InMemoryIntegrationEventStore } from "../src/webhooks/integrationEventStore.ts";
import { InMemoryWebhookEventStore } from "../src/webhooks/inMemoryStore.ts";

const config: AppConfig = {
  nodeEnv: "test",
  port: 0,
  host: "127.0.0.1",
  webhookPathSecret: "test-secret",
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
  goHighLevelWebhookSecret: undefined,
  gmailWebhookSecret: undefined,
  metaAdsWebhookSecret: undefined,
  metaAccessToken: undefined,
  metaAdAccountId: undefined,
  metaApiVersion: "v23.0",
  metaApiBaseUrl: "https://graph.facebook.com",
  metaAppId: undefined,
  metaAppSecret: undefined,
  metaBusinessId: undefined,
  googleAdsWebhookSecret: undefined
};

function createTestApp() {
  const store = new InMemoryWebhookEventStore();
  const integrationEventStore = new InMemoryIntegrationEventStore();
  const handler = createRequestHandler({
    config,
    webhookStore: store,
    integrationEventStore,
    webhookProcessor: {
      async process() {
        return;
      }
    },
    startedAt: new Date("2026-06-12T12:00:00.000Z")
  });

  return {
    store,
    integrationEventStore,
    handler
  };
}

async function waitForProcessing() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function requestJson(input: {
  handler: ReturnType<typeof createRequestHandler>;
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const chunks: Buffer[] = [];
  const requestBody = input.body === undefined ? [] : [Buffer.from(JSON.stringify(input.body))];
  const request = Readable.from(requestBody) as IncomingMessage;
  request.method = input.method;
  request.url = input.url;
  request.headers = { "content-type": "application/json", ...input.headers };

  const response = {
    statusCode: 200,
    headers: {} as Record<string, string | number>,
    writeHead(statusCode: number, headers: Record<string, string | number>) {
      this.statusCode = statusCode;
      this.headers = headers;
      return this;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return this;
    }
  } as unknown as ServerResponse & {
    statusCode: number;
    headers: Record<string, string | number>;
  };

  await input.handler(request, response);
  const text = Buffer.concat(chunks).toString("utf8");
  return {
    status: response.statusCode,
    headers: response.headers,
    body: text ? JSON.parse(text) : undefined
  };
}

describe("Sweep&Go webhook receiver", () => {
  it("returns health status without exposing secrets", async () => {
    const { handler } = createTestApp();

    const response = await requestJson({ handler, method: "GET", url: "/health" });
    const body = response.body;

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.service, "doo-doo-patrol-sweepandgo-integration");
    assert.equal(body.sweepandgoApiConfigured, false);
    assert.equal(body.databaseConfigured, true);
    assert.equal(body.dailyDashboardEnabled, false);
    assert.equal(body.dailyDashboardEmailConfigured, false);
    assert(!JSON.stringify(body).includes("test-secret"));
  });

  it("rejects webhook requests that do not include the configured path secret", async () => {
    const { handler } = createTestApp();

    const response = await requestJson({
      handler,
      method: "POST",
      url: "/webhooks/sweepandgo/wrong-secret",
      body: { event_type: "client:changed_info" }
    });

    assert.equal(response.status, 404);
  });

  it("stores the original payload and marks the event processed asynchronously", async () => {
    const { handler, store } = createTestApp();
    const payload = {
      id: "evt_123",
      event_type: "client:changed_info",
      nested: {
        keep: "everything"
      }
    };

    const response = await requestJson({
      handler,
      method: "POST",
      url: "/webhooks/sweepandgo/test-secret",
      body: payload
    });
    const body = response.body;

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
    const { handler, store } = createTestApp();
    const payload = {
      event_id: "evt_duplicate",
      event_type: "job:completed",
      value: "same"
    };

    await requestJson({
      handler,
      method: "POST",
      url: "/webhooks/sweepandgo/test-secret",
      body: payload
    });
    const duplicateResponse = await requestJson({
      handler,
      method: "POST",
      url: "/webhooks/sweepandgo/test-secret",
      body: payload
    });
    const duplicateBody = duplicateResponse.body;

    await waitForProcessing();
    const events = await store.listEvents(10, 0);

    assert.equal(duplicateResponse.status, 200);
    assert.equal(duplicateBody.ok, true);
    assert.equal(duplicateBody.duplicate, true);
    assert.equal(duplicateBody.status, "duplicate");
    assert.equal(events.length, 1);
  });

  it("keeps future provider placeholders disabled until their secrets are configured", async () => {
    const { handler } = createTestApp();

    const response = await requestJson({
      handler,
      method: "POST",
      url: "/webhooks/gohighlevel/not-configured",
      body: { event_type: "placeholder" }
    });

    assert.equal(response.status, 503);
    assert.equal(response.body.error, "webhook_not_configured");
  });

  it("stores configured GoHighLevel webhooks in integration_events without touching Sweep&Go events", async () => {
    const store = new InMemoryWebhookEventStore();
    const integrationEventStore = new InMemoryIntegrationEventStore();
    const handler = createRequestHandler({
      config: {
        ...config,
        goHighLevelWebhookSecret: "ghl-secret"
      },
      webhookStore: store,
      integrationEventStore,
      webhookProcessor: {
        async process() {
          throw new Error("GoHighLevel placeholder webhooks should not use the Sweep&Go processor");
        }
      },
      startedAt: new Date("2026-06-12T12:00:00.000Z")
    });

    const payload = {
      event_type: "OpportunityCreate",
      id: "ghl-event-1",
      opportunityId: "redacted-opportunity-id"
    };

    const response = await requestJson({
      handler,
      method: "POST",
      url: "/webhooks/gohighlevel/ghl-secret",
      body: payload
    });
    const duplicateResponse = await requestJson({
      handler,
      method: "POST",
      url: "/webhooks/gohighlevel/ghl-secret",
      body: payload
    });

    const integrationEvents = await integrationEventStore.listEvents(10, 0);
    const sweepEvents = await store.listEvents(10, 0);

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.provider, "gohighlevel");
    assert.equal(response.body.duplicate, false);
    assert.equal(duplicateResponse.body.duplicate, true);
    assert.equal(integrationEvents.length, 1);
    assert.equal(integrationEvents[0].provider, "gohighlevel");
    assert.equal(integrationEvents[0].eventType, "OpportunityCreate");
    assert.equal(integrationEvents[0].externalEventId, "ghl-event-1");
    assert.deepEqual(integrationEvents[0].payload, payload);
    assert.equal(sweepEvents.length, 0);
  });

  it("rejects GoHighLevel requests when the optional source header is wrong", async () => {
    const integrationEventStore = new InMemoryIntegrationEventStore();
    const handler = createRequestHandler({
      config: {
        ...config,
        goHighLevelWebhookSecret: "ghl-secret"
      },
      webhookStore: new InMemoryWebhookEventStore(),
      integrationEventStore,
      startedAt: new Date("2026-06-12T12:00:00.000Z")
    });

    const response = await requestJson({
      handler,
      method: "POST",
      url: "/webhooks/gohighlevel/ghl-secret",
      headers: {
        "x-ddp-webhook-source": "wrong-source"
      },
      body: {
        event_type: "opportunity_created",
        opportunityId: "redacted-opportunity-id"
      }
    });

    const integrationEvents = await integrationEventStore.listEvents(10, 0);

    assert.equal(response.status, 404);
    assert.equal(integrationEvents.length, 0);
  });
});
