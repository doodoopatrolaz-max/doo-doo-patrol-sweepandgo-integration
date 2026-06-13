CREATE TABLE IF NOT EXISTS onboarding_intakes (
  id BIGSERIAL PRIMARY KEY,
  webhook_event_id BIGINT NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  trigger_event_fingerprint TEXT NOT NULL,
  customer_email TEXT,
  customer_name TEXT,
  client_identifier TEXT,
  service_type TEXT,
  status TEXT NOT NULL DEFAULT 'captured',
  sources_checked JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  calculation_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL,
  sweepandgo_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_intakes_created_at
  ON onboarding_intakes (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_onboarding_intakes_status
  ON onboarding_intakes (status);

CREATE INDEX IF NOT EXISTS idx_onboarding_intakes_event_type
  ON onboarding_intakes (event_type);

CREATE INDEX IF NOT EXISTS idx_onboarding_intakes_customer_email
  ON onboarding_intakes (customer_email);
