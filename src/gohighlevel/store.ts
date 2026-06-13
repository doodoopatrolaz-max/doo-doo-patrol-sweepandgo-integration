import type { GoHighLevelOpportunityMapping } from "./mapper.ts";
import type { NormalizedCustomerSource } from "../reporting/sourceNormalization.ts";

export type PreparedOpportunityUpsert = {
  provider: "gohighlevel";
  externalOpportunityId?: string;
  externalContactId?: string;
  pipelineId?: string;
  pipelineName: string;
  stageId?: string;
  stageName: string;
  status?: string;
  originalLeadSource: string;
  originalLeadDate?: string;
  metadata: Record<string, unknown>;
};

export function prepareOpportunityUpsert(input: GoHighLevelOpportunityMapping): PreparedOpportunityUpsert | undefined {
  if (!input.externalOpportunityId) {
    return undefined;
  }

  return {
    provider: "gohighlevel",
    externalOpportunityId: input.externalOpportunityId,
    externalContactId: input.externalContactId,
    pipelineId: input.pipelineId,
    pipelineName: input.pipelineName ?? "unknown",
    stageId: input.stageId,
    stageName: input.stageName ?? "unknown",
    status: input.status,
    originalLeadSource: input.originalLeadSource,
    originalLeadDate: input.originalLeadDate,
    metadata: {
      sourceRaw: input.sourceRaw,
      assignedTo: input.assignedTo,
      historicalStageSource: input.historicalStageSource,
      currentStage: input.currentStage,
      reconciliationIssue: input.reconciliationIssue
    }
  };
}

export type ExistingOpportunityRecord = {
  id: string;
  contactId?: string;
  externalOpportunityId: string;
  pipelineId?: string;
  stageId?: string;
  stageName: string;
  status?: string;
  originalLeadSource: NormalizedCustomerSource;
  originalLeadDate?: string;
  currentStageEnteredAt?: string;
  metadata: Record<string, unknown>;
};

export type GoHighLevelWebhookOpportunityInput = {
  externalOpportunityId: string;
  externalContactId?: string;
  locationId?: string;
  pipelineId?: string;
  pipelineName: string;
  stageId?: string;
  stageName: string;
  previousStageId?: string;
  previousStageName?: string;
  status?: string;
  assignedTo?: string;
  sourceRaw?: string;
  originalLeadSource?: NormalizedCustomerSource;
  originalLeadDate?: string;
  currentStageEnteredAt?: string;
  wonAt?: string;
  lostAt?: string;
  abandonedAt?: string;
  metadata: Record<string, unknown>;
};

export type GoHighLevelStageHistoryInput = {
  externalOpportunityId: string;
  contactId?: string;
  contactExternalId?: string;
  pipelineId: string;
  pipelineName?: string;
  stageId: string;
  stageName: string;
  previousStageId?: string;
  previousStageName?: string;
  enteredAt: string;
  source: NormalizedCustomerSource;
  sourceRaw?: string;
  externalEventId?: string;
  eventFingerprint?: string;
  metadata: Record<string, unknown>;
};

export type ReconciliationIssueInput = {
  issueType: string;
  severity?: "info" | "needs_review" | "warning" | "critical";
  summary: string;
  details: Record<string, unknown>;
};

export interface GoHighLevelWebhookStore {
  upsertContactByExternalId(externalContactId: string, metadata?: Record<string, unknown>): Promise<string>;
  findOpportunity(externalOpportunityId: string): Promise<ExistingOpportunityRecord | undefined>;
  upsertOpportunity(input: GoHighLevelWebhookOpportunityInput): Promise<ExistingOpportunityRecord>;
  insertStageHistory(input: GoHighLevelStageHistoryInput): Promise<boolean>;
  createReconciliationIssue(input: ReconciliationIssueInput): Promise<void>;
}

export class PostgresGoHighLevelWebhookStore implements GoHighLevelWebhookStore {
  private readonly pool: any;

  constructor(pool: any) {
    this.pool = pool;
  }

  async upsertContactByExternalId(
    externalContactId: string,
    metadata: Record<string, unknown> = {}
  ): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO contacts (external_ghl_id, metadata)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (external_ghl_id) DO UPDATE
       SET metadata = contacts.metadata || EXCLUDED.metadata,
           updated_at = NOW()
       RETURNING id`,
      [externalContactId, JSON.stringify(metadata)]
    );

    return String(result.rows[0].id);
  }

  async findOpportunity(externalOpportunityId: string): Promise<ExistingOpportunityRecord | undefined> {
    const result = await this.pool.query(
      `SELECT *
       FROM opportunities
       WHERE provider = 'gohighlevel'
         AND external_opportunity_id = $1
       LIMIT 1`,
      [externalOpportunityId]
    );

    return result.rows[0] ? mapOpportunityRow(result.rows[0]) : undefined;
  }

  async upsertOpportunity(input: GoHighLevelWebhookOpportunityInput): Promise<ExistingOpportunityRecord> {
    const contactId = input.externalContactId
      ? await this.upsertContactByExternalId(input.externalContactId, {
          provider: "gohighlevel",
          locationId: input.locationId
        })
      : undefined;

    const result = await this.pool.query(
      `INSERT INTO opportunities (
        contact_id,
        provider,
        external_opportunity_id,
        pipeline_name,
        stage_name,
        status,
        source,
        metadata,
        pipeline_id,
        stage_id,
        original_lead_source,
        original_lead_date,
        current_stage_entered_at,
        previous_stage_id,
        previous_stage_name,
        won_at,
        lost_at,
        abandoned_at,
        assigned_to_external_id,
        contact_external_id
      )
      VALUES (
        $1,
        'gohighlevel',
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb,
        $8,
        $9,
        $10,
        $11::timestamptz,
        $12::timestamptz,
        $13,
        $14,
        $15::timestamptz,
        $16::timestamptz,
        $17::timestamptz,
        $18,
        $19
      )
      ON CONFLICT (provider, external_opportunity_id) DO UPDATE
      SET contact_id = COALESCE(EXCLUDED.contact_id, opportunities.contact_id),
          pipeline_name = EXCLUDED.pipeline_name,
          stage_name = CASE
            WHEN opportunities.current_stage_entered_at IS NULL THEN EXCLUDED.stage_name
            WHEN EXCLUDED.current_stage_entered_at IS NULL THEN opportunities.stage_name
            WHEN EXCLUDED.current_stage_entered_at >= opportunities.current_stage_entered_at THEN EXCLUDED.stage_name
            ELSE opportunities.stage_name
          END,
          status = COALESCE(EXCLUDED.status, opportunities.status),
          source = COALESCE(NULLIF(EXCLUDED.source, 'unknown'), opportunities.source),
          metadata = opportunities.metadata || EXCLUDED.metadata,
          pipeline_id = COALESCE(EXCLUDED.pipeline_id, opportunities.pipeline_id),
          stage_id = CASE
            WHEN opportunities.current_stage_entered_at IS NULL THEN COALESCE(EXCLUDED.stage_id, opportunities.stage_id)
            WHEN EXCLUDED.current_stage_entered_at IS NULL THEN opportunities.stage_id
            WHEN EXCLUDED.current_stage_entered_at >= opportunities.current_stage_entered_at THEN COALESCE(EXCLUDED.stage_id, opportunities.stage_id)
            ELSE opportunities.stage_id
          END,
          original_lead_source = CASE
            WHEN opportunities.original_lead_source = 'unknown'
              AND EXCLUDED.original_lead_source <> 'unknown'
              THEN EXCLUDED.original_lead_source
            ELSE opportunities.original_lead_source
          END,
          original_lead_date = CASE
            WHEN opportunities.original_lead_date IS NULL
              AND EXCLUDED.original_lead_source <> 'unknown'
              THEN EXCLUDED.original_lead_date
            ELSE opportunities.original_lead_date
          END,
          current_stage_entered_at = CASE
            WHEN opportunities.current_stage_entered_at IS NULL THEN EXCLUDED.current_stage_entered_at
            WHEN EXCLUDED.current_stage_entered_at IS NULL THEN opportunities.current_stage_entered_at
            WHEN EXCLUDED.current_stage_entered_at >= opportunities.current_stage_entered_at THEN EXCLUDED.current_stage_entered_at
            ELSE opportunities.current_stage_entered_at
          END,
          previous_stage_id = COALESCE(EXCLUDED.previous_stage_id, opportunities.previous_stage_id),
          previous_stage_name = COALESCE(EXCLUDED.previous_stage_name, opportunities.previous_stage_name),
          won_at = COALESCE(opportunities.won_at, EXCLUDED.won_at),
          lost_at = COALESCE(opportunities.lost_at, EXCLUDED.lost_at),
          abandoned_at = COALESCE(opportunities.abandoned_at, EXCLUDED.abandoned_at),
          assigned_to_external_id = COALESCE(EXCLUDED.assigned_to_external_id, opportunities.assigned_to_external_id),
          contact_external_id = COALESCE(EXCLUDED.contact_external_id, opportunities.contact_external_id),
          updated_at = NOW()
      RETURNING *`,
      [
        contactId ?? null,
        input.externalOpportunityId,
        input.pipelineName,
        input.stageName,
        input.status ?? null,
        input.originalLeadSource ?? "unknown",
        JSON.stringify(input.metadata),
        input.pipelineId ?? null,
        input.stageId ?? null,
        input.originalLeadSource ?? "unknown",
        input.originalLeadDate ?? null,
        input.currentStageEnteredAt ?? null,
        input.previousStageId ?? null,
        input.previousStageName ?? null,
        input.wonAt ?? null,
        input.lostAt ?? null,
        input.abandonedAt ?? null,
        input.assignedTo ?? null,
        input.externalContactId ?? null
      ]
    );

    return mapOpportunityRow(result.rows[0]);
  }

  async insertStageHistory(input: GoHighLevelStageHistoryInput): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO opportunity_stage_history (
        provider,
        external_opportunity_id,
        contact_id,
        contact_external_id,
        pipeline_id,
        pipeline_name,
        stage_id,
        stage_name,
        previous_stage_id,
        previous_stage_name,
        entered_at,
        source,
        source_raw,
        external_event_id,
        event_fingerprint,
        metadata
      )
      VALUES (
        'gohighlevel',
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10::timestamptz,
        $11,
        $12,
        $13,
        $14,
        $15::jsonb
      )
      ON CONFLICT DO NOTHING
      RETURNING id`,
      [
        input.externalOpportunityId,
        input.contactId ?? null,
        input.contactExternalId ?? null,
        input.pipelineId,
        input.pipelineName ?? null,
        input.stageId,
        input.stageName,
        input.previousStageId ?? null,
        input.previousStageName ?? null,
        input.enteredAt,
        input.source,
        input.sourceRaw ?? null,
        input.externalEventId ?? null,
        input.eventFingerprint ?? null,
        JSON.stringify(input.metadata)
      ]
    );

    return Boolean(result.rows[0]);
  }

  async createReconciliationIssue(input: ReconciliationIssueInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO reconciliation_issues (issue_type, severity, summary, details)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        input.issueType,
        input.severity ?? "needs_review",
        input.summary,
        JSON.stringify(input.details)
      ]
    );
  }
}

function mapOpportunityRow(row: Record<string, unknown>): ExistingOpportunityRecord {
  return {
    id: String(row.id),
    contactId: row.contact_id ? String(row.contact_id) : undefined,
    externalOpportunityId: String(row.external_opportunity_id),
    pipelineId: row.pipeline_id ? String(row.pipeline_id) : undefined,
    stageId: row.stage_id ? String(row.stage_id) : undefined,
    stageName: String(row.stage_name),
    status: row.status ? String(row.status) : undefined,
    originalLeadSource: normalizeStoredSource(row.original_lead_source),
    originalLeadDate: row.original_lead_date
      ? new Date(row.original_lead_date as string | Date).toISOString()
      : undefined,
    currentStageEnteredAt: row.current_stage_entered_at
      ? new Date(row.current_stage_entered_at as string | Date).toISOString()
      : undefined,
    metadata: isRecord(row.metadata) ? row.metadata : {}
  };
}

function normalizeStoredSource(value: unknown): NormalizedCustomerSource {
  return value === "facebook" || value === "website" || value === "other" || value === "unknown"
    ? value
    : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
