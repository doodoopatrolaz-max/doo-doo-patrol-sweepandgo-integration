import { normalizeExplicitCustomerSource, type NormalizedCustomerSource } from "../reporting/sourceNormalization.ts";
import type { WebhookProcessor } from "../webhooks/processor.ts";
import type { WebhookEvent } from "../webhooks/store.ts";
import type { ExistingSweepAndGoCustomer, SweepAndGoWebhookBiStore } from "./webhookBiStore.ts";

export type SweepAndGoWebhookBiProcessingResult = {
  status: "processed" | "ignored";
  action: string;
  reconciliationIssue?: string;
};

type ParsedSweepAndGoWebhook = {
  eventType: string;
  externalEventId?: string;
  externalCustomerId?: string;
  subscriptionId?: string;
  subscriptionName?: string;
  subscriptionNames?: string;
  status?: string;
  state?: string;
  source: NormalizedCustomerSource;
  sourceRaw?: string;
  sourceEvidenceField?: string;
  eventTimestamp: string;
  eventDate: string;
  terminationReason?: string;
  serviceFrequency?: string;
};

const SUPPORTED_EVENT_TYPES = new Set([
  "client:client_onboarding_recurring",
  "client:subscription_created",
  "client:subscription_canceled",
  "client:changed_status",
  "client:client_assigned"
]);

export class SweepAndGoWebhookBiProcessor implements WebhookProcessor {
  private readonly store: SweepAndGoWebhookBiStore;

  constructor(store: SweepAndGoWebhookBiStore) {
    this.store = store;
  }

  async process(event: WebhookEvent): Promise<void> {
    await this.processWithResult(event);
  }

  async processWithResult(event: WebhookEvent): Promise<SweepAndGoWebhookBiProcessingResult> {
    const parsed = parseSweepAndGoWebhook(event);
    if (!SUPPORTED_EVENT_TYPES.has(parsed.eventType)) {
      return { status: "ignored", action: "unsupported_event_type" };
    }

    if (parsed.eventType === "client:client_assigned") {
      if (!parsed.externalCustomerId) {
        await this.createMissingClientIssue(parsed, event);
        return {
          status: "processed",
          action: "created_reconciliation_issue",
          reconciliationIssue: "sweepandgo_webhook_missing_client_id"
        };
      }
      return { status: "processed", action: "acknowledged_client_assigned" };
    }

    if (!parsed.externalCustomerId) {
      await this.createMissingClientIssue(parsed, event);
      return {
        status: "processed",
        action: "created_reconciliation_issue",
        reconciliationIssue: "sweepandgo_webhook_missing_client_id"
      };
    }

    if (parsed.eventType === "client:client_onboarding_recurring") {
      await this.processRecurringOnboarding(parsed, event);
      return { status: "processed", action: "upserted_recurring_customer" };
    }

    if (parsed.eventType === "client:subscription_created") {
      const customer = await this.upsertCustomerWithoutNewRecurringDate(parsed, event, "active");
      await this.upsertSubscriptionService(customer, parsed, event, undefined);
      if (!customer.firstRecurringDate) {
        await this.store.createReconciliationIssue({
          issueType: "sweepandgo_subscription_created_new_customer_uncertain",
          summary: "Sweep&Go subscription_created webhook may be a new recurring customer or a service change",
          details: safeIssueDetails(parsed, event)
        });
      }
      return { status: "processed", action: "upserted_subscription_service" };
    }

    if (parsed.eventType === "client:subscription_canceled") {
      const customer = await this.upsertCustomerWithoutNewRecurringDate(parsed, event);
      if (!parsed.subscriptionId) {
        await this.store.createReconciliationIssue({
          issueType: "sweepandgo_subscription_canceled_missing_subscription_id",
          summary: "Sweep&Go subscription_canceled webhook did not include a stable subscription ID",
          details: safeIssueDetails(parsed, event)
        });
        return {
          status: "processed",
          action: "created_reconciliation_issue",
          reconciliationIssue: "sweepandgo_subscription_canceled_missing_subscription_id"
        };
      }

      await this.upsertSubscriptionService(customer, parsed, event, parsed.eventDate);
      await this.store.upsertCancellation({
        customerId: customer.id,
        externalSweepGoId: `${parsed.externalCustomerId}:${parsed.subscriptionId}`,
        cancelledOn: parsed.eventDate,
        reason: parsed.terminationReason,
        metadata: eventMetadata(parsed, event, {
          cancellationScope: "subscription",
          customerChurnNotAssumed: true
        })
      });
      return { status: "processed", action: "upserted_subscription_cancellation" };
    }

    if (parsed.eventType === "client:changed_status") {
      const status = normalizeSweepAndGoStatus(parsed.status ?? parsed.state);
      if (!status) {
        await this.store.createReconciliationIssue({
          issueType: "sweepandgo_changed_status_missing_status",
          summary: "Sweep&Go changed_status webhook did not include a reliable status",
          details: safeIssueDetails(parsed, event)
        });
        return {
          status: "processed",
          action: "created_reconciliation_issue",
          reconciliationIssue: "sweepandgo_changed_status_missing_status"
        };
      }

      await this.upsertCustomerWithoutNewRecurringDate(parsed, event, status, "overwrite");
      return { status: "processed", action: "updated_customer_status" };
    }

    return { status: "ignored", action: "unsupported_event_type" };
  }

  private async processRecurringOnboarding(parsed: ParsedSweepAndGoWebhook, event: WebhookEvent): Promise<void> {
    const customer = await this.store.upsertCustomer({
      externalCustomerId: parsed.externalCustomerId!,
      status: normalizeSweepAndGoStatus(parsed.status ?? parsed.state) ?? "active",
      source: parsed.source,
      sourceRaw: parsed.sourceRaw,
      firstRecurringDate: parsed.eventDate,
      metadata: eventMetadata(parsed, event, {
        hasActiveSubscription: true,
        firstRecurringDateEvidence: "client_onboarding_recurring_webhook",
        mrrDeferred: true
      })
    });

    await this.store.upsertService({
      customerId: customer.id,
      externalServiceId: `${parsed.externalCustomerId}:recurring-webhook`,
      cadence: "recurring",
      serviceName: parsed.subscriptionNames ?? parsed.subscriptionName,
      frequency: parsed.serviceFrequency,
      startedOn: parsed.eventDate,
      metadata: eventMetadata(parsed, event, {
        serviceEvidence: "client_onboarding_recurring_webhook"
      })
    });
  }

  private async upsertCustomerWithoutNewRecurringDate(
    parsed: ParsedSweepAndGoWebhook,
    event: WebhookEvent,
    status?: string,
    statusUpdateMode: "fill" | "overwrite" = "fill"
  ): Promise<ExistingSweepAndGoCustomer> {
    return await this.store.upsertCustomer({
      externalCustomerId: parsed.externalCustomerId!,
      status: status ?? normalizeSweepAndGoStatus(parsed.status ?? parsed.state),
      statusUpdateMode,
      source: parsed.source,
      sourceRaw: parsed.sourceRaw,
      metadata: eventMetadata(parsed, event, {
        firstRecurringDateNotSetFromEvent: true,
        mrrDeferred: true
      })
    });
  }

  private async upsertSubscriptionService(
    customer: ExistingSweepAndGoCustomer,
    parsed: ParsedSweepAndGoWebhook,
    event: WebhookEvent,
    endedOn: string | undefined
  ): Promise<void> {
    if (!parsed.subscriptionId) {
      await this.store.createReconciliationIssue({
        issueType: "sweepandgo_subscription_event_missing_subscription_id",
        summary: "Sweep&Go subscription webhook did not include a stable subscription ID",
        details: safeIssueDetails(parsed, event)
      });
      return;
    }

    await this.store.upsertService({
      customerId: customer.id,
      externalServiceId: `${parsed.externalCustomerId}:${parsed.subscriptionId}`,
      cadence: "recurring",
      serviceName: parsed.subscriptionNames ?? parsed.subscriptionName,
      frequency: parsed.serviceFrequency,
      startedOn: parsed.eventType === "client:subscription_created" ? parsed.eventDate : undefined,
      endedOn,
      metadata: eventMetadata(parsed, event, {
        serviceEvidence: parsed.eventType,
        customerChurnNotAssumed: parsed.eventType === "client:subscription_canceled"
      })
    });
  }

  private async createMissingClientIssue(parsed: ParsedSweepAndGoWebhook, event: WebhookEvent): Promise<void> {
    await this.store.createReconciliationIssue({
      issueType: "sweepandgo_webhook_missing_client_id",
      summary: "Sweep&Go webhook did not include a stable client ID",
      details: safeIssueDetails(parsed, event)
    });
  }
}

export function parseSweepAndGoWebhook(event: WebhookEvent): ParsedSweepAndGoWebhook {
  const root = asRecord(event.payload) ?? {};
  const data = asRecord(root.data) ?? root;
  const source = normalizeExplicitCustomerSource(data);
  const eventTimestamp = normalizeTimestamp(firstString([
    root.created,
    root.timestamp,
    root.event_timestamp,
    root.eventTimestamp,
    data.created,
    data.timestamp,
    data.created_at,
    data.updated_at,
    event.receivedAt
  ]), event.receivedAt);

  return {
    eventType: firstString([root.type, root.event_type, root.eventType, event.eventType]) ?? "unknown",
    externalEventId: event.sweepandgoEventId,
    externalCustomerId: firstString([
      data.client,
      data.customer,
      data.client_id,
      data.customer_id,
      data.client_identifier,
      root.client,
      root.customer,
      root.client_id,
      root.customer_id
    ]),
    subscriptionId: firstString([
      data.subscription_id,
      data.subscriptionId,
      data.subscription,
      root.subscription_id,
      root.subscriptionId
    ]),
    subscriptionName: firstString([data.subscription_name, data.subscriptionName]),
    subscriptionNames: firstString([data.subscription_names, data.subscriptionNames]),
    status: firstString([data.status, root.status]),
    state: firstString([data.state, data.state_name, root.state]),
    source: source.normalizedSource,
    sourceRaw: source.rawSource,
    sourceEvidenceField: source.evidenceField,
    eventTimestamp,
    eventDate: phoenixDate(eventTimestamp),
    terminationReason: firstString([data.termination_reason, data.cancel_reason, data.cancellation_reason]),
    serviceFrequency: firstString([data.billing_interval, data.clean_up_frequency, data.frequency])
  };
}

function eventMetadata(
  parsed: ParsedSweepAndGoWebhook,
  event: WebhookEvent,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    provider: "sweepandgo",
    webhookEventId: event.id,
    externalEventId: event.sweepandgoEventId,
    eventType: parsed.eventType,
    eventFingerprint: event.eventFingerprint,
    eventTimestamp: parsed.eventTimestamp,
    sourceEvidenceField: parsed.sourceEvidenceField,
    webhookBiProcessing: true,
    ...extra
  };
}

function safeIssueDetails(parsed: ParsedSweepAndGoWebhook, event: WebhookEvent): Record<string, unknown> {
  return {
    provider: "sweepandgo",
    webhookEventId: event.id,
    externalEventId: event.sweepandgoEventId,
    eventType: parsed.eventType,
    eventFingerprint: event.eventFingerprint,
    externalCustomerIdPresent: Boolean(parsed.externalCustomerId),
    subscriptionIdPresent: Boolean(parsed.subscriptionId),
    statusPresent: Boolean(parsed.status ?? parsed.state),
    eventTimestamp: parsed.eventTimestamp,
    source: parsed.source,
    sourceRawPresent: Boolean(parsed.sourceRaw)
  };
}

function normalizeSweepAndGoStatus(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("inactive")) {
    return "inactive";
  }
  if (normalized.includes("active")) {
    return "active";
  }
  if (normalized.includes("cancel")) {
    return "cancelled";
  }
  if (normalized.includes("pause")) {
    return "paused";
  }
  return normalized.replace(/\s+/g, "_");
}

function normalizeTimestamp(value: string | undefined, fallback: string): string {
  if (value) {
    const numeric = Number(value);
    const parsed = Number.isFinite(numeric)
      ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
      : new Date(value);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const parsedFallback = new Date(fallback);
  return Number.isFinite(parsedFallback.getTime())
    ? parsedFallback.toISOString()
    : new Date().toISOString();
}

function phoenixDate(isoTimestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(isoTimestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
