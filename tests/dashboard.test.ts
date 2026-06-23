import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../src/config.ts";
import { parseDashboardDateRange } from "../src/dashboard/dateRange.ts";
import { EmptyDashboardDataSource, PostgresDashboardDataSource } from "../src/dashboard/service.ts";
import type { DashboardDataSource, DashboardSummary } from "../src/dashboard/types.ts";
import { createRequestHandler } from "../src/http/app.ts";
import { InMemoryWebhookEventStore } from "../src/webhooks/inMemoryStore.ts";

class FakePool {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];

  async query(sql: string, params: unknown[] = []) {
    this.queries.push({ sql, params });
    if (sql.includes("FROM daily_ad_performance")) {
      return { rows: [{ meta_spend: 100, google_spend: 50 }] };
    }
    if (sql.includes("FROM opportunities") && sql.includes("GROUP BY original_lead_source")) {
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

const summaryOnlyDataSource: DashboardDataSource = {
  async getSummary(range) {
    return {
      range,
      totalAdSpend: 10,
      metaSpend: 10,
      googleSpend: 0,
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
      dataNotes: ["Close rate is deferred until safe lead-to-customer matching is complete."]
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
    assert.equal(summary.totalAdSpend, 150);
    assert.equal(summary.facebookLeads, 3);
    assert.equal(summary.websiteLeads, 2);
    assert.equal(summary.otherLeads, 1);
    assert.equal(summary.totalLeads, 6);
    assert.equal(summary.newRecurringCustomers, 2);
    assert.equal(summary.costPerLead, 25);
    assert.equal(summary.costPerNewRecurringCustomer, 75);
    assert.equal(summary.estimatedMrrAdded, 60);
    assert.equal(summary.cancellations, 1);
    assert.equal(summary.netRecurringCustomerGrowth, 1);
  });

  it("returns safe no-data values without throwing", async () => {
    const service = new EmptyDashboardDataSource();
    const summary = await service.getSummary(parseDashboardDateRange({ range: "today" }));

    assert.equal(summary.totalAdSpend, 0);
    assert.equal(summary.totalLeads, 0);
    assert.equal(summary.costPerLead, null);
    assert(summary.dataNotes.some((note) => note.includes("No database")));
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
