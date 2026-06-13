import type {
  CreateOnboardingIntakeInput,
  OnboardingIntake,
  OnboardingIntakeStatus,
  OnboardingIntakeStore
} from "./store.ts";

function mapRow(row: Record<string, unknown>): OnboardingIntake {
  return {
    id: String(row.id),
    webhookEventId: String(row.webhook_event_id),
    eventType: String(row.event_type),
    triggerEventFingerprint: String(row.trigger_event_fingerprint),
    customerEmail: row.customer_email ? String(row.customer_email) : undefined,
    customerName: row.customer_name ? String(row.customer_name) : undefined,
    clientIdentifier: row.client_identifier ? String(row.client_identifier) : undefined,
    serviceType: row.service_type ? String(row.service_type) : undefined,
    status: row.status as OnboardingIntakeStatus,
    sourcesChecked: Array.isArray(row.sources_checked) ? row.sources_checked.map(String) : [],
    verifiedDetails: row.verified_details as Record<string, unknown>,
    missingDetails: Array.isArray(row.missing_details) ? row.missing_details.map(String) : [],
    calculationNotes: Array.isArray(row.calculation_notes) ? row.calculation_notes.map(String) : [],
    payload: row.payload,
    sweepandgoDetails: row.sweepandgo_details ?? undefined,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString()
  };
}

export class PostgresOnboardingIntakeStore implements OnboardingIntakeStore {
  private readonly pool: any;

  constructor(pool: any) {
    this.pool = pool;
  }

  async createIntake(input: CreateOnboardingIntakeInput): Promise<OnboardingIntake> {
    const result = await this.pool.query(
      `INSERT INTO onboarding_intakes (
        webhook_event_id,
        event_type,
        trigger_event_fingerprint,
        customer_email,
        customer_name,
        client_identifier,
        service_type,
        status,
        sources_checked,
        verified_details,
        missing_details,
        calculation_notes,
        payload,
        sweepandgo_details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb)
      RETURNING *`,
      [
        input.webhookEventId,
        input.eventType,
        input.triggerEventFingerprint,
        input.customerEmail ?? null,
        input.customerName ?? null,
        input.clientIdentifier ?? null,
        input.serviceType ?? null,
        input.status,
        JSON.stringify(input.sourcesChecked),
        JSON.stringify(input.verifiedDetails),
        JSON.stringify(input.missingDetails),
        JSON.stringify(input.calculationNotes),
        JSON.stringify(input.payload),
        input.sweepandgoDetails === undefined ? null : JSON.stringify(input.sweepandgoDetails)
      ]
    );

    return mapRow(result.rows[0]);
  }

  async listIntakes(limit: number, offset: number): Promise<OnboardingIntake[]> {
    const result = await this.pool.query(
      `SELECT *
       FROM onboarding_intakes
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows.map(mapRow);
  }

  async getIntake(id: string): Promise<OnboardingIntake | undefined> {
    const result = await this.pool.query("SELECT * FROM onboarding_intakes WHERE id = $1", [id]);
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }
}
