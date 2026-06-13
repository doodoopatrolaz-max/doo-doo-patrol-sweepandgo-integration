import type {
  CreateWebhookEventInput,
  CreateWebhookEventResult,
  ProcessingStatus,
  WebhookEvent,
  WebhookEventStore
} from "./store.ts";

function mapRow(row: Record<string, unknown>): WebhookEvent {
  return {
    id: String(row.id),
    sweepandgoEventId: row.sweepandgo_event_id ? String(row.sweepandgo_event_id) : undefined,
    eventType: String(row.event_type),
    receivedAt: new Date(row.received_at as string | Date).toISOString(),
    processingStatus: row.processing_status as ProcessingStatus,
    payload: row.payload,
    errorDetails: row.error_details ?? undefined,
    eventFingerprint: String(row.event_fingerprint)
  };
}

export class PostgresWebhookEventStore implements WebhookEventStore {
  private readonly pool: any;

  constructor(pool: any) {
    this.pool = pool;
  }

  async createEvent(input: CreateWebhookEventInput): Promise<CreateWebhookEventResult> {
    const inserted = await this.pool.query(
      `INSERT INTO webhook_events (
        sweepandgo_event_id,
        event_type,
        payload,
        event_fingerprint
      )
      VALUES ($1, $2, $3::jsonb, $4)
      ON CONFLICT (event_fingerprint) DO NOTHING
      RETURNING *`,
      [
        input.sweepandgoEventId ?? null,
        input.eventType,
        JSON.stringify(input.payload),
        input.eventFingerprint
      ]
    );

    if (inserted.rows[0]) {
      return { event: mapRow(inserted.rows[0]), inserted: true };
    }

    const existing = await this.pool.query(
      "SELECT * FROM webhook_events WHERE event_fingerprint = $1",
      [input.eventFingerprint]
    );

    return { event: mapRow(existing.rows[0]), inserted: false };
  }

  async updateStatus(id: string, status: ProcessingStatus, errorDetails?: unknown): Promise<void> {
    await this.pool.query(
      `UPDATE webhook_events
       SET processing_status = $2,
           error_details = $3::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [id, status, errorDetails === undefined ? null : JSON.stringify(errorDetails)]
    );
  }

  async listEvents(limit: number, offset: number): Promise<WebhookEvent[]> {
    const result = await this.pool.query(
      `SELECT *
       FROM webhook_events
       ORDER BY received_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows.map(mapRow);
  }

  async getEvent(id: string): Promise<WebhookEvent | undefined> {
    const result = await this.pool.query("SELECT * FROM webhook_events WHERE id = $1", [id]);
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }
}
