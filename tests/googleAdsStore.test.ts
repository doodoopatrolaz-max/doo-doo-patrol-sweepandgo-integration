import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GoogleAdsDailyPerformanceRecord } from "../src/googleAds/mapper.ts";
import { GoogleAdsReportingStore } from "../src/googleAds/store.ts";

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

const record: GoogleAdsDailyPerformanceRecord = {
  platform: "google_ads",
  reportDate: "2026-06-14",
  externalAccountId: "1234567890",
  accountName: "Sanitized Google Ads Account",
  accountTimezone: "America/Phoenix",
  currency: "USD",
  externalCampaignId: "987654321",
  campaignName: "Sanitized Campaign",
  campaignStatus: "ENABLED",
  advertisingChannelType: "SEARCH",
  costMicros: 42137000,
  spendAmount: "42.14",
  impressions: 1000,
  clicks: 50,
  conversions: 3,
  conversionsDecimal: "3.250000",
  allConversions: "4.500000",
  conversionValue: "125.750000",
  ctr: "0.050000",
  averageCpc: "0.84",
  costPerConversion: "12.97",
  phoneCalls: "2.000000",
  searchImpressionShare: "0.720000",
  rawMetrics: { sanitized: true }
};

describe("Google Ads reporting store", () => {
  it("starts and completes Google Ads sync runs", async () => {
    const pool = new FakePool();
    const store = new GoogleAdsReportingStore(pool);

    const syncRun = await store.startSyncRun("daily", { date: "2026-06-14" });
    await store.completeSyncRun(syncRun.id, { recordsRead: 1, recordsWritten: 1 });

    assert.equal(syncRun.id, "sync_SANITIZED");
    assert(pool.queries[0].sql.includes("VALUES ('google_ads'"));
    assert.equal(pool.queries[0].params[0], "daily");
    assert(pool.queries[1].sql.includes("status = 'completed'"));
  });

  it("upserts account, campaign, and daily performance with Google Ads external keys", async () => {
    const pool = new FakePool();
    const store = new GoogleAdsReportingStore(pool);

    await store.upsertDailyPerformance(record);

    assert.equal(pool.queries.length, 3);
    assert(pool.queries[0].sql.includes("INSERT INTO ad_accounts"));
    assert(pool.queries[0].sql.includes("VALUES ('google_ads'"));
    assert(pool.queries[1].sql.includes("INSERT INTO ad_campaigns"));
    assert(pool.queries[1].sql.includes("advertising_channel_type"));
    assert(pool.queries[2].sql.includes("INSERT INTO daily_ad_performance"));
    assert(pool.queries[2].sql.includes("ON CONFLICT (platform, report_date, external_account_id, external_campaign_id, external_adset_id, external_ad_id)"));
    assert.equal(pool.queries[2].params[2], "2026-06-14");
    assert.equal(pool.queries[2].params[3], "1234567890");
    assert.equal(pool.queries[2].params[4], "987654321");
    assert.equal(pool.queries[2].params[7], "42.14");
    assert.equal(pool.queries[2].params[8], 42137000);
    assert.equal(pool.queries[2].params[11], 3);
    assert.equal(pool.queries[2].params[12], "3.250000");
  });
});
