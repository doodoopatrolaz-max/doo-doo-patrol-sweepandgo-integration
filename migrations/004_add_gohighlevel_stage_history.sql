ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS pipeline_id TEXT,
  ADD COLUMN IF NOT EXISTS stage_id TEXT,
  ADD COLUMN IF NOT EXISTS original_lead_source TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS original_lead_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_stage_entered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_stage_id TEXT,
  ADD COLUMN IF NOT EXISTS previous_stage_name TEXT,
  ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_to_external_id TEXT,
  ADD COLUMN IF NOT EXISTS contact_external_id TEXT;

CREATE INDEX IF NOT EXISTS idx_opportunities_pipeline_stage_ids
  ON opportunities (pipeline_id, stage_id);

CREATE INDEX IF NOT EXISTS idx_opportunities_original_lead_date
  ON opportunities (original_lead_source, original_lead_date);

CREATE TABLE IF NOT EXISTS opportunity_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'gohighlevel',
  external_opportunity_id TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id),
  contact_external_id TEXT,
  pipeline_id TEXT NOT NULL,
  pipeline_name TEXT,
  stage_id TEXT NOT NULL,
  stage_name TEXT,
  previous_stage_id TEXT,
  previous_stage_name TEXT,
  entered_at TIMESTAMPTZ NOT NULL,
  exited_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'unknown',
  source_raw TEXT,
  external_event_id TEXT,
  event_fingerprint TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_opportunity_id, stage_id, entered_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_stage_history_event_fingerprint
  ON opportunity_stage_history (event_fingerprint)
  WHERE event_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opportunity_stage_history_entered_at
  ON opportunity_stage_history (source, entered_at);
