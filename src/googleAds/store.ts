import type { GoogleAdsDailyPerformanceRecord } from "./mapper.ts";

export type GoogleAdsSyncRun = {
  id: string;
};

export class GoogleAdsReportingStore {
  private readonly pool: any;

  constructor(pool: any) {
    this.pool = pool;
  }

  async startSyncRun(syncType: string, metadata: Record<string, unknown> = {}): Promise<GoogleAdsSyncRun> {
    const result = await this.pool.query(
      `INSERT INTO sync_runs (provider, sync_type, status, started_at, metadata)
       VALUES ('google_ads', $1, 'started', NOW(), $2::jsonb)
       RETURNING id`,
      [syncType, JSON.stringify(metadata)]
    );
    return { id: String(result.rows[0].id) };
  }

  async completeSyncRun(id: string, input: { recordsRead: number; recordsWritten: number }): Promise<void> {
    await this.pool.query(
      `UPDATE sync_runs
       SET status = 'completed',
           completed_at = NOW(),
           records_read = $2,
           records_written = $3
       WHERE id = $1`,
      [id, input.recordsRead, input.recordsWritten]
    );
  }

  async failSyncRun(id: string, errorMessage: string): Promise<void> {
    await this.pool.query(
      `UPDATE sync_runs
       SET status = 'failed',
           completed_at = NOW(),
           error_message = $2
       WHERE id = $1`,
      [id, errorMessage.slice(0, 1000)]
    );
  }

  async upsertDailyPerformance(record: GoogleAdsDailyPerformanceRecord): Promise<void> {
    const accountResult = await this.pool.query(
      `INSERT INTO ad_accounts (
        provider,
        external_account_id,
        name,
        currency,
        account_timezone,
        metadata
      )
      VALUES ('google_ads', $1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (provider, external_account_id)
      DO UPDATE SET name = COALESCE(EXCLUDED.name, ad_accounts.name),
                    currency = COALESCE(EXCLUDED.currency, ad_accounts.currency),
                    account_timezone = COALESCE(EXCLUDED.account_timezone, ad_accounts.account_timezone),
                    metadata = ad_accounts.metadata || EXCLUDED.metadata,
                    updated_at = NOW()
      RETURNING id`,
      [
        record.externalAccountId,
        record.accountName ?? null,
        record.currency ?? null,
        record.accountTimezone ?? null,
        JSON.stringify({ source: "google_ads_api" })
      ]
    );

    const campaignResult = await this.pool.query(
      `INSERT INTO ad_campaigns (
        ad_account_id,
        provider,
        external_campaign_id,
        name,
        status,
        advertising_channel_type,
        metadata
      )
      VALUES ($1, 'google_ads', $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (provider, external_campaign_id)
      DO UPDATE SET ad_account_id = EXCLUDED.ad_account_id,
                    name = COALESCE(EXCLUDED.name, ad_campaigns.name),
                    status = COALESCE(EXCLUDED.status, ad_campaigns.status),
                    advertising_channel_type = COALESCE(EXCLUDED.advertising_channel_type, ad_campaigns.advertising_channel_type),
                    metadata = ad_campaigns.metadata || EXCLUDED.metadata,
                    updated_at = NOW()
      RETURNING id`,
      [
        accountResult.rows[0].id,
        record.externalCampaignId,
        record.campaignName ?? null,
        record.campaignStatus ?? null,
        record.advertisingChannelType ?? null,
        JSON.stringify({ source: "google_ads_api" })
      ]
    );

    await this.pool.query(
      `INSERT INTO daily_ad_performance (
        ad_account_id,
        ad_campaign_id,
        provider,
        platform,
        report_date,
        external_account_id,
        external_campaign_id,
        external_adset_id,
        external_ad_id,
        account_timezone,
        currency,
        spend_amount,
        cost_micros,
        impressions,
        clicks,
        conversions,
        conversions_decimal,
        all_conversions,
        conversion_value,
        ctr,
        average_cpc,
        cost_per_conversion,
        phone_calls,
        search_impression_share,
        status,
        advertising_channel_type,
        raw_metrics
      )
      VALUES (
        $1, $2, 'google_ads', 'google_ads', $3::date, $4, $5, '', '', $6, $7,
        $8::numeric, $9, $10, $11, $12, $13::numeric, $14::numeric, $15::numeric,
        $16::numeric, $17::numeric, $18::numeric, $19::numeric, $20::numeric, $21, $22, $23::jsonb
      )
      ON CONFLICT (platform, report_date, external_account_id, external_campaign_id, external_adset_id, external_ad_id)
      DO UPDATE SET ad_account_id = EXCLUDED.ad_account_id,
                    ad_campaign_id = EXCLUDED.ad_campaign_id,
                    provider = EXCLUDED.provider,
                    account_timezone = COALESCE(EXCLUDED.account_timezone, daily_ad_performance.account_timezone),
                    currency = COALESCE(EXCLUDED.currency, daily_ad_performance.currency),
                    spend_amount = EXCLUDED.spend_amount,
                    cost_micros = EXCLUDED.cost_micros,
                    impressions = EXCLUDED.impressions,
                    clicks = EXCLUDED.clicks,
                    conversions = EXCLUDED.conversions,
                    conversions_decimal = EXCLUDED.conversions_decimal,
                    all_conversions = EXCLUDED.all_conversions,
                    conversion_value = EXCLUDED.conversion_value,
                    ctr = EXCLUDED.ctr,
                    average_cpc = EXCLUDED.average_cpc,
                    cost_per_conversion = EXCLUDED.cost_per_conversion,
                    phone_calls = EXCLUDED.phone_calls,
                    search_impression_share = EXCLUDED.search_impression_share,
                    status = COALESCE(EXCLUDED.status, daily_ad_performance.status),
                    advertising_channel_type = COALESCE(EXCLUDED.advertising_channel_type, daily_ad_performance.advertising_channel_type),
                    raw_metrics = EXCLUDED.raw_metrics,
                    updated_at = NOW()`,
      [
        accountResult.rows[0].id,
        campaignResult.rows[0].id,
        record.reportDate,
        record.externalAccountId,
        record.externalCampaignId,
        record.accountTimezone ?? null,
        record.currency ?? null,
        record.spendAmount,
        record.costMicros,
        record.impressions,
        record.clicks,
        record.conversions,
        record.conversionsDecimal,
        record.allConversions ?? null,
        record.conversionValue ?? null,
        record.ctr ?? null,
        record.averageCpc ?? null,
        record.costPerConversion ?? null,
        record.phoneCalls ?? null,
        record.searchImpressionShare ?? null,
        record.campaignStatus ?? null,
        record.advertisingChannelType ?? null,
        JSON.stringify(record.rawMetrics)
      ]
    );
  }
}
