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

type WebhookProvider = "sweepandgo" | "gohighlevel" | "gmail" | "meta-ads" | "google-ads";

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
          databaseConfigured: Boolean(options.config.databaseUrl),
          dailyDashboardEnabled: options.config.dailyDashboardEnabled,
          dailyDashboardRecipient: options.config.dailyDashboardRecipient,
          dailyDashboardEmailConfigured: Boolean(options.config.smtpHost && options.config.dailyDashboardFrom),
          placeholderWebhooks: {
            goHighLevel: Boolean(options.config.goHighLevelWebhookSecret),
            gmail: Boolean(options.config.gmailWebhookSecret),
            metaAds: Boolean(options.config.metaAdsWebhookSecret),
            googleAds: Boolean(options.config.googleAdsWebhookSecret)
          }
        });
        return;
      }

      const webhookMatch = matchWebhookPath(url.pathname);
      if (request.method === "POST" && webhookMatch) {
        await receiveWebhook({
          provider: webhookMatch.provider,
          secret: webhookMatch.secret,
          request,
          response,
          options,
          processor
        });
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

function matchWebhookPath(pathname: string): { provider: WebhookProvider; secret: string } | undefined {
  const match = pathname.match(/^\/webhooks\/([^/]+)\/(.+)$/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  const provider = match[1] as WebhookProvider;
  if (!["sweepandgo", "gohighlevel", "gmail", "meta-ads", "google-ads"].includes(provider)) {
    return undefined;
  }

  return {
    provider,
    secret: decodeURIComponent(match[2])
  };
}

async function receiveWebhook(input: {
  provider: WebhookProvider;
  secret: string;
  request: IncomingMessage;
  response: ServerResponse;
  options: CreateAppOptions;
  processor: WebhookProcessor;
}) {
  const configuredSecret = webhookSecretForProvider(input.options.config, input.provider);
  if (!configuredSecret) {
    sendJson(input.response, 503, {
      error: "webhook_not_configured",
      provider: input.provider
    });
    return;
  }

  if (input.secret !== configuredSecret) {
    logger.warn({ path: input.request.url, provider: input.provider }, "Rejected webhook with invalid path secret");
    sendJson(input.response, 404, { error: "not_found" });
    return;
  }

  const payload = await readJson(input.request);
  const eventType = extractEventType(payload);
  const externalEventId = extractEventId(payload);
  const eventFingerprint = createEventFingerprint(payload, input.provider);

  const result = await input.options.webhookStore.createEvent({
    sweepandgoEventId: input.provider === "sweepandgo" ? externalEventId : undefined,
    eventType: input.provider === "sweepandgo" ? eventType : `${input.provider}:${eventType}`,
    payload: input.provider === "sweepandgo" ? payload : { provider: input.provider, raw: payload },
    eventFingerprint
  });

  sendJson(input.response, 200, {
    ok: true,
    provider: input.provider,
    duplicate: !result.inserted,
    eventId: result.event.id,
    status: result.inserted ? "received" : "duplicate"
  });

  if (!result.inserted) {
    logger.info(
      {
        webhookEventId: result.event.id,
        provider: input.provider,
        externalEventId,
        eventType,
        eventFingerprint
      },
      "Ignored duplicate webhook"
    );
    return;
  }

  scheduleWebhookProcessing(input.options.webhookStore, input.processor, result.event);
}

function webhookSecretForProvider(config: AppConfig, provider: WebhookProvider): string | undefined {
  if (provider === "sweepandgo") {
    return config.webhookPathSecret;
  }
  if (provider === "gohighlevel") {
    return config.goHighLevelWebhookSecret;
  }
  if (provider === "gmail") {
    return config.gmailWebhookSecret;
  }
  if (provider === "meta-ads") {
    return config.metaAdsWebhookSecret;
  }
  return config.googleAdsWebhookSecret;
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
