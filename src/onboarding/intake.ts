import { logger, sanitizeForLogs, serializeError } from "../logger.ts";
import type { SweepAndGoClient } from "../sweepandgo/client.ts";
import type { WebhookEvent } from "../webhooks/store.ts";
import type { OnboardingIntakeStore } from "./store.ts";

export const PRIMARY_ONBOARDING_EVENT = "client:client_onboarding_recurring";
export const SUPPORTING_ONBOARDING_EVENTS = new Set([
  "client:client_onboarding_onetime",
  "client:subscription_created"
]);

const REQUIRED_DETAIL_FIELDS = [
  "customerName",
  "customerEmail",
  "phoneNumber",
  "serviceAddress",
  "serviceStatus",
  "serviceType",
  "recurringOrOneTime",
  "dogCount",
  "gateAccessNotes",
  "paymentStatus",
  "startDateOrSchedule"
];

type OnboardingExtraction = {
  customerEmail?: string;
  customerName?: string;
  clientIdentifier?: string;
  serviceType?: string;
  verifiedDetails: Record<string, unknown>;
  missingDetails: string[];
  calculationNotes: string[];
};

export function isOnboardingTrigger(eventType: string): boolean {
  return eventType === PRIMARY_ONBOARDING_EVENT || SUPPORTING_ONBOARDING_EVENTS.has(eventType);
}

export class OnboardingWebhookProcessor {
  private readonly store: OnboardingIntakeStore;
  private readonly sweepandgoClient: SweepAndGoClient;

  constructor(store: OnboardingIntakeStore, sweepandgoClient: SweepAndGoClient) {
    this.store = store;
    this.sweepandgoClient = sweepandgoClient;
  }

  async process(event: WebhookEvent): Promise<void> {
    if (!isOnboardingTrigger(event.eventType)) {
      logger.info(
        {
          webhookEventId: event.id,
          eventType: event.eventType
        },
        "Sweep&Go webhook stored; not an onboarding trigger"
      );
      return;
    }

    const sourcesChecked = ["sweepandgo_webhook_payload"];
    const extraction = extractOnboardingDetails(event.payload);
    let sweepandgoDetails: unknown;
    let status: "captured" | "needs_review" = "captured";

    try {
      sweepandgoDetails = await this.fetchSweepAndGoDetails(extraction);
      if (sweepandgoDetails !== undefined) {
        sourcesChecked.push("sweepandgo_client_details_and_payments");
        mergeVerifiedDetails(extraction, sweepandgoDetails);
      }
    } catch (error) {
      status = "needs_review";
      extraction.calculationNotes.push(
        `Sweep&Go enrichment failed: ${serializeError(error).message}`
      );
      logger.error(
        {
          error: serializeError(error),
          webhookEventId: event.id,
          eventType: event.eventType
        },
        "Sweep&Go onboarding enrichment failed"
      );
    }

    extraction.missingDetails = missingFields(extraction.verifiedDetails);
    extraction.calculationNotes.push(...buildCalculationNotes(extraction.verifiedDetails));

    const intake = await this.store.createIntake({
      webhookEventId: event.id,
      eventType: event.eventType,
      triggerEventFingerprint: event.eventFingerprint,
      customerEmail: extraction.customerEmail,
      customerName: extraction.customerName,
      clientIdentifier: extraction.clientIdentifier,
      serviceType: extraction.serviceType,
      status: extraction.missingDetails.length ? "needs_review" : status,
      sourcesChecked,
      verifiedDetails: extraction.verifiedDetails,
      missingDetails: extraction.missingDetails,
      calculationNotes: extraction.calculationNotes,
      payload: sanitizeForLogs(event.payload),
      sweepandgoDetails: sanitizeForLogs(sweepandgoDetails)
    });

    logger.info(
      {
        onboardingIntakeId: intake.id,
        webhookEventId: event.id,
        eventType: event.eventType,
        hasCustomerEmail: Boolean(intake.customerEmail),
        hasCustomerName: Boolean(intake.customerName),
        hasClientIdentifier: Boolean(intake.clientIdentifier),
        missingDetailCount: intake.missingDetails.length,
        missingDetails: intake.missingDetails
      },
      "Captured Sweep&Go onboarding intake"
    );
  }

  private async fetchSweepAndGoDetails(extraction: OnboardingExtraction): Promise<unknown> {
    if (extraction.clientIdentifier) {
      return this.sweepandgoClient.getClientDetailsAndPayments(extraction.clientIdentifier);
    }

    if (!extraction.customerEmail) {
      return undefined;
    }

    const searchResult = await this.sweepandgoClient.searchClientByEmail({
      email: extraction.customerEmail,
      status: "active",
      latest: true
    });
    const clientIdentifier = findFirstStringByKeys(searchResult, [
      "client",
      "client_id",
      "clientId",
      "customer",
      "customer_id",
      "customerId"
    ]);

    if (!clientIdentifier) {
      return searchResult;
    }

    extraction.clientIdentifier = clientIdentifier;
    extraction.verifiedDetails.clientIdentifier = {
      value: clientIdentifier,
      source: "sweepandgo_client_search"
    };
    return this.sweepandgoClient.getClientDetailsAndPayments(clientIdentifier);
  }
}

export function extractOnboardingDetails(payload: unknown): OnboardingExtraction {
  const customerEmail = findFirstEmail(payload);
  const customerName = findFirstStringByKeys(payload, [
    "customer_name",
    "customerName",
    "client_name",
    "clientName",
    "name",
    "full_name",
    "fullName"
  ]);
  const clientIdentifier = findFirstStringByKeys(payload, [
    "client",
    "client_id",
    "clientId",
    "customer",
    "customer_id",
    "customerId"
  ]);
  const phoneNumber = findFirstStringByKeys(payload, ["phone", "phone_number", "phoneNumber", "mobile"]);
  const serviceAddress = findFirstStringByKeys(payload, [
    "service_address",
    "serviceAddress",
    "address",
    "street_address",
    "streetAddress"
  ]);
  const serviceStatus = findFirstStringByKeys(payload, ["status", "service_status", "serviceStatus"]);
  const serviceType = inferServiceType(payload);
  const recurringOrOneTime = serviceType;

  const verifiedDetails: Record<string, unknown> = {};
  addVerified(verifiedDetails, "customerEmail", customerEmail, "sweepandgo_webhook_payload");
  addVerified(verifiedDetails, "customerName", customerName, "sweepandgo_webhook_payload");
  addVerified(verifiedDetails, "clientIdentifier", clientIdentifier, "sweepandgo_webhook_payload");
  addVerified(verifiedDetails, "phoneNumber", phoneNumber, "sweepandgo_webhook_payload");
  addVerified(verifiedDetails, "serviceAddress", serviceAddress, "sweepandgo_webhook_payload");
  addVerified(verifiedDetails, "serviceStatus", serviceStatus, "sweepandgo_webhook_payload");
  addVerified(verifiedDetails, "serviceType", serviceType, "sweepandgo_webhook_payload");
  addVerified(verifiedDetails, "recurringOrOneTime", recurringOrOneTime, "sweepandgo_webhook_payload");

  return {
    customerEmail,
    customerName,
    clientIdentifier,
    serviceType,
    verifiedDetails,
    missingDetails: missingFields(verifiedDetails),
    calculationNotes: []
  };
}

function mergeVerifiedDetails(extraction: OnboardingExtraction, sweepandgoDetails: unknown) {
  const fields: Array<[string, string[]]> = [
    ["customerEmail", ["email", "customer_email", "customerEmail", "client_email", "clientEmail"]],
    ["customerName", ["customer_name", "customerName", "client_name", "clientName", "name", "full_name"]],
    ["phoneNumber", ["phone", "phone_number", "phoneNumber", "mobile"]],
    ["serviceAddress", ["service_address", "serviceAddress", "address", "street_address", "streetAddress"]],
    ["serviceStatus", ["status", "service_status", "serviceStatus"]],
    ["dogCount", ["dog_count", "dogCount", "dogs_count", "dogsCount"]],
    ["dogNames", ["dog_names", "dogNames"]],
    ["gateAccessNotes", ["gate_notes", "gateNotes", "access_notes", "accessNotes", "gate_code", "gateCode"]],
    ["yardServiceNotes", ["yard_notes", "yardNotes", "service_notes", "serviceNotes", "areas_to_clean"]],
    ["paymentStatus", ["payment_status", "paymentStatus", "card_status", "cardStatus"]],
    ["startDateOrSchedule", ["start_date", "startDate", "next_service_date", "nextServiceDate", "schedule"]],
    ["billingTags", ["tags", "client_tags", "clientTags"]]
  ];

  for (const [outputKey, searchKeys] of fields) {
    const value = findFirstValueByKeys(sweepandgoDetails, searchKeys);
    if (value !== undefined) {
      addVerified(extraction.verifiedDetails, outputKey, value, "sweepandgo_client_details_and_payments");
    }
  }

  const serviceType = inferServiceType(sweepandgoDetails);
  addVerified(extraction.verifiedDetails, "serviceType", serviceType, "sweepandgo_client_details_and_payments");
  addVerified(extraction.verifiedDetails, "recurringOrOneTime", serviceType, "sweepandgo_client_details_and_payments");

  extraction.customerEmail ??= unwrapVerifiedString(extraction.verifiedDetails.customerEmail);
  extraction.customerName ??= unwrapVerifiedString(extraction.verifiedDetails.customerName);
  extraction.clientIdentifier ??= unwrapVerifiedString(extraction.verifiedDetails.clientIdentifier);
  extraction.serviceType ??= unwrapVerifiedString(extraction.verifiedDetails.serviceType);
}

function buildCalculationNotes(verifiedDetails: Record<string, unknown>): string[] {
  const rawText = JSON.stringify(verifiedDetails);
  const monthlyPrice = matchMoney(rawText, /\$(\d+(?:\.\d+)?)\s*mo\b/i);
  const initialFee = matchMoney(rawText, /\$(\d+(?:\.\d+)?)\s*initial\b/i);
  const sprayPrice = matchMoney(rawText, /\$(\d+(?:\.\d+)?)\s*spray/i);
  const frequency = matchFrequency(rawText);
  const notes: string[] = [];

  if (monthlyPrice !== undefined && frequency) {
    const divisor = frequencyDivisor(frequency);
    const perVisit = monthlyPrice / divisor;
    notes.push(
      `Estimated scooping per-visit amount from tags: $${monthlyPrice.toFixed(2)} / ${divisor} average monthly visits = $${perVisit.toFixed(2)}.`
    );
  }

  if (initialFee !== undefined) {
    notes.push(`Initial cleanup fee tag found: $${initialFee.toFixed(2)}.`);
  }

  if (sprayPrice !== undefined) {
    notes.push(`Doo Doo Destroyer tag found: $${sprayPrice.toFixed(2)}. Confirm first-month schedule before billing if the date is not explicit.`);
  }

  if (!notes.length) {
    notes.push("No complete billing calculation could be made from verified details yet; use actual Sweep&Go invoice/payment data first when available.");
  }

  return notes;
}

function missingFields(verifiedDetails: Record<string, unknown>): string[] {
  return REQUIRED_DETAIL_FIELDS.filter((field) => verifiedDetails[field] === undefined);
}

function addVerified(
  verifiedDetails: Record<string, unknown>,
  key: string,
  value: unknown,
  source: string
) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  verifiedDetails[key] = { value, source };
}

function unwrapVerifiedString(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const rawValue = (value as Record<string, unknown>).value;
  return typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : undefined;
}

function inferServiceType(value: unknown): string | undefined {
  const text = JSON.stringify(value).toLowerCase();
  if (text.includes("client_onboarding_recurring") || text.includes("recurring")) {
    return "recurring";
  }
  if (text.includes("client_onboarding_onetime") || text.includes("one time") || text.includes("onetime")) {
    return "one-time";
  }
  return undefined;
}

function findFirstEmail(value: unknown): string | undefined {
  const direct = findFirstStringByKeys(value, ["email", "customer_email", "customerEmail", "client_email", "clientEmail"]);
  if (direct && direct.includes("@")) {
    return direct.trim();
  }

  const values = collectStrings(value);
  return values.find((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.trim()))?.trim();
}

function findFirstStringByKeys(value: unknown, keys: string[]): string | undefined {
  const found = findFirstValueByKeys(value, keys);
  if (typeof found === "string" && found.trim()) {
    return found.trim();
  }
  if (typeof found === "number" && Number.isFinite(found)) {
    return String(found);
  }
  return undefined;
}

function findFirstValueByKeys(value: unknown, keys: string[]): unknown {
  const normalizedKeys = new Set(keys.map(normalizeKey));
  return findValue(value, normalizedKeys);
}

function findValue(value: unknown, keys: Set<string>): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValue(item, keys);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(normalizeKey(key)) && nestedValue !== undefined && nestedValue !== null && nestedValue !== "") {
      return nestedValue;
    }
  }

  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    const found = findValue(nestedValue, keys);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
  }

  return [];
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function matchMoney(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  if (!match?.[1]) {
    return undefined;
  }

  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : undefined;
}

function matchFrequency(text: string): string | undefined {
  const match = text.match(/\b(1x\s*weekly|2x\s*weekly|2x\s*monthly|1x\s*monthly|1x\/week|2x\/week|2x\/month|1x\/month)\b/i);
  return match?.[1]?.toLowerCase().replace(/\s+/g, " ");
}

function frequencyDivisor(frequency: string): number {
  if (frequency.includes("2x") && (frequency.includes("weekly") || frequency.includes("week"))) {
    return 8.66;
  }
  if (frequency.includes("2x") && (frequency.includes("monthly") || frequency.includes("month"))) {
    return 2;
  }
  if (frequency.includes("1x") && (frequency.includes("monthly") || frequency.includes("month"))) {
    return 1;
  }
  return 4.33;
}
