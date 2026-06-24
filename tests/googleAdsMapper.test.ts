import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppConfig } from "../src/config.ts";
import { GoogleAdsClient, normalizeCustomerId, supportsSearchPageSize } from "../src/googleAds/client.ts";
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

  it("omits pageSize from Google Ads v24 search requests", async () => {
    const calls = await captureGoogleAdsSearchRequests(async (client) => {
      await client.discoverAccount();
    }, { apiVersion: "v24" });

    assert.equal(calls.searchBodies.length, 1);
    assert.equal(calls.searchBodies[0].query, googleAdsAccountQuery());
    assert.equal("pageSize" in calls.searchBodies[0], false);
    assert.equal(calls.searchBodies[0].pageToken, undefined);
  });

  it("keeps pageSize for older Google Ads API versions", async () => {
    const calls = await captureGoogleAdsSearchRequests(async (client) => {
      await client.discoverAccount();
    }, { apiVersion: "v23" });

    assert.equal(calls.searchBodies.length, 1);
    assert.equal(calls.searchBodies[0].pageSize, 1);
    assert.equal(supportsSearchPageSize("v23"), true);
    assert.equal(supportsSearchPageSize("v24"), false);
  });

  it("keeps max-pages protection when v24 omits pageSize", async () => {
    const calls = await captureGoogleAdsSearchRequests(async (client) => {
      const rows = await client.search({
        query: googleAdsCampaignPerformanceQuery({ date: "2026-06-14", limit: 10 }),
        pageSize: 10,
        maxPages: 1
      });
      assert.equal(rows.length, 1);
    }, {
      apiVersion: "v24",
      firstSearchResponse: {
        results: [{ customer: { id: "1234567890" } }],
        nextPageToken: "next_page_SANITIZED"
      }
    });

    assert.equal(calls.searchBodies.length, 1);
    assert.equal("pageSize" in calls.searchBodies[0], false);
  });

  it("sends v24 performance reads without pageSize and without logging secrets", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => {
      logs.push(values.map(String).join(" "));
    };

    try {
      const calls = await captureGoogleAdsSearchRequests(async (client) => {
        await client.getCampaignPerformance({
          date: "2026-06-14",
          pageSize: 10,
          maxPages: 1
        });
      }, { apiVersion: "v24" });

      assert.equal(calls.searchBodies.length, 1);
      assert(calls.searchBodies[0].query.includes("FROM campaign"));
      assert(calls.searchBodies[0].query.includes("LIMIT 10"));
      assert.equal("pageSize" in calls.searchBodies[0], false);
      assert.equal(logs.length, 0);
    } finally {
      console.log = originalLog;
    }
  });
});

async function captureGoogleAdsSearchRequests(
  action: (client: GoogleAdsClient) => Promise<void>,
  options: {
    apiVersion: string;
    firstSearchResponse?: Record<string, unknown>;
  }
): Promise<{ searchBodies: Array<Record<string, unknown>> }> {
  const originalFetch = globalThis.fetch;
  const searchBodies: Array<Record<string, unknown>> = [];
  let searchCount = 0;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url);
    if (requestUrl.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "access_token_SANITIZED" });
    }

    searchCount += 1;
    searchBodies.push(JSON.parse(String(init?.body ?? "{}")));
    return jsonResponse(searchCount === 1 && options.firstSearchResponse
      ? options.firstSearchResponse
      : {
          results: [{
            customer: {
              id: "1234567890",
              descriptiveName: "Sanitized Account",
              currencyCode: "USD",
              timeZone: "America/Phoenix"
            },
            segments: { date: "2026-06-14" },
            campaign: { id: "987654321" },
            metrics: { costMicros: "1000000" }
          }]
        });
  }) as typeof fetch;

  try {
    const client = new GoogleAdsClient({
      developerToken: "developer_token_SANITIZED",
      customerId: "123-456-7890",
      loginCustomerId: "111-222-3333",
      clientId: "client_id_SANITIZED",
      clientSecret: "client_secret_SANITIZED",
      refreshToken: "refresh_token_SANITIZED",
      apiVersion: options.apiVersion,
      apiBaseUrl: "https://googleads.googleapis.com",
      oauthTokenUrl: "https://oauth2.googleapis.com/token"
    });

    await action(client);
    return { searchBodies };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(body: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body)
  } as Response;
}

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
