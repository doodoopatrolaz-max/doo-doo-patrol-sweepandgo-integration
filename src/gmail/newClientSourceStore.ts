import { normalizeCustomerSource } from "../reporting/sourceNormalization.ts";
import {
  emailSourceEvidenceForStorage,
  isOneTimeCleanupEmail,
  matchNewClientSourceEmail,
  type NewClientSourceMatch,
  type NewClientSourceMatchCandidate,
  type ParsedSweepAndGoNewClientEmail
} from "./newClientSourceEmail.ts";

type Queryable = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type NewClientSourceApplyResult = {
  status: "matched" | "needs_review" | "unmatched" | "skipped_existing";
  entityType?: "one_time_cleanup_intake" | "recurring_customer";
  matchMethod?: string;
  sourceBucket: string;
  reviewReason?: string;
};

export class PostgresNewClientSourceEmailStore {
  private readonly pool: Queryable;

  constructor(pool: Queryable) {
    this.pool = pool;
  }

  async dryRun(parsed: ParsedSweepAndGoNewClientEmail): Promise<NewClientSourceMatch> {
    const candidates = isOneTimeCleanupEmail(parsed)
      ? await this.oneTimeCleanupCandidates(parsed)
      : await this.recurringCustomerCandidates(parsed);
    return matchNewClientSourceEmail(parsed, candidates);
  }

  async apply(parsed: ParsedSweepAndGoNewClientEmail): Promise<NewClientSourceApplyResult> {
    const existing = await this.pool.query(
      `SELECT match_status
       FROM sweepandgo_new_client_email_sources
       WHERE gmail_message_id = $1
          OR message_fingerprint = $2
       LIMIT 1`,
      [parsed.messageId, parsed.messageFingerprint]
    );
    if (existing.rows[0]?.match_status === "matched") {
      return { status: "skipped_existing", sourceBucket: parsed.sourceBucket };
    }

    const match = await this.dryRun(parsed);
    const evidence = emailSourceEvidenceForStorage(parsed);

    if (match.status !== "matched") {
      await this.upsertEmailEvidence(parsed, {
        matchStatus: match.status,
        reviewReason: match.reviewReason,
        evidence
      });
      return {
        status: match.status,
        sourceBucket: parsed.sourceBucket,
        reviewReason: match.reviewReason
      };
    }

    await this.upsertEmailEvidence(parsed, {
      matchStatus: "matched",
      matchedEntityType: match.candidate.entityType,
      onboardingIntakeId: match.candidate.entityType === "one_time_cleanup_intake" ? match.candidate.id : undefined,
      customerId: match.candidate.entityType === "recurring_customer" ? match.candidate.id : undefined,
      matchMethod: match.matchMethod,
      evidence
    });

    if (match.candidate.entityType === "recurring_customer") {
      await this.upsertCustomerSource(match.candidate.id, parsed, evidence);
    }

    return {
      status: "matched",
      entityType: match.candidate.entityType,
      matchMethod: match.matchMethod,
      sourceBucket: parsed.sourceBucket
    };
  }

  private async oneTimeCleanupCandidates(parsed: ParsedSweepAndGoNewClientEmail): Promise<NewClientSourceMatchCandidate[]> {
    const result = await this.pool.query(
      `SELECT
          oi.id::text AS id,
          (COALESCE(we.received_at, oi.created_at) AT TIME ZONE 'America/Phoenix')::date::text AS business_date,
          oi.customer_email,
          oi.customer_name,
          oi.client_identifier,
          oi.verified_details,
          oi.payload,
          we.payload AS webhook_payload
       FROM onboarding_intakes oi
       LEFT JOIN webhook_events we ON we.id = oi.webhook_event_id
       WHERE (COALESCE(we.received_at, oi.created_at) AT TIME ZONE 'America/Phoenix')::date BETWEEN ($1::date - INTERVAL '1 day') AND ($1::date + INTERVAL '1 day')
         AND (
           oi.event_type = 'client:client_onboarding_onetime'
           OR oi.service_type ILIKE '%one%time%'
           OR oi.service_type ILIKE '%one_time%'
         )`,
      [parsed.phoenixBusinessDate]
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      entityType: "one_time_cleanup_intake",
      businessDate: String(row.business_date),
      email: stringValue(row.customer_email) ?? findFirstNestedString(row, ["email", "customer_email", "client_email"]),
      phone: findFirstNestedString(row, ["phone", "phone_number", "cell_phone", "cell_phone_number", "mobile"]),
      name: stringValue(row.customer_name) ?? fullNameFromFields(row),
      address: findFirstNestedString(row, ["service_address", "address", "home_address", "street_address"]),
      externalSweepGoId: stringValue(row.client_identifier) ?? findFirstNestedString(row, ["client", "client_id", "customer_id"])
    }));
  }

  private async recurringCustomerCandidates(parsed: ParsedSweepAndGoNewClientEmail): Promise<NewClientSourceMatchCandidate[]> {
    const result = await this.pool.query(
      `SELECT
          c.id::text AS id,
          c.first_recurring_date::text AS business_date,
          c.external_sweepgo_id,
          c.source,
          c.source_raw,
          c.metadata,
          ct.primary_email,
          ct.primary_phone,
          ct.full_name,
          ct.first_name,
          ct.last_name,
          ct.service_address
       FROM customers c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.first_recurring_date BETWEEN ($1::date - INTERVAL '1 day') AND ($1::date + INTERVAL '1 day')`,
      [parsed.phoenixBusinessDate]
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      entityType: "recurring_customer",
      businessDate: String(row.business_date),
      email: stringValue(row.primary_email),
      phone: stringValue(row.primary_phone),
      name: stringValue(row.full_name) ?? [stringValue(row.first_name), stringValue(row.last_name)].filter(Boolean).join(" "),
      address: stringValue(row.service_address),
      externalSweepGoId: stringValue(row.external_sweepgo_id),
      hasExistingSourceEvidence: Boolean(row.source_raw) || stringValue(row.source) !== "unknown"
    }));
  }

  private async upsertEmailEvidence(
    parsed: ParsedSweepAndGoNewClientEmail,
    input: {
      matchStatus: "matched" | "needs_review" | "unmatched";
      matchedEntityType?: string;
      onboardingIntakeId?: string;
      customerId?: string;
      matchMethod?: string;
      reviewReason?: string;
      evidence: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO sweepandgo_new_client_email_sources (
          gmail_message_id,
          message_fingerprint,
          email_received_at,
          phoenix_business_date,
          clean_up_frequency,
          how_heard_about_us,
          how_heard_about_us_details,
          source_bucket,
          source_confidence,
          match_status,
          matched_entity_type,
          onboarding_intake_id,
          customer_id,
          match_method,
          review_reason,
          metadata
       )
       VALUES ($1, $2, $3::timestamptz, $4::date, $5, $6, $7, $8, 'owner_email_evidence', $9, $10, $11::bigint, $12::uuid, $13, $14, $15::jsonb)
       ON CONFLICT (gmail_message_id)
       DO UPDATE SET match_status = EXCLUDED.match_status,
                     matched_entity_type = EXCLUDED.matched_entity_type,
                     onboarding_intake_id = EXCLUDED.onboarding_intake_id,
                     customer_id = EXCLUDED.customer_id,
                     match_method = EXCLUDED.match_method,
                     review_reason = EXCLUDED.review_reason,
                     metadata = sweepandgo_new_client_email_sources.metadata || EXCLUDED.metadata,
                     updated_at = NOW()`,
      [
        parsed.messageId,
        parsed.messageFingerprint,
        parsed.emailReceivedAt,
        parsed.phoenixBusinessDate,
        parsed.cleanUpFrequency ?? null,
        parsed.howHeardAboutUs ?? null,
        parsed.howHeardAboutUsDetails ?? null,
        parsed.sourceBucket,
        input.matchStatus,
        input.matchedEntityType ?? null,
        input.onboardingIntakeId ?? null,
        input.customerId ?? null,
        input.matchMethod ?? null,
        input.reviewReason ?? null,
        JSON.stringify(input.evidence)
      ]
    );
  }

  private async upsertCustomerSource(
    customerId: string,
    parsed: ParsedSweepAndGoNewClientEmail,
    evidence: Record<string, unknown>
  ): Promise<void> {
    const sourceRaw = parsed.howHeardAboutUsDetails
      ? `${parsed.howHeardAboutUs} / ${parsed.howHeardAboutUsDetails}`
      : parsed.howHeardAboutUs;
    await this.pool.query(
      `INSERT INTO customer_sources (
          customer_id,
          source,
          source_raw,
          source_provider,
          confidence,
          evidence
       )
       VALUES ($1, $2, $3, 'sweepandgo_new_client_email', 0.95, $4::jsonb)
       ON CONFLICT (customer_id, source_provider, source_raw)
       DO UPDATE SET source = EXCLUDED.source,
                     confidence = EXCLUDED.confidence,
                     evidence = EXCLUDED.evidence,
                     updated_at = NOW()`,
      [
        customerId,
        normalizeCustomerSource(sourceRaw),
        sourceRaw ?? null,
        JSON.stringify(evidence)
      ]
    );
  }
}

function fullNameFromFields(row: Record<string, unknown>): string | undefined {
  const first = findFirstNestedString(row, ["first_name", "firstName"]);
  const last = findFirstNestedString(row, ["last_name", "lastName"]);
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || undefined;
}

function findFirstNestedString(value: unknown, keys: string[]): string | undefined {
  const normalizedKeys = new Set(keys.map(normalizeSearchKey));
  const found = findFirstNestedValue(value, normalizedKeys);
  return stringValue(found);
}

function findFirstNestedValue(value: unknown, keys: Set<string>): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstNestedValue(item, keys);
      if (found !== undefined && found !== null && found !== "") {
        return found;
      }
    }
    return undefined;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(normalizeSearchKey(key)) && nested !== undefined && nested !== null && nested !== "") {
      const record = asRecord(nested);
      if (record && "value" in record) {
        return record.value;
      }
      return nested;
    }
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    const found = findFirstNestedValue(nested, keys);
    if (found !== undefined && found !== null && found !== "") {
      return found;
    }
  }
  return undefined;
}

function normalizeSearchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
