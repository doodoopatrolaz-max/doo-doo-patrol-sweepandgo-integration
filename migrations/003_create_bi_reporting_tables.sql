CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS integration_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_event_id TEXT,
  event_fingerprint TEXT NOT NULL UNIQUE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_status TEXT NOT NULL DEFAULT 'received',
  payload JSONB NOT NULL,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_events_provider_received_at
  ON integration_events (provider, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_integration_events_processing_status
  ON integration_events (processing_status);

CREATE TABLE IF NOT EXISTS integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  display_name TEXT NOT NULL,
  external_account TEXT,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, display_name)
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_email TEXT,
  primary_phone TEXT,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  service_address TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  external_sweepgo_id TEXT UNIQUE,
  external_ghl_id TEXT UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_primary_email ON contacts (primary_email);
CREATE INDEX IF NOT EXISTS idx_contacts_primary_phone ON contacts (primary_phone);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id),
  provider TEXT NOT NULL,
  external_lead_id TEXT,
  source TEXT NOT NULL DEFAULT 'unknown',
  source_raw TEXT,
  received_at TIMESTAMPTZ,
  pipeline_name TEXT,
  stage_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_lead_id)
);

CREATE INDEX IF NOT EXISTS idx_leads_source_received_at ON leads (source, received_at DESC);

CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id),
  provider TEXT NOT NULL DEFAULT 'gohighlevel',
  external_opportunity_id TEXT,
  pipeline_name TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  status TEXT,
  source TEXT NOT NULL DEFAULT 'unknown',
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunities_pipeline_stage ON opportunities (pipeline_name, stage_name);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id),
  external_sweepgo_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'unknown',
  source TEXT NOT NULL DEFAULT 'unknown',
  source_raw TEXT,
  first_recurring_date DATE,
  cancellation_date DATE,
  monthly_recurring_revenue NUMERIC(12, 2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_status ON customers (status);
CREATE INDEX IF NOT EXISTS idx_customers_source ON customers (source);

CREATE TABLE IF NOT EXISTS customer_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  external_service_id TEXT,
  cadence TEXT NOT NULL DEFAULT 'unknown',
  service_name TEXT,
  frequency TEXT,
  price NUMERIC(12, 2),
  started_on DATE,
  ended_on DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, external_service_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_services_cadence ON customer_services (cadence);

CREATE TABLE IF NOT EXISTS customer_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  source TEXT NOT NULL DEFAULT 'unknown',
  source_raw TEXT,
  source_provider TEXT NOT NULL,
  confidence NUMERIC(5, 2),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, source_provider, source_raw)
);

CREATE INDEX IF NOT EXISTS idx_customer_sources_source ON customer_sources (source);

CREATE TABLE IF NOT EXISTS ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  name TEXT,
  currency TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_account_id)
);

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id UUID NOT NULL REFERENCES ad_accounts(id),
  provider TEXT NOT NULL,
  external_campaign_id TEXT NOT NULL,
  name TEXT,
  status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_campaign_id)
);

CREATE TABLE IF NOT EXISTS daily_ad_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id UUID NOT NULL REFERENCES ad_accounts(id),
  ad_campaign_id UUID REFERENCES ad_campaigns(id),
  provider TEXT NOT NULL,
  report_date DATE NOT NULL,
  spend_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  raw_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, ad_account_id, ad_campaign_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_ad_performance_report_date
  ON daily_ad_performance (report_date);

CREATE TABLE IF NOT EXISTS cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  external_sweepgo_id TEXT,
  cancelled_on DATE NOT NULL,
  reason TEXT,
  reason_normalized TEXT,
  source_provider TEXT NOT NULL DEFAULT 'sweepandgo',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cancellations_cancelled_on ON cancellations (cancelled_on);

CREATE TABLE IF NOT EXISTS daily_business_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL UNIQUE,
  facebook_ad_spend NUMERIC(12, 2) NOT NULL DEFAULT 0,
  google_ad_spend NUMERIC(12, 2) NOT NULL DEFAULT 0,
  facebook_leads INTEGER NOT NULL DEFAULT 0,
  website_quote_leads INTEGER NOT NULL DEFAULT 0,
  other_leads INTEGER NOT NULL DEFAULT 0,
  new_recurring_customers INTEGER NOT NULL DEFAULT 0,
  new_recurring_facebook INTEGER NOT NULL DEFAULT 0,
  new_recurring_website INTEGER NOT NULL DEFAULT 0,
  new_recurring_other INTEGER NOT NULL DEFAULT 0,
  new_recurring_unknown INTEGER NOT NULL DEFAULT 0,
  one_time_cleanups INTEGER NOT NULL DEFAULT 0,
  cancellations INTEGER NOT NULL DEFAULT 0,
  current_recurring_customers INTEGER NOT NULL DEFAULT 0,
  monthly_recurring_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
  revenue_added NUMERIC(12, 2) NOT NULL DEFAULT 0,
  net_recurring_customer_growth INTEGER NOT NULL DEFAULT 0,
  source_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES integration_connections(id),
  provider TEXT NOT NULL,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  records_read INTEGER NOT NULL DEFAULT 0,
  records_written INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_provider_started_at
  ON sync_runs (provider, started_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  severity TEXT NOT NULL DEFAULT 'needs_review',
  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_issues_status_detected_at
  ON reconciliation_issues (status, detected_at DESC);

CREATE OR REPLACE VIEW unified_webhook_events AS
SELECT
  ('webhook_events:' || id::text) AS compatibility_id,
  'sweepandgo' AS provider,
  event_type,
  sweepandgo_event_id AS external_event_id,
  event_fingerprint,
  received_at,
  processing_status,
  payload,
  error_details::text AS error_message,
  updated_at AS processed_at,
  created_at,
  updated_at
FROM webhook_events
UNION ALL
SELECT
  ('integration_events:' || id::text) AS compatibility_id,
  provider,
  event_type,
  external_event_id,
  event_fingerprint,
  received_at,
  processing_status,
  payload,
  error_message,
  processed_at,
  created_at,
  updated_at
FROM integration_events;
