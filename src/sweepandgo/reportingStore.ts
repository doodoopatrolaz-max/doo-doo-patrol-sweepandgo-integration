import type { SweepAndGoCustomerReportingRecord, SweepAndGoLeadReportingRecord } from "./reportingMapper.ts";

export type SyncRunRecord = {
  id: string;
};

export class SweepAndGoReportingStore {
  private readonly pool: any;

  constructor(pool: any) {
    this.pool = pool;
  }

  async startSyncRun(syncType: string): Promise<SyncRunRecord> {
    const result = await this.pool.query(
      `INSERT INTO sync_runs (provider, sync_type, status, started_at)
       VALUES ('sweepandgo', $1, 'started', NOW())
       RETURNING id`,
      [syncType]
    );
    return { id: String(result.rows[0].id) };
  }

  async completeSyncRun(id: string, input: { recordsRead: number; recordsWritten: number }): Promise<void> {
    await this.pool.query(
      `UPDATE sync_runs
       SET status = 'completed',
           completed_at = NOW(),
           records_read = $2,
           records_written = $3
       WHERE id = $1`,
      [id, input.recordsRead, input.recordsWritten]
    );
  }

  async failSyncRun(id: string, errorMessage: string): Promise<void> {
    await this.pool.query(
      `UPDATE sync_runs
       SET status = 'failed',
           completed_at = NOW(),
           error_message = $2
       WHERE id = $1`,
      [id, errorMessage.slice(0, 1000)]
    );
  }

  async upsertCustomer(record: SweepAndGoCustomerReportingRecord): Promise<void> {
    const contactResult = await this.pool.query(
      `INSERT INTO contacts (external_sweepgo_id, metadata)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (external_sweepgo_id)
       DO UPDATE SET metadata = contacts.metadata || EXCLUDED.metadata,
                     updated_at = NOW()
       RETURNING id`,
      [record.externalCustomerId, JSON.stringify({ lastSweepAndGoSyncAt: new Date().toISOString() })]
    );
    const contactId = contactResult.rows[0].id;

    const customerResult = await this.pool.query(
      `INSERT INTO customers (
        contact_id,
        external_sweepgo_id,
        status,
        source,
        source_raw,
        monthly_recurring_revenue,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (external_sweepgo_id)
      DO UPDATE SET status = EXCLUDED.status,
                    source = EXCLUDED.source,
                    source_raw = EXCLUDED.source_raw,
                    monthly_recurring_revenue = EXCLUDED.monthly_recurring_revenue,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
      RETURNING id`,
      [
        contactId,
        record.externalCustomerId,
        record.status,
        record.source,
        record.sourceRaw ?? null,
        record.monthlyRecurringRevenue ?? null,
        JSON.stringify({
          hasActiveSubscription: record.hasActiveSubscription,
          isPaused: record.isPaused,
          isOneTimeClient: record.isOneTimeClient,
          cleanupFrequency: record.cleanupFrequency,
          subscriptionNames: record.subscriptionNames,
          serviceDays: record.serviceDays,
          sourceEvidenceField: record.sourceEvidenceField,
          currentAccountBalanceUnavailableFromSweepAndGo: record.currentAccountBalance === undefined
        })
      ]
    );

    await this.pool.query(
      `INSERT INTO customer_services (
        customer_id,
        external_service_id,
        cadence,
        service_name,
        frequency,
        price,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (customer_id, external_service_id)
      DO UPDATE SET cadence = EXCLUDED.cadence,
                    service_name = EXCLUDED.service_name,
                    frequency = EXCLUDED.frequency,
                    price = EXCLUDED.price,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()`,
      [
        customerResult.rows[0].id,
        `${record.externalCustomerId}:primary`,
        record.serviceCadence,
        record.subscriptionNames ?? null,
        record.cleanupFrequency ?? null,
        null,
        JSON.stringify({
          source: "sweepandgo_client_list",
          rawServiceDays: record.serviceDays
        })
      ]
    );

    if (record.source !== "unknown" || record.sourceRaw) {
      await this.pool.query(
        `INSERT INTO customer_sources (
          customer_id,
          source,
          source_raw,
          source_provider,
          evidence
        )
        VALUES ($1, $2, $3, 'sweepandgo', $4::jsonb)
        ON CONFLICT (customer_id, source_provider, source_raw)
        DO UPDATE SET source = EXCLUDED.source,
                      evidence = EXCLUDED.evidence,
                      updated_at = NOW()`,
        [
          customerResult.rows[0].id,
          record.source,
          record.sourceRaw ?? null,
          JSON.stringify({ field: record.sourceEvidenceField })
        ]
      );
    }
  }

  async upsertLead(record: SweepAndGoLeadReportingRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO leads (
        provider,
        external_lead_id,
        source,
        source_raw,
        stage_name,
        metadata
      )
      VALUES ('sweepandgo', $1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (provider, external_lead_id)
      DO UPDATE SET source = EXCLUDED.source,
                    source_raw = EXCLUDED.source_raw,
                    stage_name = EXCLUDED.stage_name,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()`,
      [
        record.externalLeadId,
        record.source,
        record.sourceRaw ?? null,
        record.status,
        JSON.stringify({
          type: record.type,
          sourceEvidenceField: record.sourceEvidenceField
        })
      ]
    );
  }
}
