import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MetaAdsReportingStore } from "../src/metaAds/store.ts";
import type { MetaAdsDailyPerformanceRecord } from "../src/metaAds/mapper.ts";

class FakePool {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];

  async query(sql: string, params: unknown[] = []) {
    this.queries.push({ sql, params });
    if (sql.includes("INSERT INTO sync_runs")) {
      return { rows: [{ id: "sync_SANITIZED" }] };
    }
    if (sql.includes("INSERT INTO ad_accounts")) {
      return { rows: [{ id: "account_uuid" }] };
    }
    if (sql.includes("INSERT INTO ad_campaigns")) {
      return { rows: [{ id: "campaign_uuid" }] };
    }
    return { rows: [] };
  }
}

const record: MetaAdsDailyPerformanceRecord = {
  platform: "meta",
  reportDate: "2026-06-14",
  externalAccountId: "act_SANITIZED",
  accountName: "Sanitized Account",
  accountTimezone: "America/Phoenix",
  currency: "USD",
  externalCampaignId: "campaign_SANITIZED",
  campaignName: "Sanitized Campaign",
  spendAmount: "42.14",
  impressions: 1000,
  reach: 750,
  frequency: "1.333333",
  clicks: 50,
  linkClicks: 20,
  landingPageViews: 12,
  leads: 3,
  costPerLead: "14.045",
  ctr: "5",
  cpc: "0.84",
  cpm: "42.14",
  objective: "OUTCOME_LEADS",
  buyingType: "AUCTION",
  rawMetrics: { sanitized: true }
};

describe("Meta Ads reporting store", () => {
  it("starts and completes Meta sync runs", async () => {
    const pool = new FakePool();
    const store = new MetaAdsReportingStore(pool);

    const syncRun = await store.startSyncRun("daily", { date: "2026-06-14" });
    await store.completeSyncRun(syncRun.id, { recordsRead: 1, recordsWritten: 1 });

    assert.equal(syncRun.id, "sync_SANITIZED");
    assert(pool.queries[0].sql.includes("provider, sync_type"));
    assert.equal(pool.queries[0].params[0], "daily");
    assert(pool.queries[1].sql.includes("status = 'completed'"));
  });

  it("upserts account, campaign, and daily performance with Meta external keys", async () => {
    const pool = new FakePool();
    const store = new MetaAdsReportingStore(pool);

    await store.upsertDailyPerformance(record);

    assert.equal(pool.queries.length, 3);
    assert(pool.queries[0].sql.includes("INSERT INTO ad_accounts"));
    assert(pool.queries[1].sql.includes("INSERT INTO ad_campaigns"));
    assert(pool.queries[2].sql.includes("INSERT INTO daily_ad_performance"));
    assert(pool.queries[2].sql.includes("ON CONFLICT (platform, report_date, external_account_id, external_campaign_id, external_adset_id, external_ad_id)"));
    assert.equal(pool.queries[2].params[2], "2026-06-14");
    assert.equal(pool.queries[2].params[3], "act_SANITIZED");
    assert.equal(pool.queries[2].params[4], "campaign_SANITIZED");
    assert.equal(pool.queries[2].params[11], "42.14");
    assert.equal(pool.queries[2].params[18], 3);
  });
});
