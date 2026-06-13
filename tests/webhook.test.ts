import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
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
  googleAdsWebhookSecret: undefined
};

function createTestApp() {
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

  return {
    store,
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
}) {
  const chunks: Buffer[] = [];
  const requestBody = input.body === undefined ? [] : [Buffer.from(JSON.stringify(input.body))];
  const request = Readable.from(requestBody) as IncomingMessage;
  request.method = input.method;
  request.url = input.url;
  request.headers = { "content-type": "application/json" };

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
});
