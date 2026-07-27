import { logger, serializeError } from "../logger.ts";
import type { WebhookProcessor } from "../webhooks/processor.ts";
import type { WebhookEvent } from "../webhooks/store.ts";
import {
  isSweepAndGoNewClientEmail,
  parseSweepAndGoNewClientEmail,
  type ParsedSweepAndGoNewClientEmail,
  type SweepAndGoNewClientEmail
} from "./newClientSourceEmail.ts";
import type { NewClientSourceApplyResult } from "./newClientSourceStore.ts";

export type GmailNewClientEmailReader = {
  searchNewClientEmails(input: { query: string; maxResults: number }): Promise<SweepAndGoNewClientEmail[]>;
};

export type NewClientSourceLookupAttemptInput = {
  webhookEventId: string;
  eventFingerprint: string;
  eventType: string;
  phoenixBusinessDate: string;
  status: "disabled" | "matched" | "needs_review" | "unmatched" | "not_found" | "error";
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type NewClientSourceEvidenceStore = {
  apply(parsed: ParsedSweepAndGoNewClientEmail): Promise<NewClientSourceApplyResult>;
  recordLookupAttempt?(input: NewClientSourceLookupAttemptInput): Promise<void>;
};

export type NewClientSourceLookupResult = {
  status: "disabled" | "matched" | "needs_review" | "unmatched" | "not_found" | "error" | "ignored";
  messagesRead: number;
  parsedMessages: number;
  matched: number;
  needsReview: number;
  unmatched: number;
  skippedExisting: number;
  reason?: string;
};

const LOOKUP_EVENT_TYPES = new Set([
  "client:client_onboarding_recurring",
  "client:client_onboarding_onetime"
]);

export class SweepAndGoNewClientSourceLookupProcessor implements WebhookProcessor {
  private readonly reader?: GmailNewClientEmailReader;
  private readonly store: NewClientSourceEvidenceStore;
  private readonly maxResults: number;

  constructor(input: {
    reader?: GmailNewClientEmailReader;
    store: NewClientSourceEvidenceStore;
    maxResults?: number;
  }) {
    this.reader = input.reader;
    this.store = input.store;
    this.maxResults = input.maxResults ?? 10;
  }

  async process(event: WebhookEvent): Promise<void> {
    const result = await this.lookupForWebhook(event);
    if (result.status === "ignored") {
      return;
    }
    logger.info(
      {
        webhookEventId: event.id,
        eventType: event.eventType,
        eventFingerprint: event.eventFingerprint,
        status: result.status,
        messagesRead: result.messagesRead,
        parsedMessages: result.parsedMessages,
        matched: result.matched,
        needsReview: result.needsReview,
        unmatched: result.unmatched,
        skippedExisting: result.skippedExisting,
        reason: result.reason
      },
      "Sweep&Go new-client Gmail source lookup completed"
    );
  }

  async lookupForWebhook(event: WebhookEvent): Promise<NewClientSourceLookupResult> {
    if (!LOOKUP_EVENT_TYPES.has(event.eventType)) {
      return emptyResult("ignored");
    }

    const phoenixBusinessDate = eventPhoenixDate(event);
    if (!this.reader) {
      await this.recordAttempt(event, {
        status: "disabled",
        phoenixBusinessDate,
        reason: "gmail_readonly_not_configured"
      });
      return { ...emptyResult("disabled"), reason: "gmail_readonly_not_configured" };
    }

    try {
      const query = buildSweepAndGoNewClientEmailQuery(phoenixBusinessDate);
      const messages = await this.reader.searchNewClientEmails({
        query,
        maxResults: this.maxResults
      });
      const parsedMessages = messages
        .filter(isSweepAndGoNewClientEmail)
        .map(parseSweepAndGoNewClientEmail);

      if (!parsedMessages.length) {
        await this.recordAttempt(event, {
          status: "not_found",
          phoenixBusinessDate,
          reason: "no_matching_new_client_email_found",
          metadata: { messagesRead: messages.length }
        });
        return {
          ...emptyResult("not_found"),
          messagesRead: messages.length,
          reason: "no_matching_new_client_email_found"
        };
      }

      const summary = {
        matched: 0,
        needsReview: 0,
        unmatched: 0,
        skippedExisting: 0
      };
      for (const parsed of parsedMessages) {
        const applyResult = await this.store.apply(parsed);
        if (applyResult.status === "matched") {
          summary.matched += 1;
        } else if (applyResult.status === "needs_review") {
          summary.needsReview += 1;
        } else if (applyResult.status === "unmatched") {
          summary.unmatched += 1;
        } else if (applyResult.status === "skipped_existing") {
          summary.skippedExisting += 1;
        }
      }

      const status = summary.matched || summary.skippedExisting
        ? "matched"
        : summary.needsReview
          ? "needs_review"
          : "unmatched";
      await this.recordAttempt(event, {
        status,
        phoenixBusinessDate,
        reason: status === "matched" ? undefined : "email_found_without_stable_match",
        metadata: {
          messagesRead: messages.length,
          parsedMessages: parsedMessages.length,
          ...summary
        }
      });

      return {
        status,
        messagesRead: messages.length,
        parsedMessages: parsedMessages.length,
        ...summary
      };
    } catch (error) {
      const reason = serializeError(error).message;
      await this.recordAttempt(event, {
        status: "error",
        phoenixBusinessDate,
        reason,
        metadata: { errorName: serializeError(error).name }
      });
      logger.warn(
        {
          webhookEventId: event.id,
          eventType: event.eventType,
          eventFingerprint: event.eventFingerprint,
          error: serializeError(error)
        },
        "Sweep&Go new-client Gmail source lookup failed non-fatally"
      );
      return { ...emptyResult("error"), reason };
    }
  }

  private async recordAttempt(
    event: WebhookEvent,
    input: Omit<NewClientSourceLookupAttemptInput, "webhookEventId" | "eventFingerprint" | "eventType">
  ): Promise<void> {
    try {
      await this.store.recordLookupAttempt?.({
        webhookEventId: event.id,
        eventFingerprint: event.eventFingerprint,
        eventType: event.eventType,
        ...input
      });
    } catch (error) {
      logger.warn(
        {
          webhookEventId: event.id,
          eventType: event.eventType,
          eventFingerprint: event.eventFingerprint,
          error: serializeError(error)
        },
        "Sweep&Go new-client Gmail source lookup attempt recording failed non-fatally"
      );
    }
  }
}

export function buildSweepAndGoNewClientEmailQuery(phoenixBusinessDate: string): string {
  const start = addDays(phoenixBusinessDate, -1);
  const end = addDays(phoenixBusinessDate, 2);
  return [
    "from:noreply@sweepandgo.com",
    'subject:"created new account"',
    `after:${gmailDate(start)}`,
    `before:${gmailDate(end)}`,
    "-in:trash"
  ].join(" ");
}

export function isNewClientSourceLookupEvent(eventType: string): boolean {
  return LOOKUP_EVENT_TYPES.has(eventType);
}

function emptyResult(status: NewClientSourceLookupResult["status"]): NewClientSourceLookupResult {
  return {
    status,
    messagesRead: 0,
    parsedMessages: 0,
    matched: 0,
    needsReview: 0,
    unmatched: 0,
    skippedExisting: 0
  };
}

function eventPhoenixDate(event: WebhookEvent): string {
  const root = asRecord(event.payload) ?? {};
  const data = asRecord(root.data) ?? root;
  const timestamp = firstString([
    root.created,
    root.timestamp,
    root.event_timestamp,
    root.eventTimestamp,
    data.created,
    data.timestamp,
    data.created_at,
    data.updated_at,
    event.receivedAt
  ]) ?? event.receivedAt;
  return phoenixDate(timestamp);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function gmailDate(date: string): string {
  return date.replace(/-/g, "/");
}

function phoenixDate(value: string): string {
  const date = normalizeTimestamp(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function normalizeTimestamp(value: string): Date {
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
    : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
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
