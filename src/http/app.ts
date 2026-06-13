import { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config.ts";
import { logger, sanitizeForLogs, serializeError } from "../logger.ts";
import {
  createEventFingerprint,
  extractEventId,
  extractEventType
} from "../webhooks/fingerprint.ts";
import {
  NoopWebhookProcessor,
  scheduleWebhookProcessing,
} from "../webhooks/processor.ts";
import type { WebhookProcessor } from "../webhooks/processor.ts";
import type { WebhookEventStore } from "../webhooks/store.ts";

export type CreateAppOptions = {
  config: AppConfig;
  webhookStore: WebhookEventStore;
  webhookProcessor?: WebhookProcessor;
  startedAt?: Date;
};

export function createRequestHandler(options: CreateAppOptions) {
  const startedAt = options.startedAt ?? new Date();
  const processor = options.webhookProcessor ?? new NoopWebhookProcessor();

  return async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          status: "ok",
          service: "doo-doo-patrol-sweepandgo-integration",
          uptimeSeconds: Math.floor(process.uptime()),
          startedAt: startedAt.toISOString(),
          sweepandgoApiConfigured: Boolean(options.config.sweepgoApiToken),
          databaseConfigured: Boolean(options.config.databaseUrl)
        });
        return;
      }

      const webhookPrefix = "/webhooks/sweepandgo/";
      if (request.method === "POST" && url.pathname.startsWith(webhookPrefix)) {
        const secret = decodeURIComponent(url.pathname.slice(webhookPrefix.length));
        if (secret !== options.config.webhookPathSecret) {
          logger.warn({ path: url.pathname }, "Rejected Sweep&Go webhook with invalid path secret");
          sendJson(response, 404, { error: "not_found" });
          return;
        }

        const payload = await readJson(request);
        const eventType = extractEventType(payload);
        const sweepandgoEventId = extractEventId(payload);
        const eventFingerprint = createEventFingerprint(payload);

        const result = await options.webhookStore.createEvent({
          sweepandgoEventId,
          eventType,
          payload,
          eventFingerprint
        });

        sendJson(response, 200, {
          ok: true,
          duplicate: !result.inserted,
          eventId: result.event.id,
          status: result.inserted ? "received" : "duplicate"
        });

        if (!result.inserted) {
          logger.info(
            {
              webhookEventId: result.event.id,
              sweepandgoEventId,
              eventType,
              eventFingerprint
            },
            "Ignored duplicate Sweep&Go webhook"
          );
          return;
        }

        scheduleWebhookProcessing(options.webhookStore, processor, result.event);
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      const serialized = sanitizeForLogs(serializeError(error));
      logger.error({ error: serialized }, "Unhandled HTTP error");
      sendJson(response, 500, { error: "internal_server_error" });
    }
  };
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const maxBytes = 1024 * 1024;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error("Request body exceeded 1MB limit");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}
