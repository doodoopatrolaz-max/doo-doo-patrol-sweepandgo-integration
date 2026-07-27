CREATE TABLE IF NOT EXISTS sweepandgo_new_client_source_lookup_attempts (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'sweepandgo',
  webhook_event_id UUID REFERENCES webhook_events(id) ON DELETE SET NULL,
  event_fingerprint TEXT NOT NULL,
  event_type TEXT NOT NULL,
  phoenix_business_date DATE NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_retry_after TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_sweepandgo_new_client_source_lookup_attempts_status
  ON sweepandgo_new_client_source_lookup_attempts (status, next_retry_after, phoenix_business_date DESC);

CREATE INDEX IF NOT EXISTS idx_sweepandgo_new_client_source_lookup_attempts_date
  ON sweepandgo_new_client_source_lookup_attempts (phoenix_business_date DESC);

INSERT INTO schema_migrations (version)
VALUES ('012_create_sweepandgo_new_client_source_lookup_attempts')
ON CONFLICT (version) DO NOTHING;
