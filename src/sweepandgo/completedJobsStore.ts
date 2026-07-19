import type { SweepAndGoCompletedJobFact } from "./completedJobsMapper.ts";

export type CompletedJobUpsertResult = {
  inserted: boolean;
  updated: boolean;
};

export type CompletedJobsSyncRunRecord = {
  id: string;
};

export class SweepAndGoCompletedJobsStore {
  private readonly pool: any;

  constructor(pool: any) {
    this.pool = pool;
  }

  async startSyncRun(): Promise<CompletedJobsSyncRunRecord> {
    const result = await this.pool.query(
      `INSERT INTO sync_runs (provider, sync_type, status, started_at)
       VALUES ('sweepandgo', 'sweepandgo_completed_jobs', 'started', NOW())
       RETURNING id`
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

  async upsertCompletedJob(fact: SweepAndGoCompletedJobFact): Promise<CompletedJobUpsertResult> {
    const result = await this.pool.query(
      `WITH upserted AS (
         INSERT INTO sweepandgo_completed_jobs (
           external_job_id,
           job_fingerprint,
           service_date,
           technician_key,
           technician_name,
           job_status,
           job_type,
           service_category,
           allocated_service_price,
           recorded_duration_minutes,
           stop_fingerprint,
           is_scoop,
           is_spray,
           is_initial,
           is_one_time,
           is_recurring,
           source
         )
         VALUES (
           $1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16, $17
         )
         ON CONFLICT (provider, job_fingerprint)
         DO UPDATE SET external_job_id = EXCLUDED.external_job_id,
                       service_date = EXCLUDED.service_date,
                       technician_key = EXCLUDED.technician_key,
                       technician_name = EXCLUDED.technician_name,
                       job_status = EXCLUDED.job_status,
                       job_type = EXCLUDED.job_type,
                       service_category = EXCLUDED.service_category,
                       allocated_service_price = EXCLUDED.allocated_service_price,
                       recorded_duration_minutes = EXCLUDED.recorded_duration_minutes,
                       stop_fingerprint = EXCLUDED.stop_fingerprint,
                       is_scoop = EXCLUDED.is_scoop,
                       is_spray = EXCLUDED.is_spray,
                       is_initial = EXCLUDED.is_initial,
                       is_one_time = EXCLUDED.is_one_time,
                       is_recurring = EXCLUDED.is_recurring,
                       source = EXCLUDED.source,
                       updated_at = NOW()
         RETURNING xmax = 0 AS inserted
       )
       SELECT inserted FROM upserted`,
      [
        fact.externalJobId ?? null,
        fact.jobFingerprint,
        fact.serviceDate,
        fact.technicianKey ?? null,
        fact.technicianName ?? null,
        fact.jobStatus,
        fact.jobType ?? null,
        fact.serviceCategory,
        fact.allocatedServicePrice ?? null,
        fact.recordedDurationMinutes ?? null,
        fact.stopFingerprint,
        fact.isScoop,
        fact.isSpray,
        fact.isInitial,
        fact.isOneTime,
        fact.isRecurring,
        fact.source
      ]
    );
    const inserted = Boolean(result.rows[0]?.inserted);
    return {
      inserted,
      updated: !inserted
    };
  }
}
