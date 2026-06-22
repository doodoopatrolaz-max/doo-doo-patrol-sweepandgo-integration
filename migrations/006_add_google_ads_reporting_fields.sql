ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS advertising_channel_type TEXT;

ALTER TABLE daily_ad_performance
  ADD COLUMN IF NOT EXISTS cost_micros BIGINT,
  ADD COLUMN IF NOT EXISTS conversions_decimal NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS all_conversions NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS conversion_value NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS average_cpc NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS cost_per_conversion NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS phone_calls NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS search_impression_share NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS advertising_channel_type TEXT;

CREATE INDEX IF NOT EXISTS idx_daily_ad_performance_google_ads_date
  ON daily_ad_performance (report_date)
  WHERE platform = 'google_ads';
