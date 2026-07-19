import { normalizeExplicitCustomerSource } from "../reporting/sourceNormalization.ts";
import type { GoHighLevelContact } from "./client.ts";

export const WEBSITE_LEAD_TAG = "website lead";
export const FACEBOOK_LEAD_TAG = "facebook lead";

export type DirectWebsiteSignupEvidence = {
  lead_source?: unknown;
  leadSource?: unknown;
  original_source?: unknown;
  originalSource?: unknown;
  source_detail?: unknown;
  sourceDetail?: unknown;
  tracking_field?: unknown;
  trackingField?: unknown;
  source?: unknown;
  customer_source?: unknown;
  customerSource?: unknown;
  acquisition_source?: unknown;
  acquisitionSource?: unknown;
  how_heard_answer?: unknown;
  howHeardAnswer?: unknown;
  how_heard_about_us?: unknown;
  howHeardAboutUs?: unknown;
  trustedWebsiteDirectSignupRoute?: boolean;
};

export type GoHighLevelContactTagClient = {
  getContact(contactId: string): Promise<GoHighLevelContact>;
  addContactTags(contactId: string, tags: string[]): Promise<unknown>;
};

export type WebsiteLeadTagResult =
  | { status: "added_website_lead_tag" }
  | { status: "already_had_website_lead_tag" }
  | { status: "preserved_existing_facebook_lead_tag" }
  | { status: "skipped_missing_contact_id" }
  | { status: "skipped_unsafe_source" };

export async function ensureDirectWebsiteSignupLeadTag(input: {
  client: GoHighLevelContactTagClient;
  contactId?: string;
  evidence: DirectWebsiteSignupEvidence;
}): Promise<WebsiteLeadTagResult> {
  const contactId = input.contactId?.trim();
  if (!contactId) {
    return { status: "skipped_missing_contact_id" };
  }

  if (!isSafeDirectWebsiteSignup(input.evidence)) {
    return { status: "skipped_unsafe_source" };
  }

  const existingTags = normalizedTagSet(extractContactTags(await input.client.getContact(contactId)));
  if (existingTags.has(normalizeTag(WEBSITE_LEAD_TAG))) {
    return { status: "already_had_website_lead_tag" };
  }
  if (existingTags.has(normalizeTag(FACEBOOK_LEAD_TAG))) {
    return { status: "preserved_existing_facebook_lead_tag" };
  }

  await input.client.addContactTags(contactId, [WEBSITE_LEAD_TAG]);
  return { status: "added_website_lead_tag" };
}

export function isSafeDirectWebsiteSignup(evidence: DirectWebsiteSignupEvidence): boolean {
  if (evidence.trustedWebsiteDirectSignupRoute === true) {
    return true;
  }

  const explicit = normalizeExplicitCustomerSource({
    lead_source: firstPresent(evidence.lead_source, evidence.leadSource),
    original_source: firstPresent(evidence.original_source, evidence.originalSource),
    tracking_field: firstPresent(evidence.tracking_field, evidence.trackingField),
    source: evidence.source,
    customer_source: firstPresent(evidence.customer_source, evidence.customerSource),
    acquisition_source: firstPresent(evidence.acquisition_source, evidence.acquisitionSource),
    how_heard_answer: firstPresent(evidence.how_heard_answer, evidence.howHeardAnswer),
    how_heard_about_us: firstPresent(evidence.how_heard_about_us, evidence.howHeardAboutUs)
  });

  return explicit.normalizedSource === "website";
}

export function extractContactTags(contact: GoHighLevelContact): string[] {
  const tags = Array.isArray(contact.tags)
    ? contact.tags
    : isRecord(contact.contact) && Array.isArray(contact.contact.tags)
      ? contact.contact.tags
      : [];

  return tags.flatMap((tag) => {
    if (typeof tag === "string" && tag.trim()) {
      return [tag.trim()];
    }
    if (isRecord(tag) && typeof tag.name === "string" && tag.name.trim()) {
      return [tag.name.trim()];
    }
    return [];
  });
}

function normalizedTagSet(tags: string[]): Set<string> {
  return new Set(tags.map(normalizeTag).filter(Boolean));
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

function firstPresent(...values: unknown[]): unknown {
  return values.find((value) => typeof value === "string" ? value.trim() : value !== undefined && value !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
