CREATE TABLE IF NOT EXISTS lead_customer_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bi_lead_opportunity_id UUID REFERENCES opportunities(id),
  ghl_lead_opportunity_id TEXT NOT NULL,
  ghl_active_opportunity_id TEXT NOT NULL,
  ghl_contact_id TEXT,
  sweepgo_customer_id UUID REFERENCES customers(id),
  lead_source TEXT NOT NULL,
  lead_date DATE NOT NULL,
  conversion_date TIMESTAMPTZ,
  match_method TEXT NOT NULL,
  confidence NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
  status TEXT NOT NULL DEFAULT 'matched',
  review_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_customer_matches_source_check
    CHECK (lead_source IN ('facebook', 'website', 'other', 'unknown')),
  CONSTRAINT lead_customer_matches_method_check
    CHECK (match_method IN ('contact_id', 'same_opportunity_id', 'email', 'phone')),
  CONSTRAINT lead_customer_matches_status_check
    CHECK (status IN ('matched', 'review', 'ignored')),
  CONSTRAINT lead_customer_matches_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_lead_customer_matches_pair
  ON lead_customer_matches (ghl_lead_opportunity_id, ghl_active_opportunity_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_lead_customer_matches_matched_lead
  ON lead_customer_matches (ghl_lead_opportunity_id)
  WHERE status = 'matched';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_lead_customer_matches_matched_active
  ON lead_customer_matches (ghl_active_opportunity_id)
  WHERE status = 'matched';

CREATE INDEX IF NOT EXISTS idx_lead_customer_matches_source_date
  ON lead_customer_matches (lead_source, lead_date);

CREATE INDEX IF NOT EXISTS idx_lead_customer_matches_status
  ON lead_customer_matches (status, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version)
VALUES ('007_create_lead_customer_matches')
ON CONFLICT (version) DO NOTHING;
