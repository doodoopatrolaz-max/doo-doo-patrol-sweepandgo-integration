CREATE TABLE IF NOT EXISTS reporting_exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_external_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  applies_to_metric TEXT[] NOT NULL DEFAULT '{}',
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reporting_exclusions_provider_check
    CHECK (provider IN ('gohighlevel', 'sweepandgo', 'meta', 'google_ads')),
  CONSTRAINT reporting_exclusions_entity_type_check
    CHECK (entity_type IN ('opportunity', 'lead', 'customer', 'event')),
  CONSTRAINT reporting_exclusions_metrics_not_empty_check
    CHECK (array_length(applies_to_metric, 1) IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_reporting_exclusions_entity_reason_source
  ON reporting_exclusions (provider, entity_type, entity_external_id, reason, source);

CREATE INDEX IF NOT EXISTS idx_reporting_exclusions_lookup
  ON reporting_exclusions (provider, entity_type, entity_external_id);

CREATE INDEX IF NOT EXISTS idx_reporting_exclusions_metrics
  ON reporting_exclusions USING GIN (applies_to_metric);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version)
VALUES ('008_create_reporting_exclusions')
ON CONFLICT (version) DO NOTHING;
