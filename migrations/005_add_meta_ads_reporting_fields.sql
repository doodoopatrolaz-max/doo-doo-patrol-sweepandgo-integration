ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS account_timezone TEXT;

ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS objective TEXT,
  ADD COLUMN IF NOT EXISTS buying_type TEXT,
  ADD COLUMN IF NOT EXISTS effective_status TEXT;

ALTER TABLE daily_ad_performance
  ADD COLUMN IF NOT EXISTS platform TEXT,
  ADD COLUMN IF NOT EXISTS external_account_id TEXT,
  ADD COLUMN IF NOT EXISTS external_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS external_adset_id TEXT,
  ADD COLUMN IF NOT EXISTS adset_name TEXT,
  ADD COLUMN IF NOT EXISTS external_ad_id TEXT,
  ADD COLUMN IF NOT EXISTS ad_name TEXT,
  ADD COLUMN IF NOT EXISTS account_timezone TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS reach INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frequency NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS link_clicks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS landing_page_views INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_lead NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS ctr NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS cpc NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS cpm NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS objective TEXT,
  ADD COLUMN IF NOT EXISTS optimization_goal TEXT,
  ADD COLUMN IF NOT EXISTS buying_type TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS effective_status TEXT;

UPDATE daily_ad_performance
SET platform = COALESCE(platform, provider),
    external_account_id = COALESCE(external_account_id, ''),
    external_campaign_id = COALESCE(external_campaign_id, ''),
    external_adset_id = COALESCE(external_adset_id, ''),
    external_ad_id = COALESCE(external_ad_id, '')
WHERE platform IS NULL
   OR external_account_id IS NULL
   OR external_campaign_id IS NULL
   OR external_adset_id IS NULL
   OR external_ad_id IS NULL;

ALTER TABLE daily_ad_performance
  ALTER COLUMN platform SET DEFAULT 'meta',
  ALTER COLUMN external_account_id SET DEFAULT '',
  ALTER COLUMN external_campaign_id SET DEFAULT '',
  ALTER COLUMN external_adset_id SET DEFAULT '',
  ALTER COLUMN external_ad_id SET DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_daily_ad_performance_platform_external_keys
  ON daily_ad_performance (
    platform,
    report_date,
    external_account_id,
    external_campaign_id,
    external_adset_id,
    external_ad_id
  );

CREATE INDEX IF NOT EXISTS idx_daily_ad_performance_platform_date
  ON daily_ad_performance (platform, report_date);
