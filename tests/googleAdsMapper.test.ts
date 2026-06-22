import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppConfig } from "../src/config.ts";
import { GoogleAdsClient, normalizeCustomerId } from "../src/googleAds/client.ts";
import {
  googleAdsAccountQuery,
  googleAdsCampaignPerformanceQuery,
  mapGoogleAdsCampaignRow
} from "../src/googleAds/mapper.ts";

describe("Google Ads mapper", () => {
  it("maps campaign-level Google Ads rows into daily performance records", () => {
    const mapped = mapGoogleAdsCampaignRow({
      segments: { date: "2026-06-14" },
      customer: {
        id: "123-456-7890",
        descriptiveName: "Sanitized Google Ads Account",
        currencyCode: "USD",
        timeZone: "America/Phoenix"
      },
      campaign: {
        id: "987654321",
        name: "Sanitized Campaign",
        status: "ENABLED",
        advertisingChannelType: "SEARCH"
      },
      metrics: {
        costMicros: "42137000",
        impressions: "1000",
        clicks: "50",
        conversions: "3.25",
        allConversions: "4.5",
        conversionsValue: "125.75",
        ctr: "0.05",
        averageCpc: "842740",
        costPerConversion: "12965231",
        phoneCalls: "2",
        searchImpressionShare: "0.72"
      }
    });

    assert.equal(mapped.platform, "google_ads");
    assert.equal(mapped.reportDate, "2026-06-14");
    assert.equal(mapped.externalAccountId, "1234567890");
    assert.equal(mapped.externalCampaignId, "987654321");
    assert.equal(mapped.spendAmount, "42.14");
    assert.equal(mapped.costMicros, 42137000);
    assert.equal(mapped.impressions, 1000);
    assert.equal(mapped.clicks, 50);
    assert.equal(mapped.conversions, 3);
    assert.equal(mapped.conversionsDecimal, "3.250000");
    assert.equal(mapped.allConversions, "4.500000");
    assert.equal(mapped.conversionValue, "125.750000");
    assert.equal(mapped.averageCpc, "0.84");
    assert.equal(mapped.costPerConversion, "12.97");
    assert.equal(mapped.phoneCalls, "2.000000");
    assert.equal(mapped.searchImpressionShare, "0.720000");
    assert.equal(mapped.currency, "USD");
    assert.equal(mapped.accountTimezone, "America/Phoenix");
    assert.equal(mapped.advertisingChannelType, "SEARCH");
  });

  it("defaults missing numeric metrics to zero and keeps Google conversions separate", () => {
    const mapped = mapGoogleAdsCampaignRow({
      segments: { date: "2026-06-14" },
      customer: { id: "1234567890" },
      campaign: { id: "987654321" }
    });

    assert.equal(mapped.spendAmount, "0.00");
    assert.equal(mapped.impressions, 0);
    assert.equal(mapped.clicks, 0);
    assert.equal(mapped.conversions, 0);
    assert.equal(mapped.conversionsDecimal, "0.000000");
  });

  it("builds read-only GAQL account and campaign performance queries", () => {
    const accountQuery = googleAdsAccountQuery();
    const performanceQuery = googleAdsCampaignPerformanceQuery({ date: "2026-06-14", limit: 10 });

    assert(accountQuery.includes("FROM customer"));
    assert(performanceQuery.includes("FROM campaign"));
    assert(performanceQuery.includes("metrics.cost_micros"));
    assert(performanceQuery.includes("WHERE segments.date = '2026-06-14'"));
    assert(!performanceQuery.toLowerCase().includes("mutate"));
  });

  it("requires Google Ads credentials before live reads", () => {
    assert.throws(() => GoogleAdsClient.fromConfig(googleConfig({ googleAdsDeveloperToken: undefined })), /GOOGLE_ADS_DEVELOPER_TOKEN/);
    assert.throws(() => GoogleAdsClient.fromConfig(googleConfig({ googleAdsCustomerId: undefined })), /GOOGLE_ADS_CUSTOMER_ID/);
    assert.throws(() => GoogleAdsClient.fromConfig(googleConfig({ googleAdsRefreshToken: undefined })), /GOOGLE_ADS_REFRESH_TOKEN/);
    assert(GoogleAdsClient.fromConfig(googleConfig({})) instanceof GoogleAdsClient);
  });

  it("normalizes customer IDs without exposing credentials", () => {
    assert.equal(normalizeCustomerId("123-456-7890"), "1234567890");
  });
});

function googleConfig(overrides: Partial<AppConfig>): AppConfig {
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
    metaAccessToken: undefined,
    metaAdAccountId: undefined,
    metaApiVersion: "v23.0",
    metaApiBaseUrl: "https://graph.facebook.com",
    metaAppId: undefined,
    metaAppSecret: undefined,
    metaBusinessId: undefined,
    googleAdsWebhookSecret: undefined,
    googleAdsDeveloperToken: "developer_token_SANITIZED",
    googleAdsCustomerId: "123-456-7890",
    googleAdsLoginCustomerId: undefined,
    googleAdsClientId: "client_id_SANITIZED",
    googleAdsClientSecret: "client_secret_SANITIZED",
    googleAdsRefreshToken: "refresh_token_SANITIZED",
    googleAdsApiVersion: "v24",
    googleAdsApiBaseUrl: "https://googleads.googleapis.com",
    googleAdsOAuthTokenUrl: "https://oauth2.googleapis.com/token",
    ...overrides
  };
}
