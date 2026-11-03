-- Reviewed evidence ledger. No automatic historical backfill or production seed.
-- One reviewed customer lifecycle episode, never one row per subscription/webhook.
CREATE TABLE IF NOT EXISTS verified_recurring_returns (
  customer_id UUID NOT NULL REFERENCES customers(id),
  episode_key TEXT NOT NULL,
  returned_at TIMESTAMPTZ NOT NULL,
  prior_recurring_verified BOOLEAN NOT NULL DEFAULT FALSE,
  recurring_service_verified BOOLEAN NOT NULL DEFAULT FALSE,
  kind TEXT NOT NULL CHECK (kind IN ('return','pause_resume')),
  prior_loss_timing TEXT NOT NULL CHECK (prior_loss_timing IN ('earlier_month','same_month','unknown')),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_reference TEXT NOT NULL CHECK (length(trim(evidence_reference)) > 0),
  verified_at TIMESTAMPTZ,
  PRIMARY KEY (customer_id, episode_key),
  CHECK (NOT verified OR verified_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS verified_recurring_returns_date ON verified_recurring_returns(returned_at);
