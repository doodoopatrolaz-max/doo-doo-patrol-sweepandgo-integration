import { createHash } from "node:crypto";
import {
  classifyDashboardSource,
  type DashboardSourceBucket
} from "../dashboard/sourceAttribution.ts";

export type SweepAndGoNewClientEmail = {
  messageId: string;
  subject: string;
  from?: string;
  receivedAt: string;
  body: string;
};

export type ParsedSweepAndGoNewClientEmail = {
  messageId: string;
  messageFingerprint: string;
  emailReceivedAt: string;
  phoenixBusinessDate: string;
  cleanUpFrequency?: string;
  numberOfDogs?: string;
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
  cellPhoneNumber?: string;
  zipCode?: string;
  homeAddress?: string;
  howHeardAboutUs?: string;
  howHeardAboutUsDetails?: string;
  comment?: string;
  sourceBucket: DashboardSourceBucket;
  sourceEvidence: Record<string, unknown>;
};

export type NewClientSourceMatchCandidate = {
  id: string;
  entityType: "one_time_cleanup_intake" | "recurring_customer";
  businessDate: string;
  email?: string;
  phone?: string;
  name?: string;
  address?: string;
  externalSweepGoId?: string;
  hasExistingSourceEvidence?: boolean;
};

export type NewClientSourceMatch =
  | {
      status: "matched";
      candidate: NewClientSourceMatchCandidate;
      matchMethod: "email_date" | "phone_date" | "external_sweepgo_id" | "name_address_date" | "singleton_recurring_customer_date";
    }
  | {
      status: "needs_review";
      reviewReason: string;
      candidateCount: number;
    }
  | {
      status: "unmatched";
      reviewReason: string;
    };

const FIELD_LABELS: Record<string, keyof ParsedSweepAndGoNewClientEmail> = {
  "number of dogs": "numberOfDogs",
  "clean up frequency": "cleanUpFrequency",
  "first name": "firstName",
  "last name": "lastName",
  "email address": "emailAddress",
  "cell phone number": "cellPhoneNumber",
  "zip code": "zipCode",
  "home address": "homeAddress",
  "how you heard about us": "howHeardAboutUs",
  "how you heard about us details": "howHeardAboutUsDetails",
  "comment": "comment"
};

export function isSweepAndGoNewClientEmail(input: Pick<SweepAndGoNewClientEmail, "subject" | "from">): boolean {
  return (
    /sweepandgo|sweep\s*&\s*go/i.test(input.from ?? "") &&
    /client with name\s+".+?"\s+created new account/i.test(input.subject)
  );
}

export function parseSweepAndGoNewClientEmail(input: SweepAndGoNewClientEmail): ParsedSweepAndGoNewClientEmail {
  const fields = parseLabelValueBody(input.body);
  const parsed: ParsedSweepAndGoNewClientEmail = {
    messageId: input.messageId,
    messageFingerprint: fingerprintEmail(input),
    emailReceivedAt: normalizeTimestamp(input.receivedAt),
    phoenixBusinessDate: phoenixDate(input.receivedAt),
    sourceBucket: "other_unknown",
    sourceEvidence: {}
  };

  for (const [label, value] of fields) {
    const key = FIELD_LABELS[normalizeLabel(label)];
    if (!key || !value) {
      continue;
    }
    (parsed as Record<string, unknown>)[key] = value;
  }

  parsed.sourceEvidence = buildSourceEvidence(parsed);
  parsed.sourceBucket = classifyDashboardSource(parsed.sourceEvidence).bucket;
  return parsed;
}

export function matchNewClientSourceEmail(
  parsed: ParsedSweepAndGoNewClientEmail,
  candidates: NewClientSourceMatchCandidate[]
): NewClientSourceMatch {
  const sameDateCandidates = candidates.filter((candidate) => candidate.businessDate === parsed.phoenixBusinessDate);
  const email = normalizeEmail(parsed.emailAddress);
  const phone = normalizePhone(parsed.cellPhoneNumber);
  const name = normalizeName([parsed.firstName, parsed.lastName].filter(Boolean).join(" "));
  const address = normalizeText(parsed.homeAddress);

  const emailMatch = uniqueMatch(sameDateCandidates.filter((candidate) => email && normalizeEmail(candidate.email) === email));
  if (emailMatch.status === "matched") {
    return { status: "matched", candidate: emailMatch.candidate, matchMethod: "email_date" };
  }
  if (emailMatch.status === "ambiguous") {
    return { status: "needs_review", reviewReason: "multiple_email_date_matches", candidateCount: emailMatch.count };
  }

  const phoneMatch = uniqueMatch(sameDateCandidates.filter((candidate) => phone && normalizePhone(candidate.phone) === phone));
  if (phoneMatch.status === "matched") {
    return { status: "matched", candidate: phoneMatch.candidate, matchMethod: "phone_date" };
  }
  if (phoneMatch.status === "ambiguous") {
    return { status: "needs_review", reviewReason: "multiple_phone_date_matches", candidateCount: phoneMatch.count };
  }

  const nameAddressMatch = uniqueMatch(sameDateCandidates.filter((candidate) => {
    return Boolean(
      name &&
      address &&
      normalizeName(candidate.name) === name &&
      normalizeText(candidate.address) === address
    );
  }));
  if (nameAddressMatch.status === "matched") {
    return { status: "matched", candidate: nameAddressMatch.candidate, matchMethod: "name_address_date" };
  }
  if (nameAddressMatch.status === "ambiguous") {
    return { status: "needs_review", reviewReason: "multiple_name_address_date_matches", candidateCount: nameAddressMatch.count };
  }

  return { status: "unmatched", reviewReason: "no_safe_match" };
}

export function isOneTimeCleanupEmail(parsed: ParsedSweepAndGoNewClientEmail): boolean {
  return /\bone\s*time\b|\bone-time\b|\bonetime\b/i.test(parsed.cleanUpFrequency ?? "");
}

export function emailSourceEvidenceForStorage(parsed: ParsedSweepAndGoNewClientEmail): Record<string, unknown> {
  return {
    email_source: "sweepandgo_new_client_email",
    source_confidence: "owner_email_evidence",
    clean_up_frequency: parsed.cleanUpFrequency,
    how_heard_about_us: parsed.howHeardAboutUs,
    how_heard_about_us_details: parsed.howHeardAboutUsDetails,
    source_bucket: parsed.sourceBucket,
    email_received_at: parsed.emailReceivedAt,
    source_evidence_captured_at: new Date().toISOString()
  };
}

function buildSourceEvidence(parsed: ParsedSweepAndGoNewClientEmail): Record<string, unknown> {
  return {
    email_source: "sweepandgo_new_client_email",
    source_confidence: "owner_email_evidence",
    clean_up_frequency: parsed.cleanUpFrequency,
    how_heard_about_us: parsed.howHeardAboutUs,
    how_heard_about_us_details: parsed.howHeardAboutUsDetails
  };
}

function parseLabelValueBody(body: string): Array<[string, string]> {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const pairs: Array<[string, string]> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const label = normalizeLabel(lines[index]);
    if (!(label in FIELD_LABELS)) {
      continue;
    }

    const value = lines[index + 1]?.trim();
    if (value && !(normalizeLabel(value) in FIELD_LABELS)) {
      pairs.push([lines[index], value]);
      index += 1;
    }
  }

  return pairs;
}

function uniqueMatch(candidates: NewClientSourceMatchCandidate[]): { status: "none" } | { status: "matched"; candidate: NewClientSourceMatchCandidate } | { status: "ambiguous"; count: number } {
  const unique = new Map(candidates.map((candidate) => [`${candidate.entityType}:${candidate.id}`, candidate]));
  if (unique.size === 0) {
    return { status: "none" };
  }
  if (unique.size === 1) {
    return { status: "matched", candidate: [...unique.values()][0] };
  }
  return { status: "ambiguous", count: unique.size };
}

function fingerprintEmail(input: SweepAndGoNewClientEmail): string {
  return createHash("sha256")
    .update([
      input.messageId,
      input.subject,
      normalizeTimestamp(input.receivedAt),
      input.body.replace(/\s+/g, " ").trim()
    ].join("|"))
    .digest("hex");
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function phoenixDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized) ? normalized : undefined;
}

function normalizePhone(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, "");
  if (!digits) {
    return undefined;
  }
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function normalizeName(value: string | undefined): string | undefined {
  return normalizeText(value);
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return normalized || undefined;
}
