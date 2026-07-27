CREATE TABLE IF NOT EXISTS sweepandgo_new_client_email_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'gmail',
  gmail_message_id TEXT NOT NULL,
  message_fingerprint TEXT NOT NULL,
  email_source TEXT NOT NULL DEFAULT 'sweepandgo_new_client_email',
  email_received_at TIMESTAMPTZ NOT NULL,
  phoenix_business_date DATE NOT NULL,
  clean_up_frequency TEXT,
  how_heard_about_us TEXT,
  how_heard_about_us_details TEXT,
  source_bucket TEXT NOT NULL DEFAULT 'other_unknown',
  source_confidence TEXT NOT NULL DEFAULT 'owner_email_evidence',
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  matched_entity_type TEXT,
  onboarding_intake_id BIGINT REFERENCES onboarding_intakes(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  match_method TEXT,
  review_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gmail_message_id),
  UNIQUE (message_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_sweepandgo_new_client_email_sources_date
  ON sweepandgo_new_client_email_sources (phoenix_business_date DESC);

CREATE INDEX IF NOT EXISTS idx_sweepandgo_new_client_email_sources_match_status
  ON sweepandgo_new_client_email_sources (match_status, phoenix_business_date DESC);

CREATE INDEX IF NOT EXISTS idx_sweepandgo_new_client_email_sources_onboarding
  ON sweepandgo_new_client_email_sources (onboarding_intake_id)
  WHERE onboarding_intake_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sweepandgo_new_client_email_sources_customer
  ON sweepandgo_new_client_email_sources (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version)
VALUES ('011_create_sweepandgo_new_client_email_sources')
ON CONFLICT (version) DO NOTHING;
