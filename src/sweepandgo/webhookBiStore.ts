import type { NormalizedCustomerSource } from "../reporting/sourceNormalization.ts";

export type ExistingSweepAndGoCustomer = {
  id: string;
  externalSweepGoId: string;
  status: string;
  source: NormalizedCustomerSource;
  firstRecurringDate?: string;
};

export type SweepAndGoCustomerUpsertInput = {
  externalCustomerId: string;
  status?: string;
  source: NormalizedCustomerSource;
  sourceRaw?: string;
  firstRecurringDate?: string;
  metadata: Record<string, unknown>;
};

export type SweepAndGoServiceUpsertInput = {
  customerId: string;
  externalServiceId: string;
  cadence: "recurring" | "one_time" | "unknown";
  serviceName?: string;
  frequency?: string;
  startedOn?: string;
  endedOn?: string;
  metadata: Record<string, unknown>;
};

export type SweepAndGoCancellationInput = {
  customerId: string;
  externalSweepGoId: string;
  cancelledOn: string;
  reason?: string;
  metadata: Record<string, unknown>;
};

export type SweepAndGoReconciliationIssueInput = {
  issueType: string;
  severity?: "info" | "needs_review" | "warning" | "critical";
  summary: string;
  details: Record<string, unknown>;
};

export interface SweepAndGoWebhookBiStore {
  findCustomer(externalCustomerId: string): Promise<ExistingSweepAndGoCustomer | undefined>;
  upsertCustomer(input: SweepAndGoCustomerUpsertInput): Promise<ExistingSweepAndGoCustomer>;
  upsertService(input: SweepAndGoServiceUpsertInput): Promise<void>;
  upsertCancellation(input: SweepAndGoCancellationInput): Promise<void>;
  createReconciliationIssue(input: SweepAndGoReconciliationIssueInput): Promise<void>;
}

export class PostgresSweepAndGoWebhookBiStore implements SweepAndGoWebhookBiStore {
  private readonly pool: any;

  constructor(pool: any) {
    this.pool = pool;
  }

  async findCustomer(externalCustomerId: string): Promise<ExistingSweepAndGoCustomer | undefined> {
    const result = await this.pool.query(
      `SELECT id, external_sweepgo_id, status, source, first_recurring_date::text
       FROM customers
       WHERE external_sweepgo_id = $1
       LIMIT 1`,
      [externalCustomerId]
    );

    return result.rows[0] ? mapCustomer(result.rows[0]) : undefined;
  }

  async upsertCustomer(input: SweepAndGoCustomerUpsertInput): Promise<ExistingSweepAndGoCustomer> {
    const contactResult = await this.pool.query(
      `INSERT INTO contacts (external_sweepgo_id, metadata)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (external_sweepgo_id)
       DO UPDATE SET metadata = contacts.metadata || EXCLUDED.metadata,
                     updated_at = NOW()
       RETURNING id`,
      [
        input.externalCustomerId,
        JSON.stringify({
          provider: "sweepandgo",
          lastSweepAndGoWebhookAt: new Date().toISOString()
        })
      ]
    );

    const result = await this.pool.query(
      `INSERT INTO customers (
        contact_id,
        external_sweepgo_id,
        status,
        source,
        source_raw,
        first_recurring_date,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::date, $7::jsonb)
      ON CONFLICT (external_sweepgo_id)
      DO UPDATE SET status = COALESCE(EXCLUDED.status, customers.status),
                    source = CASE
                      WHEN customers.source = 'unknown' AND EXCLUDED.source <> 'unknown' THEN EXCLUDED.source
                      ELSE customers.source
                    END,
                    source_raw = CASE
                      WHEN customers.source_raw IS NULL AND EXCLUDED.source_raw IS NOT NULL THEN EXCLUDED.source_raw
                      ELSE customers.source_raw
                    END,
                    first_recurring_date = COALESCE(customers.first_recurring_date, EXCLUDED.first_recurring_date),
                    metadata = customers.metadata || EXCLUDED.metadata,
                    updated_at = NOW()
      RETURNING id, external_sweepgo_id, status, source, first_recurring_date::text`,
      [
        contactResult.rows[0].id,
        input.externalCustomerId,
        input.status ?? "unknown",
        input.source,
        input.sourceRaw ?? null,
        input.firstRecurringDate ?? null,
        JSON.stringify(input.metadata)
      ]
    );

    const customer = mapCustomer(result.rows[0]);
    if (input.source !== "unknown" || input.sourceRaw) {
      await this.pool.query(
        `INSERT INTO customer_sources (
          customer_id,
          source,
          source_raw,
          source_provider,
          confidence,
          evidence
        )
        VALUES ($1, $2, $3, 'sweepandgo', $4, $5::jsonb)
        ON CONFLICT (customer_id, source_provider, source_raw)
        DO UPDATE SET source = EXCLUDED.source,
                      confidence = EXCLUDED.confidence,
                      evidence = EXCLUDED.evidence,
                      updated_at = NOW()`,
        [
          customer.id,
          input.source,
          input.sourceRaw ?? null,
          input.source === "unknown" ? 0.2 : 0.8,
          JSON.stringify({ source: "sweepandgo_webhook", rawPresent: Boolean(input.sourceRaw) })
        ]
      );
    }

    return customer;
  }

  async upsertService(input: SweepAndGoServiceUpsertInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO customer_services (
        customer_id,
        external_service_id,
        cadence,
        service_name,
        frequency,
        started_on,
        ended_on,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8::jsonb)
      ON CONFLICT (customer_id, external_service_id)
      DO UPDATE SET cadence = EXCLUDED.cadence,
                    service_name = COALESCE(EXCLUDED.service_name, customer_services.service_name),
                    frequency = COALESCE(EXCLUDED.frequency, customer_services.frequency),
                    started_on = COALESCE(customer_services.started_on, EXCLUDED.started_on),
                    ended_on = COALESCE(EXCLUDED.ended_on, customer_services.ended_on),
                    metadata = customer_services.metadata || EXCLUDED.metadata,
                    updated_at = NOW()`,
      [
        input.customerId,
        input.externalServiceId,
        input.cadence,
        input.serviceName ?? null,
        input.frequency ?? null,
        input.startedOn ?? null,
        input.endedOn ?? null,
        JSON.stringify(input.metadata)
      ]
    );
  }

  async upsertCancellation(input: SweepAndGoCancellationInput): Promise<void> {
    const existing = await this.pool.query(
      `SELECT id
       FROM cancellations
       WHERE source_provider = 'sweepandgo'
         AND external_sweepgo_id = $1
       LIMIT 1`,
      [input.externalSweepGoId]
    );

    if (existing.rows[0]) {
      await this.pool.query(
        `UPDATE cancellations
         SET customer_id = COALESCE(customer_id, $2),
             cancelled_on = $3::date,
             reason = COALESCE($4, reason),
             metadata = metadata || $5::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
          existing.rows[0].id,
          input.customerId,
          input.cancelledOn,
          input.reason ?? null,
          JSON.stringify(input.metadata)
        ]
      );
      return;
    }

    await this.pool.query(
      `INSERT INTO cancellations (
        customer_id,
        external_sweepgo_id,
        cancelled_on,
        reason,
        source_provider,
        metadata
      )
      VALUES ($1, $2, $3::date, $4, 'sweepandgo', $5::jsonb)`,
      [
        input.customerId,
        input.externalSweepGoId,
        input.cancelledOn,
        input.reason ?? null,
        JSON.stringify(input.metadata)
      ]
    );
  }

  async createReconciliationIssue(input: SweepAndGoReconciliationIssueInput): Promise<void> {
    const eventFingerprint = typeof input.details.eventFingerprint === "string"
      ? input.details.eventFingerprint
      : undefined;

    if (eventFingerprint) {
      const existing = await this.pool.query(
        `SELECT id
         FROM reconciliation_issues
         WHERE issue_type = $1
           AND details->>'eventFingerprint' = $2
         LIMIT 1`,
        [input.issueType, eventFingerprint]
      );
      if (existing.rows[0]) {
        return;
      }
    }

    await this.pool.query(
      `INSERT INTO reconciliation_issues (
        issue_type,
        status,
        severity,
        summary,
        details
      )
      VALUES ($1, 'open', $2, $3, $4::jsonb)`,
      [
        input.issueType,
        input.severity ?? "needs_review",
        input.summary,
        JSON.stringify(input.details)
      ]
    );
  }
}

function mapCustomer(row: Record<string, unknown>): ExistingSweepAndGoCustomer {
  return {
    id: String(row.id),
    externalSweepGoId: String(row.external_sweepgo_id),
    status: String(row.status),
    source: normalizeStoredSource(row.source),
    firstRecurringDate: typeof row.first_recurring_date === "string" && row.first_recurring_date
      ? row.first_recurring_date
      : undefined
  };
}

function normalizeStoredSource(value: unknown): NormalizedCustomerSource {
  return value === "facebook" || value === "website" || value === "other" ? value : "unknown";
}
