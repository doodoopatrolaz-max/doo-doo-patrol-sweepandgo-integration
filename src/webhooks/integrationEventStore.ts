export type IntegrationEventProcessingStatus = "received" | "processing" | "processed" | "failed" | "duplicate";

export type IntegrationEventRecord = {
  id: string;
  provider: string;
  eventType: string;
  externalEventId?: string;
  eventFingerprint: string;
  receivedAt: string;
  processingStatus: IntegrationEventProcessingStatus;
  payload: unknown;
  errorMessage?: string;
  processedAt?: string;
};

export type CreateIntegrationEventInput = {
  provider: string;
  eventType: string;
  externalEventId?: string;
  eventFingerprint: string;
  payload: unknown;
};

export type CreateIntegrationEventResult = {
  event: IntegrationEventRecord;
  inserted: boolean;
};

export interface IntegrationEventStore {
  createEvent(input: CreateIntegrationEventInput): Promise<CreateIntegrationEventResult>;
  listEvents?(limit: number, offset: number): Promise<IntegrationEventRecord[]>;
}

export class InMemoryIntegrationEventStore implements IntegrationEventStore {
  private readonly events = new Map<string, IntegrationEventRecord>();
  private nextId = 1;

  async createEvent(input: CreateIntegrationEventInput): Promise<CreateIntegrationEventResult> {
    const existing = [...this.events.values()].find(
      (event) => event.eventFingerprint === input.eventFingerprint
    );

    if (existing) {
      return { event: existing, inserted: false };
    }

    const event: IntegrationEventRecord = {
      id: String(this.nextId++),
      provider: input.provider,
      eventType: input.eventType,
      externalEventId: input.externalEventId,
      eventFingerprint: input.eventFingerprint,
      receivedAt: new Date().toISOString(),
      processingStatus: "received",
      payload: input.payload
    };

    this.events.set(event.id, event);
    return { event, inserted: true };
  }

  async listEvents(limit: number, offset: number): Promise<IntegrationEventRecord[]> {
    return [...this.events.values()]
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
      .slice(offset, offset + limit);
  }
}

function mapIntegrationEventRow(row: Record<string, unknown>): IntegrationEventRecord {
  return {
    id: String(row.id),
    provider: String(row.provider),
    eventType: String(row.event_type),
    externalEventId: row.external_event_id ? String(row.external_event_id) : undefined,
    eventFingerprint: String(row.event_fingerprint),
    receivedAt: new Date(row.received_at as string | Date).toISOString(),
    processingStatus: String(row.processing_status) as IntegrationEventProcessingStatus,
    payload: row.payload,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    processedAt: row.processed_at
      ? new Date(row.processed_at as string | Date).toISOString()
      : undefined
  };
}

export class PostgresIntegrationEventStore implements IntegrationEventStore {
  private readonly pool: any;

  constructor(pool: any) {
    this.pool = pool;
  }

  async createEvent(input: CreateIntegrationEventInput): Promise<CreateIntegrationEventResult> {
    const inserted = await this.pool.query(
      `INSERT INTO integration_events (
        provider,
        event_type,
        external_event_id,
        event_fingerprint,
        payload
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (event_fingerprint) DO NOTHING
      RETURNING *`,
      [
        input.provider,
        input.eventType,
        input.externalEventId ?? null,
        input.eventFingerprint,
        JSON.stringify(input.payload)
      ]
    );

    if (inserted.rows[0]) {
      return { event: mapIntegrationEventRow(inserted.rows[0]), inserted: true };
    }

    const existing = await this.pool.query(
      "SELECT * FROM integration_events WHERE event_fingerprint = $1",
      [input.eventFingerprint]
    );

    return { event: mapIntegrationEventRow(existing.rows[0]), inserted: false };
  }

  async listEvents(limit: number, offset: number): Promise<IntegrationEventRecord[]> {
    const result = await this.pool.query(
      `SELECT *
       FROM integration_events
       ORDER BY received_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows.map(mapIntegrationEventRow);
  }
}
