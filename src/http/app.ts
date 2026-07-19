import { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppConfig } from "../config.ts";
import { parseDashboardDateRange } from "../dashboard/dateRange.ts";
import { renderDashboard, renderDashboardLogin } from "../dashboard/render.ts";
import type { DashboardDataSource } from "../dashboard/types.ts";
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
import {
  InMemoryIntegrationEventStore,
  type IntegrationEventStore
} from "../webhooks/integrationEventStore.ts";
import type { WebhookProcessor } from "../webhooks/processor.ts";
import type { WebhookEventStore } from "../webhooks/store.ts";

type WebhookProvider = "sweepandgo" | "gohighlevel" | "gmail" | "meta-ads" | "google-ads";

export type CreateAppOptions = {
  config: AppConfig;
  webhookStore: WebhookEventStore;
  integrationEventStore?: IntegrationEventStore;
  integrationEventProcessor?: IntegrationEventProcessor;
  dashboardDataSource?: DashboardDataSource;
  webhookProcessor?: WebhookProcessor;
  startedAt?: Date;
};

export type IntegrationEventProcessor = {
  process(event: import("../webhooks/integrationEventStore.ts").IntegrationEventRecord): Promise<unknown>;
};

export function createRequestHandler(options: CreateAppOptions) {
  const startedAt = options.startedAt ?? new Date();
  const processor = options.webhookProcessor ?? new NoopWebhookProcessor();
  const integrationEventStore = options.integrationEventStore ?? new InMemoryIntegrationEventStore();

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
          dailyDashboardRecipientConfigured: Boolean(options.config.dailyDashboardRecipient),
          dailyDashboardEmailConfigured: Boolean(options.config.smtpHost && options.config.dailyDashboardFrom),
          kpiDashboardConfigured: Boolean(options.config.dashboardPassword),
          placeholderWebhooks: {
            goHighLevel: Boolean(options.config.goHighLevelWebhookSecret),
            gmail: Boolean(options.config.gmailWebhookSecret),
            metaAds: Boolean(options.config.metaAdsWebhookSecret),
            googleAds: Boolean(options.config.googleAdsWebhookSecret)
          }
        });
        return;
      }

      if (url.pathname === "/dashboard" && request.method === "GET") {
        await handleDashboardPage({ request, response, url, options });
        return;
      }

      if (url.pathname === "/dashboard/login" && request.method === "POST") {
        await handleDashboardLogin({ request, response, options });
        return;
      }

      if (url.pathname === "/dashboard/logout" && request.method === "GET") {
        clearDashboardCookie(response);
        response.writeHead(303, { location: "/dashboard" });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/dashboard/")) {
        await handleDashboardApi({ request, response, url, options });
        return;
      }

      if (request.method === "GET" && url.pathname === "/assets/doo-doo-patrol-logo.png") {
        await sendPngAsset(response, "public/assets/doo-doo-patrol-logo.png");
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
          processor,
          integrationEventStore
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

async function sendPngAsset(response: ServerResponse, relativePath: string) {
  try {
    const bytes = await readFile(resolve(process.cwd(), relativePath));
    response.writeHead(200, {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400"
    });
    response.end(bytes);
  } catch {
    sendJson(response, 404, { error: "asset_not_found" });
  }
}

async function handleDashboardPage(input: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  options: CreateAppOptions;
}) {
  if (!input.options.config.dashboardPassword) {
    sendHtml(input.response, 503, renderDashboardLogin({ disabled: true }));
    return;
  }

  if (!isDashboardAuthorized(input.request, input.options.config)) {
    sendHtml(input.response, 401, renderDashboardLogin({ disabled: false }));
    return;
  }

  const dataSource = input.options.dashboardDataSource;
  if (!dataSource) {
    sendJson(input.response, 503, { error: "dashboard_database_not_configured" });
    return;
  }

  const range = parseDashboardDateRange(input.url.searchParams);
  const [summary, trends, sources, syncHealth] = await Promise.all([
    dataSource.getSummary(range),
    dataSource.getTrends(range),
    dataSource.getSources(range),
    dataSource.getSyncHealth(range)
  ]);

  sendHtml(input.response, 200, renderDashboard({ summary, trends, sources, syncHealth }));
}

async function handleDashboardLogin(input: {
  request: IncomingMessage;
  response: ServerResponse;
  options: CreateAppOptions;
}) {
  if (!input.options.config.dashboardPassword) {
    sendHtml(input.response, 503, renderDashboardLogin({ disabled: true }));
    return;
  }

  const form = await readForm(input.request);
  if (!constantTimeEquals(form.password ?? "", input.options.config.dashboardPassword)) {
    sendHtml(input.response, 401, renderDashboardLogin({ disabled: false, failed: true }));
    return;
  }

  setDashboardCookie(input.response, input.options.config);
  input.response.writeHead(303, { location: "/dashboard" });
  input.response.end();
}

async function handleDashboardApi(input: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  options: CreateAppOptions;
}) {
  if (!input.options.config.dashboardPassword) {
    sendJson(input.response, 503, { error: "dashboard_not_configured" });
    return;
  }

  if (!isDashboardAuthorized(input.request, input.options.config)) {
    sendJson(input.response, 401, { error: "dashboard_auth_required" });
    return;
  }

  const dataSource = input.options.dashboardDataSource;
  if (!dataSource) {
    sendJson(input.response, 503, { error: "dashboard_database_not_configured" });
    return;
  }

  const range = parseDashboardDateRange(input.url.searchParams);
  if (input.url.pathname === "/api/dashboard/summary") {
    sendJson(input.response, 200, await dataSource.getSummary(range));
    return;
  }
  if (input.url.pathname === "/api/dashboard/trends") {
    sendJson(input.response, 200, await dataSource.getTrends(range));
    return;
  }
  if (input.url.pathname === "/api/dashboard/sources") {
    sendJson(input.response, 200, await dataSource.getSources(range));
    return;
  }
  if (input.url.pathname === "/api/dashboard/sync-health") {
    sendJson(input.response, 200, await dataSource.getSyncHealth(range));
    return;
  }

  sendJson(input.response, 404, { error: "not_found" });
}

function isDashboardAuthorized(request: IncomingMessage, config: AppConfig): boolean {
  if (!config.dashboardPassword) {
    return false;
  }

  const headerPassword = headerValue(request.headers["x-dashboard-password"]);
  if (headerPassword && constantTimeEquals(headerPassword, config.dashboardPassword)) {
    return true;
  }

  const cookieValue = parseCookies(request.headers.cookie).ddp_dashboard_auth;
  return Boolean(cookieValue && constantTimeEquals(cookieValue, dashboardAuthToken(config)));
}

function dashboardAuthToken(config: AppConfig): string {
  return crypto
    .createHash("sha256")
    .update(`ddp-dashboard:${config.dashboardPassword ?? ""}`)
    .digest("hex");
}

function setDashboardCookie(response: ServerResponse, config: AppConfig) {
  response.setHeader("set-cookie", [
    `ddp_dashboard_auth=${dashboardAuthToken(config)}; HttpOnly; SameSite=Lax; Path=/dashboard; Max-Age=43200`,
    `ddp_dashboard_auth=${dashboardAuthToken(config)}; HttpOnly; SameSite=Lax; Path=/api/dashboard; Max-Age=43200`
  ]);
}

function clearDashboardCookie(response: ServerResponse) {
  response.setHeader("set-cookie", [
    "ddp_dashboard_auth=; HttpOnly; SameSite=Lax; Path=/dashboard; Max-Age=0",
    "ddp_dashboard_auth=; HttpOnly; SameSite=Lax; Path=/api/dashboard; Max-Age=0"
  ]);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  if (!header) {
    return output;
  }
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) {
      output[key] = decodeURIComponent(rest.join("="));
    }
  }
  return output;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
  integrationEventStore: IntegrationEventStore;
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
    logger.warn({ provider: input.provider }, "Rejected webhook with invalid path secret");
    sendJson(input.response, 404, { error: "not_found" });
    return;
  }

  if (input.provider === "gohighlevel" && !hasValidOptionalGoHighLevelSourceHeader(input.request)) {
    logger.warn({ provider: input.provider }, "Rejected webhook with invalid source header");
    sendJson(input.response, 404, { error: "not_found" });
    return;
  }

  const payload = await readJson(input.request);
  const eventType = extractEventType(payload);
  const externalEventId = extractEventId(payload);
  const eventFingerprint = createEventFingerprint(payload, input.provider);

  const result =
    input.provider === "sweepandgo"
      ? await input.options.webhookStore.createEvent({
          sweepandgoEventId: externalEventId,
          eventType,
          payload,
          eventFingerprint
        })
      : await input.integrationEventStore.createEvent({
          provider: input.provider,
          eventType,
          externalEventId,
          eventFingerprint,
          payload
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
        eventId: result.event.id,
        provider: input.provider,
        externalEventId,
        eventType,
        eventFingerprint
      },
      "Ignored duplicate webhook"
    );
    return;
  }

  if (input.provider === "sweepandgo") {
    scheduleWebhookProcessing(input.options.webhookStore, input.processor, result.event);
  } else if (input.provider === "gohighlevel" && input.options.integrationEventProcessor) {
    scheduleIntegrationEventProcessing(
      input.integrationEventStore,
      input.options.integrationEventProcessor,
      result.event
    );
  }
}

function scheduleIntegrationEventProcessing(
  store: IntegrationEventStore,
  processor: IntegrationEventProcessor,
  event: import("../webhooks/integrationEventStore.ts").IntegrationEventRecord
) {
  setImmediate(async () => {
    await store.updateStatus?.(event.id, "processing");
    try {
      await processor.process(event);
      await store.updateStatus?.(event.id, "processed");
    } catch (error) {
      const serialized = sanitizeForLogs(serializeError(error));
      await store.updateStatus?.(event.id, "failed", serialized && typeof serialized === "object" && "message" in serialized
        ? String(serialized.message)
        : "Processing failed");
      logger.error(
        {
          provider: event.provider,
          eventId: event.id,
          eventType: event.eventType,
          error: serialized
        },
        "Integration webhook processing failed"
      );
    }
  });
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

function hasValidOptionalGoHighLevelSourceHeader(request: IncomingMessage): boolean {
  const value = request.headers["x-ddp-webhook-source"];
  const firstValue = Array.isArray(value) ? value[0] : value;
  if (firstValue === undefined) {
    return true;
  }
  return firstValue.trim().toLowerCase() === "gohighlevel";
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function sendHtml(response: ServerResponse, statusCode: number, body: string) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  response.end(body);
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

async function readForm(request: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const maxBytes = 10 * 1024;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error("Request body exceeded 10KB limit");
    }
    chunks.push(buffer);
  }

  const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  return Object.fromEntries(params.entries());
}
