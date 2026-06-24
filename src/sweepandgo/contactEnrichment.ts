import { loadConfig } from "../config.ts";
import { createPool } from "../db/pool.ts";
import { logger, serializeError } from "../logger.ts";
import { SweepAndGoClient } from "./client.ts";
import { SweepAndGoReportingStore, type SweepAndGoExistingContact } from "./reportingStore.ts";

export type SweepAndGoContactDetails = {
  email?: string;
  cellPhone?: string;
  homePhone?: string;
};

export type SweepAndGoContactEnrichmentResult = {
  contactsChecked: number;
  clientDetailsFetched: number;
  contactsUpdatedWithEmail: number;
  contactsUpdatedWithPhone: number;
  contactsUpdatedWithBoth: number;
  skippedEmailAlreadyExisted: number;
  skippedPhoneAlreadyExisted: number;
  skippedDetailsMissing: number;
  errors: number;
};

export async function runSweepAndGoContactEnrichment(): Promise<SweepAndGoContactEnrichmentResult> {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required for Sweep&Go contact enrichment");
  }

  const pool = await createPool(config.databaseUrl);
  const store = new SweepAndGoReportingStore(pool);
  const client = new SweepAndGoClient(config);
  const syncRun = await store.startSyncRun("sweepandgo_contact_enrichment");
  const result = emptyResult();

  try {
    const contacts = await store.listExistingSweepAndGoContacts();
    result.contactsChecked = contacts.length;

    for (const contact of contacts) {
      const details = await fetchContactDetails(client, contact, result);
      if (!details) {
        continue;
      }

      const canAddEmail = Boolean(details.email && !contact.primaryEmail);
      const canAddPhone = Boolean(details.cellPhone && !contact.primaryPhone);
      if (details.email && contact.primaryEmail) {
        result.skippedEmailAlreadyExisted += 1;
      }
      if (details.cellPhone && contact.primaryPhone) {
        result.skippedPhoneAlreadyExisted += 1;
      }
      if (!details.email && !details.cellPhone) {
        result.skippedDetailsMissing += 1;
        continue;
      }

      const update = await store.enrichExistingSweepAndGoContact({
        contactId: contact.contactId,
        email: canAddEmail ? details.email : undefined,
        phone: canAddPhone ? details.cellPhone : undefined
      });

      if (update.emailUpdated) {
        result.contactsUpdatedWithEmail += 1;
      }
      if (update.phoneUpdated) {
        result.contactsUpdatedWithPhone += 1;
      }
      if (update.emailUpdated && update.phoneUpdated) {
        result.contactsUpdatedWithBoth += 1;
      }
    }

    await store.completeSyncRun(syncRun.id, {
      recordsRead: result.clientDetailsFetched,
      recordsWritten: result.contactsUpdatedWithEmail + result.contactsUpdatedWithPhone
    });
    logger.info(result, "Sweep&Go contact enrichment completed");
    return result;
  } catch (error) {
    await store.failSyncRun(syncRun.id, serializeError(error).message);
    throw error;
  } finally {
    await pool.end();
  }
}

export function mapSweepAndGoContactDetails(response: unknown): SweepAndGoContactDetails | undefined {
  const records = contactDetailRecords(response);
  if (!records.length) {
    return undefined;
  }

  const emailCandidates: unknown[] = [];
  const cellCandidates: unknown[] = [];
  const homeCandidates: unknown[] = [];
  for (const record of records) {
    emailCandidates.push(record.email, record.client_email, record.customer_email, record.contact_email, record.primary_email);
    cellCandidates.push(record.cell_phone, record.cell_phone_number, record.mobile_phone, record.mobile, record.primary_phone);
    homeCandidates.push(record.home_phone, record.home_phone_number);
  }

  return {
    email: firstValid(emailCandidates, normalizeEmail),
    cellPhone: firstValid(cellCandidates, normalizePhone),
    homePhone: firstValid(homeCandidates, normalizePhone)
  };
}

export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const text = String(value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : undefined;
}

export function normalizePhone(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const digits = String(value).replace(/\D+/g, "");
  return digits.length >= 10 ? digits.slice(-10) : undefined;
}

async function fetchContactDetails(
  client: SweepAndGoClient,
  contact: SweepAndGoExistingContact,
  result: SweepAndGoContactEnrichmentResult
): Promise<SweepAndGoContactDetails | undefined> {
  try {
    const response = await client.getClientDetailsAndPayments(contact.externalSweepGoId);
    result.clientDetailsFetched += 1;
    return mapSweepAndGoContactDetails(response);
  } catch {
    result.errors += 1;
    return undefined;
  }
}

function emptyResult(): SweepAndGoContactEnrichmentResult {
  return {
    contactsChecked: 0,
    clientDetailsFetched: 0,
    contactsUpdatedWithEmail: 0,
    contactsUpdatedWithPhone: 0,
    contactsUpdatedWithBoth: 0,
    skippedEmailAlreadyExisted: 0,
    skippedPhoneAlreadyExisted: 0,
    skippedDetailsMissing: 0,
    errors: 0
  };
}

function contactDetailRecords(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) {
    return response.filter(isRecord);
  }
  if (isRecord(response) && Array.isArray(response.data)) {
    return response.data.filter(isRecord);
  }
  return isRecord(response) ? [response] : [];
}

function firstValid(values: unknown[], normalize: (value: unknown) => string | undefined): string | undefined {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
