CREATE TABLE IF NOT EXISTS sweepandgo_active_roster_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  source TEXT NOT NULL,
  active_client_count INTEGER NOT NULL,
  active_api_client_count INTEGER,
  active_no_subscription_count INTEGER,
  derived_active_with_subscription_count INTEGER,
  derived_active_recurring_count INTEGER,
  source_report_count INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sweepandgo_active_roster_snapshots_source_check
    CHECK (source IN ('sweepandgo_count_active_clients')),
  CONSTRAINT sweepandgo_active_roster_snapshots_counts_check
    CHECK (
      active_client_count >= 0
      AND COALESCE(active_api_client_count, 0) >= 0
      AND COALESCE(active_no_subscription_count, 0) >= 0
      AND COALESCE(derived_active_with_subscription_count, 0) >= 0
      AND COALESCE(derived_active_recurring_count, 0) >= 0
      AND COALESCE(source_report_count, 0) >= 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sweepandgo_active_roster_snapshot_date_source
  ON sweepandgo_active_roster_snapshots (snapshot_date, source);

CREATE INDEX IF NOT EXISTS idx_sweepandgo_active_roster_snapshots_latest
  ON sweepandgo_active_roster_snapshots (snapshot_date DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version)
VALUES ('009_create_sweepandgo_active_roster_snapshots')
ON CONFLICT (version) DO NOTHING;
