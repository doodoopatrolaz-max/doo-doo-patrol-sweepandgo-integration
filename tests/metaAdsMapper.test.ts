import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppConfig } from "../src/config.ts";
import { MetaAdsClient } from "../src/metaAds/client.ts";
import { mapMetaAdsInsightsRow, metaInsightsFields } from "../src/metaAds/mapper.ts";

describe("Meta Ads mapper", () => {
  it("maps campaign-level Insights rows into daily performance records", () => {
    const mapped = mapMetaAdsInsightsRow({
      date_start: "2026-06-14",
      date_stop: "2026-06-14",
      account_id: "act_SANITIZED",
      account_name: "Sanitized Account",
      campaign_id: "campaign_SANITIZED",
      campaign_name: "Sanitized Campaign",
      spend: "42.137",
      impressions: "1000",
      reach: "750",
      frequency: "1.333333",
      clicks: "50",
      ctr: "5",
      cpc: "0.84",
      cpm: "42.14",
      objective: "OUTCOME_LEADS",
      buying_type: "AUCTION",
      actions: [
        { action_type: "link_click", value: "20" },
        { action_type: "landing_page_view", value: "12" },
        { action_type: "lead", value: "3" }
      ],
      cost_per_action_type: [
        { action_type: "lead", value: "14.045" }
      ]
    }, {
      accountTimezone: "America/Phoenix",
      currency: "USD"
    });

    assert.equal(mapped.platform, "meta");
    assert.equal(mapped.reportDate, "2026-06-14");
    assert.equal(mapped.externalAccountId, "act_SANITIZED");
    assert.equal(mapped.externalCampaignId, "campaign_SANITIZED");
    assert.equal(mapped.spendAmount, "42.14");
    assert.equal(mapped.impressions, 1000);
    assert.equal(mapped.reach, 750);
    assert.equal(mapped.clicks, 50);
    assert.equal(mapped.linkClicks, 20);
    assert.equal(mapped.landingPageViews, 12);
    assert.equal(mapped.leads, 3);
    assert.equal(mapped.costPerLead, "14.045");
    assert.equal(mapped.currency, "USD");
    assert.equal(mapped.accountTimezone, "America/Phoenix");
    assert.equal(mapped.objective, "OUTCOME_LEADS");
    assert.equal(mapped.buyingType, "AUCTION");
  });

  it("keeps Meta-reported leads separate and defaults missing numeric fields to zero", () => {
    const mapped = mapMetaAdsInsightsRow({
      date_start: "2026-06-14",
      account_id: "act_SANITIZED",
      campaign_id: "campaign_SANITIZED"
    });

    assert.equal(mapped.leads, 0);
    assert.equal(mapped.linkClicks, 0);
    assert.equal(mapped.landingPageViews, 0);
    assert.equal(mapped.spendAmount, "0.00");
    assert.equal(mapped.impressions, 0);
  });

  it("uses campaign fields first and can add ad set/ad fields later", () => {
    assert(metaInsightsFields("campaign").includes("campaign_id"));
    assert(!metaInsightsFields("campaign").includes("adset_id"));
    assert(metaInsightsFields("adset").includes("adset_id"));
    assert(metaInsightsFields("ad").includes("ad_id"));
  });

  it("requires token and account credentials before live reads", () => {
    assert.throws(() => MetaAdsClient.fromConfig(metaConfig({ metaAccessToken: undefined })), /META_ACCESS_TOKEN/);
    assert.throws(() => MetaAdsClient.fromConfig(metaConfig({ metaAdAccountId: undefined })), /META_AD_ACCOUNT_ID/);
    assert(MetaAdsClient.fromConfig(metaConfig({})) instanceof MetaAdsClient);
  });
});

function metaConfig(overrides: Partial<AppConfig>): AppConfig {
  return {
    nodeEnv: "test",
    port: 0,
    host: "127.0.0.1",
    webhookPathSecret: "test-secret",
    databaseUrl: undefined,
    sweepgoApiToken: undefined,
    sweepgoBaseUrl: "https://openapi.sweepandgo.com",
    dailyDashboardEnabled: false,
    dailyDashboardRecipient: "placeholder@example.invalid",
    dailyDashboardFrom: undefined,
    dailyDashboardTimeZone: "America/Phoenix",
    smtpHost: undefined,
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: undefined,
    smtpPassword: undefined,
    goHighLevelWebhookSecret: undefined,
    goHighLevelPrivateIntegrationToken: undefined,
    goHighLevelApiBaseUrl: "https://services.leadconnectorhq.com",
    goHighLevelApiVersion: "2021-07-28",
    goHighLevelLocationId: undefined,
    goHighLevelPipelineId: undefined,
    goHighLevelPipelineName: "Fresh Leads to Onboarding",
    goHighLevelFacebookStageId: undefined,
    goHighLevelFacebookStageName: "Facebook New Lead",
    goHighLevelWebsiteStageId: undefined,
    goHighLevelWebsiteStageName: "Website Quote Lead",
    gmailWebhookSecret: undefined,
    metaAdsWebhookSecret: undefined,
    metaAccessToken: "token_SANITIZED",
    metaAdAccountId: "act_SANITIZED",
    metaApiVersion: "v23.0",
    metaApiBaseUrl: "https://graph.facebook.com",
    metaAppId: undefined,
    metaAppSecret: undefined,
    metaBusinessId: undefined,
    googleAdsWebhookSecret: undefined,
    ...overrides
  };
}
