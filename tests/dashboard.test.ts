import assert from "node:assert/strict";
import fs from "node:fs";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../src/config.ts";
import { parseDashboardDateRange } from "../src/dashboard/dateRange.ts";
import { renderDashboard } from "../src/dashboard/render.ts";
import { EmptyDashboardDataSource, PostgresDashboardDataSource } from "../src/dashboard/service.ts";
import type { DashboardData, DashboardDataSource, DashboardSummary } from "../src/dashboard/types.ts";
import { createRequestHandler } from "../src/http/app.ts";
import { InMemoryWebhookEventStore } from "../src/webhooks/inMemoryStore.ts";

class FakePool {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];

  async query(sql: string, params: unknown[] = []) {
    this.queries.push({ sql, params });
    if (sql.includes("has_successful_sync")) {
      return {
        rows: [{
          has_successful_sync: true,
          has_historical_performance: true,
          latest_status: "completed"
        }]
      };
    }
    if (sql.includes("FROM daily_ad_performance")) {
      return { rows: [{ meta_spend: 100, google_spend: 50 }] };
    }
    if (sql.includes("FROM lead_customer_matches")) {
      return {
        rows: [{
          facebook_matched: 0,
          website_matched: 3,
          total_matched: 3,
          manual_review: 1
        }]
      };
    }
    if (sql.includes("FROM opportunities") && sql.includes("facebook_leads")) {
      return { rows: [{ facebook_leads: 7, website_leads: 10 }] };
    }
    if (sql.includes("FROM opportunities") && sql.includes("GROUP BY") && sql.includes("original_lead_source")) {
      return {
        rows: [
          { source: "facebook", count: 3 },
          { source: "website", count: 2 },
          { source: "other", count: 1 }
        ]
      };
    }
    if (sql.includes("SUM(monthly_recurring_revenue)")) {
      return { rows: [{ count: 2, mrr_added: 60, priced_count: 2 }] };
    }
    if (sql.includes("FROM cancellations")) {
      return { rows: [{ count: 1 }] };
    }
    return { rows: [] };
  }
}

class GoogleSpendPool extends FakePool {
  private readonly input: {
    metaSpend: number;
    googleSpend: number;
    hasSuccessfulSync: boolean;
    hasHistoricalPerformance: boolean;
    latestStatus?: string;
  };

  constructor(
    input: {
      metaSpend: number;
      googleSpend: number;
      hasSuccessfulSync: boolean;
      hasHistoricalPerformance: boolean;
      latestStatus?: string;
    }
  ) {
    super();
    this.input = input;
  }

  override async query(sql: string, params: unknown[] = []) {
    this.queries.push({ sql, params });
    if (sql.includes("has_successful_sync")) {
      return {
        rows: [{
          has_successful_sync: this.input.hasSuccessfulSync,
          has_historical_performance: this.input.hasHistoricalPerformance,
          latest_status: this.input.latestStatus
        }]
      };
    }
    if (sql.includes("FROM daily_ad_performance")) {
      return { rows: [{ meta_spend: this.input.metaSpend, google_spend: this.input.googleSpend }] };
    }
    return await super.query(sql, params);
  }
}

class SyncHealthPool {
  async query(sql: string) {
    if (sql.includes("FROM sync_runs")) {
      return {
        rows: [{
          provider: "sweepandgo",
          status: "completed",
          started_at: "2000-01-01T00:00:00.000Z",
          completed_at: "2000-01-01T00:01:00.000Z",
          records_read: 60,
          records_written: 60
        }]
      };
    }
    if (sql.includes("FROM unified_webhook_events")) {
      return { rows: [{ provider: "sweepandgo", recent_events: 0, failed_events: 0 }] };
    }
    if (sql.includes("FROM reconciliation_issues")) {
      return { rows: [{ open_reconciliation_issues: 0 }] };
    }
    return { rows: [] };
  }
}

const summaryOnlyDataSource: DashboardDataSource = {
  async getSummary(range) {
    return {
      range,
      totalAdSpend: 10,
      metaSpend: 10,
      googleSpend: 0,
      googleAdsStatus: {
        connected: true,
        latestStatus: "completed",
        latestFailed: false,
        hasHistoricalPerformance: true
      },
      facebookLeads: 1,
      websiteLeads: 0,
      otherLeads: 0,
      totalLeads: 1,
      newRecurringCustomers: 0,
      costPerLead: 10,
      costPerNewRecurringCustomer: null,
      estimatedMrrAdded: null,
      cancellations: 0,
      netRecurringCustomerGrowth: 0,
      closeRate: null,
      closeRateMetrics: {
        facebookMatchedConversions: 0,
        websiteMatchedConversions: 0,
        totalMatchedConversions: 0,
        manualReviewConversions: 0,
        facebookCloseRate: null,
        websiteCloseRate: null,
        totalCloseRate: null,
        costPerNewCustomerStatus: "unavailable_incomplete_spend_coverage"
      },
      dataNotes: ["Cost per new customer is unavailable until Meta and Google Ads spend coverage is complete for the selected date range."]
    } satisfies DashboardSummary;
  },
  async getTrends() {
    return [];
  },
  async getSources() {
    return {
      leadSources: [],
      campaignPerformance: [],
      unmatchedLeads: { count: 0, note: "Lead to customer matching is coming next." },
      matchingStatus: "Lead to customer matching: coming next"
    };
  },
  async getSyncHealth() {
    return { rows: [] };
  }
};

describe("dashboard date ranges", () => {
  const now = new Date("2026-06-22T12:00:00.000Z");

  it("parses today, yesterday, last 7 days, month presets, and custom ranges in Arizona time", () => {
    assert.deepEqual(parseDashboardDateRange({ range: "today" }, now).startDate, "2026-06-22");
    assert.deepEqual(parseDashboardDateRange({ range: "yesterday" }, now).startDate, "2026-06-21");
    assert.deepEqual(parseDashboardDateRange({ range: "last7" }, now).startDate, "2026-06-16");
    assert.deepEqual(parseDashboardDateRange({ range: "thisMonth" }, now).startDate, "2026-06-01");
    assert.deepEqual(parseDashboardDateRange({ range: "lastMonth" }, now), {
      key: "lastMonth",
      label: "Last month",
      startDate: "2026-05-01",
      endDate: "2026-05-31",
      timeZone: "America/Phoenix"
    });
    assert.deepEqual(parseDashboardDateRange({ range: "custom", start: "2026-06-01", end: "2026-06-07" }, now), {
      key: "custom",
      label: "Custom",
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      timeZone: "America/Phoenix"
    });
  });

  it("falls back to last 7 days when a custom range is invalid", () => {
    const parsed = parseDashboardDateRange({ range: "custom", start: "2026-06-10", end: "2026-06-01" }, now);
    assert.equal(parsed.key, "last7");
    assert.equal(parsed.startDate, "2026-06-16");
  });
});

describe("dashboard KPI aggregation", () => {
  it("calculates summary KPIs from aggregate ad, lead, customer, and cancellation rows", async () => {
    const pool = new FakePool();
    const service = new PostgresDashboardDataSource(pool);
    const summary = await service.getSummary(parseDashboardDateRange({ range: "custom", start: "2026-06-01", end: "2026-06-07" }));

    assert.equal(summary.metaSpend, 100);
    assert.equal(summary.googleSpend, 50);
    assert.equal(summary.googleAdsStatus.connected, true);
    assert.equal(summary.totalAdSpend, 150);
    assert.equal(summary.facebookLeads, 3);
    assert.equal(summary.websiteLeads, 2);
    assert.equal(summary.otherLeads, 1);
    assert.equal(summary.totalLeads, 6);
    assert.equal(summary.newRecurringCustomers, 2);
    assert.equal(summary.costPerLead, 25);
    assert.equal(summary.costPerNewRecurringCustomer, null);
    assert.equal(summary.estimatedMrrAdded, 60);
    assert.equal(summary.cancellations, 1);
    assert.equal(summary.netRecurringCustomerGrowth, 1);
    assert.equal(summary.closeRateMetrics.facebookMatchedConversions, 0);
    assert.equal(summary.closeRateMetrics.websiteMatchedConversions, 3);
    assert.equal(summary.closeRateMetrics.totalMatchedConversions, 3);
    assert.equal(summary.closeRateMetrics.manualReviewConversions, 1);
    assert.equal(summary.closeRateMetrics.facebookCloseRate, 0);
    assert.equal(summary.closeRateMetrics.websiteCloseRate, 30);
    assert.equal(summary.closeRateMetrics.totalCloseRate, 17.65);
    assert(summary.dataNotes.some((note) => note.includes("Cost per new customer is unavailable")));
    assert(summary.dataNotes.some((note) => note.includes("manual review rows are not counted")));
    assert(!summary.dataNotes.some((note) => note.includes("Google Ads is not connected yet")));
    const leadQueries = pool.queries.filter((query) => query.sql.includes("FROM opportunities"));
    assert(leadQueries.some((query) => query.sql.includes("reporting_exclusions")));
    assert(leadQueries.every((query) => !query.sql.includes("ILIKE")));
  });

  it("keeps lead exclusions explicit and migration-backed", () => {
    const migration = fs.readFileSync("migrations/008_create_reporting_exclusions.sql", "utf8");

    assert(migration.includes("CREATE TABLE IF NOT EXISTS reporting_exclusions"));
    assert(migration.includes("uniq_reporting_exclusions_entity_reason_source"));
    assert(migration.includes("applies_to_metric TEXT[]"));
    assert(migration.includes("008_create_reporting_exclusions"));
  });

  it("returns safe no-data values without throwing", async () => {
    const service = new EmptyDashboardDataSource();
    const summary = await service.getSummary(parseDashboardDateRange({ range: "today" }));

    assert.equal(summary.totalAdSpend, 0);
    assert.equal(summary.googleAdsStatus.connected, false);
    assert.equal(summary.totalLeads, 0);
    assert.equal(summary.costPerLead, null);
    assert.equal(summary.closeRateMetrics.totalMatchedConversions, 0);
    assert(summary.dataNotes.some((note) => note.includes("No database")));
  });

  it("flags stale Sweep&Go sync runs in sync health", async () => {
    const service = new PostgresDashboardDataSource(new SyncHealthPool());
    const syncHealth = await service.getSyncHealth(parseDashboardDateRange({ range: "today" }));

    assert.equal(syncHealth.rows[0]?.provider, "sweepandgo");
    assert.equal(syncHealth.rows[0]?.isStale, true);
    assert(syncHealth.rows[0]?.staleWarning?.includes("older than 24 hours"));
  });

  it("treats Google as connected when monthly spend is stored", async () => {
    const service = new PostgresDashboardDataSource(new GoogleSpendPool({
      metaSpend: 0,
      googleSpend: 51.69,
      hasSuccessfulSync: true,
      hasHistoricalPerformance: true,
      latestStatus: "completed"
    }));
    const summary = await service.getSummary(parseDashboardDateRange({ range: "thisMonth" }));

    assert.equal(summary.googleSpend, 51.69);
    assert.equal(summary.googleAdsStatus.connected, true);
    assert(!summary.dataNotes.some((note) => note.includes("not connected")));
  });

  it("shows zero Google spend when connected but selected day has no spend", async () => {
    const service = new PostgresDashboardDataSource(new GoogleSpendPool({
      metaSpend: 0,
      googleSpend: 0,
      hasSuccessfulSync: true,
      hasHistoricalPerformance: true,
      latestStatus: "completed"
    }));
    const summary = await service.getSummary(parseDashboardDateRange({ range: "today" }));
    const html = renderDashboard(dashboardData(summary));

    assert.equal(summary.googleSpend, 0);
    assert.equal(summary.googleAdsStatus.connected, true);
    assert(html.includes("Google spend"));
    assert(html.includes("$0.00"));
    assert(!html.includes("Not connected yet"));
  });

  it("marks Google as not connected only when no successful sync or performance rows exist", async () => {
    const service = new PostgresDashboardDataSource(new GoogleSpendPool({
      metaSpend: 0,
      googleSpend: 0,
      hasSuccessfulSync: false,
      hasHistoricalPerformance: false
    }));
    const summary = await service.getSummary(parseDashboardDateRange({ range: "today" }));
    const html = renderDashboard(dashboardData(summary));

    assert.equal(summary.googleAdsStatus.connected, false);
    assert(summary.dataNotes.some((note) => note.includes("Google Ads is not connected yet")));
    assert(html.includes("Not connected yet"));
  });

  it("keeps historical Google spend visible when the latest sync failed", async () => {
    const service = new PostgresDashboardDataSource(new GoogleSpendPool({
      metaSpend: 0,
      googleSpend: 51.69,
      hasSuccessfulSync: true,
      hasHistoricalPerformance: true,
      latestStatus: "failed"
    }));
    const summary = await service.getSummary(parseDashboardDateRange({ range: "thisMonth" }));
    const html = renderDashboard(dashboardData(summary));

    assert.equal(summary.googleAdsStatus.connected, true);
    assert.equal(summary.googleAdsStatus.latestFailed, true);
    assert.equal(summary.googleSpend, 51.69);
    assert(html.includes("$51.69"));
    assert(!html.includes("Not connected yet"));
    assert(summary.dataNotes.some((note) => note.includes("Latest Google Ads sync failed")));
  });

  it("renders Meta and connected Google zero-spend cards consistently", async () => {
    const summary = await new PostgresDashboardDataSource(new GoogleSpendPool({
      metaSpend: 0,
      googleSpend: 0,
      hasSuccessfulSync: true,
      hasHistoricalPerformance: false,
      latestStatus: "completed"
    })).getSummary(parseDashboardDateRange({ range: "today" }));
    const html = renderDashboard(dashboardData(summary));

    const zeroMoneyOccurrences = html.match(/\$0\.00/g)?.length ?? 0;
    assert(zeroMoneyOccurrences >= 3);
    assert(!html.includes("Not connected yet"));
  });
});

describe("dashboard HTTP access", () => {
  it("disables the dashboard when DASHBOARD_PASSWORD is missing", async () => {
    const handler = testHandler({ dashboardPassword: undefined }, summaryOnlyDataSource);
    const response = await request({ handler, method: "GET", url: "/dashboard" });

    assert.equal(response.status, 503);
    assert(response.text.includes("DASHBOARD_PASSWORD"));
  });

  it("requires dashboard authentication before returning HTML or API data", async () => {
    const handler = testHandler({ dashboardPassword: "dashboard-secret" }, summaryOnlyDataSource);

    const htmlResponse = await request({ handler, method: "GET", url: "/dashboard" });
    const apiResponse = await request({ handler, method: "GET", url: "/api/dashboard/summary" });

    assert.equal(htmlResponse.status, 401);
    assert.equal(apiResponse.status, 401);
    assert.deepEqual(JSON.parse(apiResponse.text), { error: "dashboard_auth_required" });
  });

  it("returns protected aggregate dashboard API data with the password header", async () => {
    const handler = testHandler({ dashboardPassword: "dashboard-secret" }, summaryOnlyDataSource);
    const response = await request({
      handler,
      method: "GET",
      url: "/api/dashboard/summary?range=custom&start=2026-06-01&end=2026-06-07",
      headers: { "x-dashboard-password": "dashboard-secret" }
    });

    const body = JSON.parse(response.text);
    assert.equal(response.status, 200);
    assert.equal(body.totalAdSpend, 10);
    assert.equal(body.range.startDate, "2026-06-01");
    assert(!response.text.includes("dashboard-secret"));
  });
});

function testHandler(configOverrides: Partial<AppConfig>, dashboardDataSource: DashboardDataSource) {
  return createRequestHandler({
    config: {
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
      googleAdsDeveloperToken: undefined,
      googleAdsCustomerId: undefined,
      googleAdsLoginCustomerId: undefined,
      googleAdsClientId: undefined,
      googleAdsClientSecret: undefined,
      googleAdsRefreshToken: undefined,
      googleAdsApiVersion: "v24",
      googleAdsApiBaseUrl: "https://googleads.googleapis.com",
      googleAdsOAuthTokenUrl: "https://oauth2.googleapis.com/token",
      dashboardPassword: "dashboard-secret",
      ...configOverrides
    },
    webhookStore: new InMemoryWebhookEventStore(),
    dashboardDataSource
  });
}

function dashboardData(summary: DashboardSummary): DashboardData {
  return {
    summary,
    trends: [],
    sources: {
      leadSources: [],
      campaignPerformance: [],
      unmatchedLeads: { count: 0, note: "No unmatched leads." },
      matchingStatus: "Stable matches only."
    },
    syncHealth: { rows: [] }
  };
}

async function request(input: {
  handler: ReturnType<typeof createRequestHandler>;
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
}) {
  const chunks: Buffer[] = [];
  const requestBody = input.body === undefined ? [] : [Buffer.from(input.body)];
  const request = Readable.from(requestBody) as IncomingMessage;
  request.method = input.method;
  request.url = input.url;
  request.headers = input.headers ?? {};

  const response = {
    statusCode: 200,
    headers: {} as Record<string, string | number | string[]>,
    setHeader(key: string, value: string | string[]) {
      this.headers[key.toLowerCase()] = value;
      return this;
    },
    writeHead(statusCode: number, headers: Record<string, string | number>) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
      return this;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return this;
    }
  } as unknown as ServerResponse & {
    statusCode: number;
    headers: Record<string, string | number | string[]>;
  };

  await input.handler(request, response);
  return {
    status: response.statusCode,
    headers: response.headers,
    text: Buffer.concat(chunks).toString("utf8")
  };
}
