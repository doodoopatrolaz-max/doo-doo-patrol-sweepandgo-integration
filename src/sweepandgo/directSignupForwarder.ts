import type { AppConfig } from "../config.ts";
import { classifyDashboardSource, type DashboardSourceBucket } from "../dashboard/sourceAttribution.ts";
import { logger, sanitizeForLogs, serializeError } from "../logger.ts";
import type { WebhookProcessor } from "../webhooks/processor.ts";
import type { WebhookEvent } from "../webhooks/store.ts";

const DIRECT_SIGNUP_EVENTS = new Set([
  "client:client_onboarding_recurring",
  "client:client_onboarding_onetime"
]);

type DirectSignupForwarderConfig = Pick<
  AppConfig,
  "leadcontextOnboardingCompleteUrl" | "leadcontextOnboardingCompleteSecret"
>;

export type LeadContextOnboardingPayload = Record<string, unknown> & {
  data: Record<string, unknown>;
  source: "sweepandgo_direct_signup";
  event_type: string;
  lead_source: string;
  original_source: string;
  source_detail: "direct_signup";
  source_bucket: DashboardSourceBucket;
  dashboard_source_bucket: DashboardSourceBucket;
};

export class SweepAndGoDirectSignupForwarder implements WebhookProcessor {
  private readonly destinationUrl: string;
  private readonly secret?: string;

  constructor(config: DirectSignupForwarderConfig) {
    this.destinationUrl = config.leadcontextOnboardingCompleteUrl;
    this.secret = config.leadcontextOnboardingCompleteSecret;
  }

  async process(event: WebhookEvent): Promise<void> {
    if (!isDirectSignupEvent(event)) {
      return;
    }

    const payload = normalizeDirectSignupForLeadContext(event.payload);
    const destination = new URL(this.destinationUrl);
    const summary = safeForwardingSummary(event, payload, destination, Boolean(this.secret));

    logger.info(summary, "Sweep&Go direct signup received; forwarding to leadcontext onboarding-complete intake");

    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-ddp-forwarded-from": "doo-doo-patrol-sweepandgo-integration",
        "x-ddp-source-event-type": event.eventType
      };
      if (this.secret) {
        headers["x-sweepgo-webhook-secret"] = this.secret;
      }

      const response = await fetch(this.destinationUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = undefined;
      }

      logger.info(
        {
          ...summary,
          responseStatus: response.status,
          leadcontextOk: response.ok,
          leadcontextBodyKeys: topLevelKeys(responseBody)
        },
        "Sweep&Go direct signup forward completed"
      );
    } catch (error) {
      logger.error(
        {
          ...summary,
          error: sanitizeForLogs(serializeError(error))
        },
        "Sweep&Go direct signup forward failed"
      );
    }
  }
}

export function normalizeDirectSignupForLeadContext(payload: unknown): LeadContextOnboardingPayload {
  const root = asRecord(payload) ?? {};
  const data = asRecord(root.data) ?? {};
  const eventType = directSignupEventType(root, data) ?? "client:client_onboarding_recurring";
  const sourceEvidence = buildSourceEvidence(root, data);
  const sourceBucket = classifyDashboardSource(sourceEvidence).bucket;
  const leadSource = leadSourceForBucket(sourceBucket);
  const howHeard = firstStringFrom([data, root], [
    "how_heard_about_us",
    "how_heard_answer",
    "how_you_heard_about_us",
    "How you heard about us"
  ]);
  const howHeardDetails = firstStringFrom([data, root], [
    "how_heard_about_us_details",
    "how_heard_details",
    "source_details",
    "How you heard about us details"
  ]);

  return {
    ...root,
    data: {
      ...data,
      ...(howHeard ? { how_heard_about_us: howHeard } : {}),
      ...(howHeardDetails ? { how_heard_about_us_details: howHeardDetails } : {}),
      lead_source: leadSource,
      original_source: leadSource,
      source_detail: "direct_signup",
      source_bucket: sourceBucket,
      dashboard_source_bucket: sourceBucket
    },
    source: "sweepandgo_direct_signup",
    event_type: eventType,
    type: eventType,
    lead_source: leadSource,
    original_source: leadSource,
    source_detail: "direct_signup",
    source_bucket: sourceBucket,
    dashboard_source_bucket: sourceBucket,
    forwarded_from_bi: true
  };
}

function isDirectSignupEvent(event: WebhookEvent): boolean {
  const root = asRecord(event.payload) ?? {};
  const data = asRecord(root.data) ?? {};
  const eventType = firstString([
    event.eventType,
    root.type,
    root.event_type,
    root.eventType,
    data.type,
    data.event_type,
    data.eventType
  ]);
  return Boolean(eventType && DIRECT_SIGNUP_EVENTS.has(eventType.toLowerCase()));
}

function directSignupEventType(root: Record<string, unknown>, data: Record<string, unknown>): string | undefined {
  const eventType = firstString([
    root.type,
    root.event_type,
    root.eventType,
    data.type,
    data.event_type,
    data.eventType
  ]);
  return eventType?.toLowerCase();
}

function buildSourceEvidence(root: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown> {
  return {
    lead_source: firstStringFrom([data, root], ["lead_source", "leadSource", "source", "customer_source", "acquisition_source"]),
    original_source: firstStringFrom([data, root], ["original_source", "originalSource"]),
    source_detail: firstStringFrom([data, root], ["source_detail", "sourceDetail"]),
    how_heard_about_us: firstStringFrom([data, root], [
      "how_heard_about_us",
      "how_heard_answer",
      "how_you_heard_about_us",
      "How you heard about us"
    ]),
    how_heard_about_us_details: firstStringFrom([data, root], [
      "how_heard_about_us_details",
      "how_heard_details",
      "source_details",
      "How you heard about us details"
    ]),
    tracking_field: firstStringFrom([data, root], ["tracking_field", "trackingField"]),
    tags: firstStringFrom([data, root], ["tags"])
  };
}

function leadSourceForBucket(bucket: DashboardSourceBucket): string {
  switch (bucket) {
    case "facebook":
      return "facebook";
    case "website_paid":
    case "website_organic":
      return "website";
    case "referral":
      return "referral";
    case "truck_wrap":
      return "truck_wrap";
    case "other_unknown":
      return "unknown";
  }
}

function safeForwardingSummary(
  event: WebhookEvent,
  payload: LeadContextOnboardingPayload,
  destination: URL,
  secretConfigured: boolean
) {
  return {
    webhookEventId: event.id,
    sweepandgoEventIdPresent: Boolean(event.sweepandgoEventId),
    eventType: payload.event_type,
    destinationHost: destination.host,
    destinationPath: destination.pathname,
    sourceBucket: payload.source_bucket,
    leadSource: payload.lead_source,
    secretConfigured,
    firstNamePresent: fieldPresent(payload.data, ["first_name", "firstName", "name", "client_name"]),
    emailPresent: fieldPresent(payload.data, ["email", "email_address", "client_email", "customer_email"]),
    phonePresent: fieldPresent(payload.data, ["cell_phone", "cell_phone_number", "phone", "phone_number"]),
    frequencyPresent: fieldPresent(payload.data, ["clean_up_frequency", "cleanup_frequency", "service_frequency", "frequency"]),
    sourceEvidencePresent: Boolean(payload.source_bucket && payload.source_bucket !== "other_unknown")
  };
}

function fieldPresent(record: Record<string, unknown>, keys: string[]): boolean {
  return Boolean(firstString(keys.map((key) => record[key])));
}

function firstStringFrom(candidates: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const candidate of candidates) {
    const value = firstString(keys.map((key) => candidate[key]));
    if (value) {
      return value;
    }
  }
  return undefined;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function topLevelKeys(value: unknown): string[] {
  const record = asRecord(value);
  return record ? Object.keys(record).sort() : [];
}
