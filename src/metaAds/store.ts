import type { MetaAdsDailyPerformanceRecord } from "./mapper.ts";

export type MetaAdsSyncRun = {
  id: string;
};

export class MetaAdsReportingStore {
  private readonly pool: any;

  constructor(pool: any) {
    this.pool = pool;
  }

  async startSyncRun(syncType: string, metadata: Record<string, unknown> = {}): Promise<MetaAdsSyncRun> {
    const result = await this.pool.query(
      `INSERT INTO sync_runs (provider, sync_type, status, started_at, metadata)
       VALUES ('meta', $1, 'started', NOW(), $2::jsonb)
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

  async upsertDailyPerformance(record: MetaAdsDailyPerformanceRecord): Promise<void> {
    const accountResult = await this.pool.query(
      `INSERT INTO ad_accounts (
        provider,
        external_account_id,
        name,
        currency,
        account_timezone,
        metadata
      )
      VALUES ('meta', $1, $2, $3, $4, $5::jsonb)
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
        JSON.stringify({ source: "meta_ads_insights" })
      ]
    );

    const campaignResult = await this.pool.query(
      `INSERT INTO ad_campaigns (
        ad_account_id,
        provider,
        external_campaign_id,
        name,
        status,
        objective,
        buying_type,
        effective_status,
        metadata
      )
      VALUES ($1, 'meta', $2, $3, $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT (provider, external_campaign_id)
      DO UPDATE SET ad_account_id = EXCLUDED.ad_account_id,
                    name = COALESCE(EXCLUDED.name, ad_campaigns.name),
                    status = COALESCE(EXCLUDED.status, ad_campaigns.status),
                    objective = COALESCE(EXCLUDED.objective, ad_campaigns.objective),
                    buying_type = COALESCE(EXCLUDED.buying_type, ad_campaigns.buying_type),
                    effective_status = COALESCE(EXCLUDED.effective_status, ad_campaigns.effective_status),
                    metadata = ad_campaigns.metadata || EXCLUDED.metadata,
                    updated_at = NOW()
      RETURNING id`,
      [
        accountResult.rows[0].id,
        record.externalCampaignId,
        record.campaignName ?? null,
        record.status ?? null,
        record.objective ?? null,
        record.buyingType ?? null,
        record.effectiveStatus ?? null,
        JSON.stringify({ source: "meta_ads_insights" })
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
        adset_name,
        external_ad_id,
        ad_name,
        account_timezone,
        currency,
        spend_amount,
        impressions,
        reach,
        frequency,
        clicks,
        link_clicks,
        landing_page_views,
        leads,
        cost_per_lead,
        ctr,
        cpc,
        cpm,
        conversions,
        objective,
        optimization_goal,
        buying_type,
        status,
        effective_status,
        raw_metrics
      )
      VALUES (
        $1, $2, 'meta', 'meta', $3::date, $4, $5, $6, $7, $8, $9, $10, $11,
        $12::numeric, $13, $14, $15::numeric, $16, $17, $18, $19, $20::numeric,
        $21::numeric, $22::numeric, $23::numeric, 0, $24, $25, $26, $27, $28, $29::jsonb
      )
      ON CONFLICT (platform, report_date, external_account_id, external_campaign_id, external_adset_id, external_ad_id)
      DO UPDATE SET ad_account_id = EXCLUDED.ad_account_id,
                    ad_campaign_id = EXCLUDED.ad_campaign_id,
                    provider = EXCLUDED.provider,
                    adset_name = COALESCE(EXCLUDED.adset_name, daily_ad_performance.adset_name),
                    ad_name = COALESCE(EXCLUDED.ad_name, daily_ad_performance.ad_name),
                    account_timezone = COALESCE(EXCLUDED.account_timezone, daily_ad_performance.account_timezone),
                    currency = COALESCE(EXCLUDED.currency, daily_ad_performance.currency),
                    spend_amount = EXCLUDED.spend_amount,
                    impressions = EXCLUDED.impressions,
                    reach = EXCLUDED.reach,
                    frequency = EXCLUDED.frequency,
                    clicks = EXCLUDED.clicks,
                    link_clicks = EXCLUDED.link_clicks,
                    landing_page_views = EXCLUDED.landing_page_views,
                    leads = EXCLUDED.leads,
                    cost_per_lead = EXCLUDED.cost_per_lead,
                    ctr = EXCLUDED.ctr,
                    cpc = EXCLUDED.cpc,
                    cpm = EXCLUDED.cpm,
                    objective = COALESCE(EXCLUDED.objective, daily_ad_performance.objective),
                    optimization_goal = COALESCE(EXCLUDED.optimization_goal, daily_ad_performance.optimization_goal),
                    buying_type = COALESCE(EXCLUDED.buying_type, daily_ad_performance.buying_type),
                    status = COALESCE(EXCLUDED.status, daily_ad_performance.status),
                    effective_status = COALESCE(EXCLUDED.effective_status, daily_ad_performance.effective_status),
                    raw_metrics = EXCLUDED.raw_metrics,
                    updated_at = NOW()`,
      [
        accountResult.rows[0].id,
        campaignResult.rows[0].id,
        record.reportDate,
        record.externalAccountId,
        record.externalCampaignId,
        record.externalAdsetId ?? "",
        record.adsetName ?? null,
        record.externalAdId ?? "",
        record.adName ?? null,
        record.accountTimezone ?? null,
        record.currency ?? null,
        record.spendAmount,
        record.impressions,
        record.reach,
        record.frequency ?? null,
        record.clicks,
        record.linkClicks,
        record.landingPageViews,
        record.leads,
        record.costPerLead ?? null,
        record.ctr ?? null,
        record.cpc ?? null,
        record.cpm ?? null,
        record.objective ?? null,
        record.optimizationGoal ?? null,
        record.buyingType ?? null,
        record.status ?? null,
        record.effectiveStatus ?? null,
        JSON.stringify(record.rawMetrics)
      ]
    );
  }
}
