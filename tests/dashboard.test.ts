import assert from "node:assert/strict";
import fs from "node:fs";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../src/config.ts";
import { parseDashboardDateRange } from "../src/dashboard/dateRange.ts";
import { renderDashboard } from "../src/dashboard/render.ts";
import { EmptyDashboardDataSource, PostgresDashboardDataSource } from "../src/dashboard/service.ts";
import { calculateCompletedJobRevenueMetrics } from "../src/dashboard/serviceRevenue.ts";
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
          facebook_future_lead_month_credit: 0,
          website_future_lead_month_credit: 0,
          other_unknown_future_lead_month_credit: 0,
          total_future_lead_month_credit: 0,
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
    if (sql.includes("facebook_customers")) {
      return {
        rows: [{
          facebook_customers: 0,
          website_customers: 3,
          other_unknown_customers: 0
        }]
      };
    }
    if (sql.includes("FROM customers c")) {
      return {
        rows: [{
          active_clients: 4,
          active_mrr: 316,
          priced_active_clients: 4,
          latest_sweepandgo_sync_started_at: "2026-06-22T11:00:00.000Z"
        }]
      };
    }
    if (sql.includes("active_at_start")) {
      return { rows: [{ active_at_start: 20 }] };
    }
    if (sql.includes("FROM cancellations")) {
      return {
        rows: [{
          counted_cancellations: 1,
          raw_cancellation_rows: 3,
          unique_cancellation_candidates: 2,
          duplicate_rows_excluded: 1,
          subscription_only_active_excluded: 1,
          pause_rows_excluded: 0,
          needs_review: 0
        }]
      };
    }
    if (sql.includes("event_type = 'job:completed'")) {
      return {
        rows: [
          { receivedAt: "2026-06-01T12:00:00.000Z", payload: { data: { date: "2026-06-01", status_name: "completed", type: "recurring", assigned_to_id: 1, client_id: "yard-1", price: "60.00", duration: "00:30" } } },
          { receivedAt: "2026-06-01T12:05:00.000Z", payload: { data: { date: "2026-06-01", status_name: "completed", type: "recurring", assigned_to_id: 1, client_id: "yard-1", pricing_plan_name: "Fresh Poo", price: "20.00", duration: "00:00" } } },
          { receivedAt: "2026-06-01T12:10:00.000Z", payload: { data: { date: "2026-06-01", status_name: "skipped", type: "recurring", assigned_to_id: 1, client_id: "yard-2", price: "50.00", duration: "00:10" } } }
        ]
      };
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

class ActiveRosterSnapshotPool extends FakePool {
  override async query(sql: string, params: unknown[] = []) {
    this.queries.push({ sql, params });
    if (sql.includes("to_regclass('public.sweepandgo_active_roster_snapshots')")) {
      return { rows: [{ table_name: "sweepandgo_active_roster_snapshots" }] };
    }
    if (sql.includes("FROM sweepandgo_active_roster_snapshots")) {
      return {
        rows: [{
          active_client_count: 258,
          derived_active_recurring_count: 183,
          updated_at: "2026-07-18T11:00:00.000Z"
        }]
      };
    }
    if (sql.includes("FROM customers c")) {
      return {
        rows: [{
          active_mrr: 0,
          priced_active_clients: 0
        }]
      };
    }
    return await super.query(sql, params);
  }
}

class CompletedJobsFactPool extends FakePool {
  override async query(sql: string, params: unknown[] = []) {
    this.queries.push({ sql, params });
    if (sql.includes("to_regclass('public.sweepandgo_completed_jobs')")) {
      return { rows: [{ table_name: "sweepandgo_completed_jobs" }] };
    }
    if (sql.includes("FROM sweepandgo_completed_jobs")) {
      return {
        rows: [
          {
            serviceDate: "2026-07-01",
            technicianKey: "tech-1",
            stopFingerprint: "stop-1",
            jobStatus: "completed",
            jobType: "recurring",
            allocatedServicePrice: 60,
            recordedDurationMinutes: 30,
            isSpray: false,
            isInitial: false
          },
          {
            serviceDate: "2026-07-01",
            technicianKey: "tech-1",
            stopFingerprint: "stop-1",
            jobStatus: "completed",
            jobType: "recurring",
            allocatedServicePrice: 20,
            recordedDurationMinutes: 0,
            isSpray: true,
            isInitial: false
          },
          {
            serviceDate: "2026-07-01",
            technicianKey: "tech-1",
            stopFingerprint: "stop-2",
            jobStatus: "skipped",
            jobType: "recurring",
            allocatedServicePrice: 50,
            recordedDurationMinutes: 15,
            isSpray: false,
            isInitial: false
          }
        ]
      };
    }
    return await super.query(sql, params);
  }
}

class CompletedJobsWithShiftPool extends CompletedJobsFactPool {
  override async query(sql: string, params: unknown[] = []) {
    this.queries.push({ sql, params });
    if (sql.includes("event_type IN ('payroll:shift_info'")) {
      return {
        rows: [
          payrollShiftRow({ employee_id: 9638, shift_id: 101, shift_date: "2026-07-01", duration_time: 120 }, "2026-07-01T18:00:00.000Z"),
          payrollShiftRow({ employee_id: 9638, shift_id: 101, shift_date: "2026-07-01", duration_time: 120 }, "2026-07-01T18:01:00.000Z"),
          payrollShiftRow({ employee_id: 5501, shift_id: 102, shift_date: "2026-07-01", duration_time: "01:30" }, "2026-07-01T18:02:00.000Z")
        ]
      };
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
      leadBreakdown: { facebook: 1, website: 0, other: 0, unknown: 0 },
      totalLeads: 1,
      totalActiveClients: 12,
      totalActiveClientsSource: "Sweep&Go BI customers where status is active and at least one recurring service is present.",
      totalActiveClientsAsOf: "2026-06-22T11:00:00.000Z",
      totalActiveClientsNeedsVerification: false,
      newRecurringCustomers: 0,
      newRecurringCustomerBreakdown: { facebook: 0, website: 0, other: 0, unknown: 0 },
      costPerLead: 10,
      costPerNewRecurringCustomer: null,
      costPerNewRecurringCustomerStatus: "no_new_customers",
      costPerNewRecurringCustomerNote: "No new customers",
      estimatedActiveMrr: null,
      estimatedActiveMrrReason: undefined,
      averageMonthlyTicket: 95,
      averageMonthlyTicketReason: "Temporary configured constant. Update the dashboard config when the business chooses a new average ticket.",
      estimatedMrrAdded: null,
      cancellations: 0,
      cancellationMetrics: {
        countedCancellations: 0,
        rawCancellationRows: 0,
        uniqueCancellationCandidates: 0,
        duplicateRowsExcluded: 0,
        subscriptionOnlyActiveExcluded: 0,
        pauseRowsExcluded: 0,
        needsReview: 0
      },
      churnRate: 0,
      churnRateDenominator: 12,
      churnRateReason: "Cancellations divided by 12 customers active at the start of the selected range.",
      lifetimeValue: null,
      lifetimeValueReason: "Lifetime value unavailable when churn is zero or unavailable.",
      averageRevenuePerHour: null,
      averageRevenuePerHourReason: "No stored Sweep&Go completed job rows were available for the selected range.",
      revenuePerHourMetrics: {
        rawCompletedJobRows: 0,
        eligibleRows: 0,
        excludedRows: 0,
        sameStopGroupsCreated: 0,
        scoopSprayCombinedStopGroups: 0,
        zeroDurationRows: 0,
        zeroDurationRowsAttachedToValidStop: 0,
        zeroDurationRowsExcluded: 0,
        missingPriceRows: 0,
        serviceRevenue: 0,
        serviceHours: 0,
        completedJobs: 0,
        completedStops: 0,
        pricedCompletedJobs: 0,
        timedCompletedJobs: 0,
        zeroDurationRevenueJobs: 0,
        scoopingRevenue: 0,
        sprayRevenue: 0,
        initialCleanupRevenue: 0,
        revenuePerStop: null,
        averageMinutesPerStop: null,
        status: "unavailable",
        unavailableReason: "No stored Sweep&Go completed job rows were available for the selected range."
      },
      averageRevenuePerShiftHour: null,
      averageRevenuePerShiftHourReason: "No stored Sweep&Go payroll shift rows were available for the selected range.",
      revenuePerShiftHourMetrics: {
        serviceRevenue: 0,
        shiftHours: 0,
        rawShiftRows: 0,
        dedupedShiftRows: 0,
        duplicateShiftRowsExcluded: 0,
        technicianShiftHours: [],
        revenuePerShiftHour: null,
        status: "unavailable",
        unavailableReason: "No stored Sweep&Go payroll shift rows were available for the selected range."
      },
      priorPeriodLeadConversions: 0,
      netRecurringCustomerGrowth: 0,
      closeRate: null,
      closeRateMetrics: {
        facebookMatchedConversions: 0,
        websiteMatchedConversions: 0,
        totalMatchedConversions: 0,
        manualReviewConversions: 0,
        facebookPriorPeriodLeadConversions: 0,
        websitePriorPeriodLeadConversions: 0,
        totalPriorPeriodLeadConversions: 0,
        facebookCloseRate: null,
        websiteCloseRate: null,
        otherUnknownCloseRate: null,
        totalCloseRate: null,
        costPerNewCustomerStatus: "no_new_customers"
      },
      dataNotes: ["Average Monthly Ticket is currently configured at $95.00."]
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
    assert.deepEqual(summary.leadBreakdown, { facebook: 3, website: 2, other: 1, unknown: 0 });
    assert.equal(summary.totalLeads, 6);
    assert.equal(summary.totalActiveClients, 4);
    assert.equal(summary.totalActiveClientsNeedsVerification, false);
    assert.equal(summary.totalActiveClientsAsOf, "2026-06-22T11:00:00.000Z");
    assert.equal(summary.newRecurringCustomers, 2);
    assert.deepEqual(summary.newRecurringCustomerBreakdown, { facebook: 0, website: 0, other: 0, unknown: 2 });
    assert.equal(summary.costPerLead, 25);
    assert.equal(summary.costPerNewRecurringCustomer, 75);
    assert.equal(summary.costPerNewRecurringCustomerStatus, "available");
    assert.equal(summary.costPerNewRecurringCustomerNote, "Ad spend divided by new recurring customers");
    assert.equal(summary.estimatedActiveMrr, null);
    assert.equal(summary.averageMonthlyTicket, 95);
    assert.equal(summary.estimatedMrrAdded, 60);
    assert.equal(summary.cancellations, 1);
    assert.deepEqual(summary.cancellationMetrics, {
      countedCancellations: 1,
      rawCancellationRows: 3,
      uniqueCancellationCandidates: 2,
      duplicateRowsExcluded: 1,
      subscriptionOnlyActiveExcluded: 1,
      pauseRowsExcluded: 0,
      needsReview: 0
    });
    assert.equal(summary.churnRate, 5);
    assert.equal(summary.churnRateDenominator, 20);
    assert.equal(summary.lifetimeValue, 1900);
    assert.equal(summary.averageRevenuePerHour, 160);
    assert.equal(summary.averageRevenuePerHourReason, "Revenue includes completed priced jobs. Service hours exclude zero-duration rows. Missing-price completed jobs are flagged.");
    assert.equal(summary.revenuePerHourMetrics.serviceRevenue, 80);
    assert.equal(summary.revenuePerHourMetrics.serviceHours, 0.5);
    assert.equal(summary.revenuePerHourMetrics.completedStops, 1);
    assert.equal(summary.revenuePerHourMetrics.sprayRevenue, 20);
    assert.equal(summary.revenuePerHourMetrics.zeroDurationRevenueJobs, 1);
    assert.equal(summary.netRecurringCustomerGrowth, 1);
    assert.equal(summary.closeRateMetrics.facebookMatchedConversions, 0);
    assert.equal(summary.closeRateMetrics.websiteMatchedConversions, 3);
    assert.equal(summary.closeRateMetrics.totalMatchedConversions, 3);
    assert.equal(summary.closeRateMetrics.manualReviewConversions, 1);
    assert.equal(summary.closeRateMetrics.facebookCloseRate, 0);
    assert.equal(summary.closeRateMetrics.websiteCloseRate, 30);
    assert.equal(summary.closeRateMetrics.totalCloseRate, 17.65);
    assert(summary.dataNotes.some((note) => note.includes("manual review rows are not counted")));
    assert(summary.dataNotes.some((note) => note.includes("Cancellation quality check")));
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
    assert.equal(summary.totalActiveClients, null);
    assert.equal(summary.totalActiveClientsNeedsVerification, true);
    assert.equal(summary.costPerLead, null);
    assert.equal(summary.costPerNewRecurringCustomer, 0);
    assert.equal(summary.costPerNewRecurringCustomerStatus, "no_ad_spend");
    assert.equal(summary.estimatedActiveMrr, null);
    assert.equal(summary.averageMonthlyTicket, 95);
    assert.equal(summary.closeRateMetrics.totalMatchedConversions, 0);
    assert(summary.dataNotes.some((note) => note.includes("No database")));
  });

  it("renders the cleaned owner scoreboard order with configured owner KPIs", async () => {
    const summary = await new PostgresDashboardDataSource(new FakePool())
      .getSummary(parseDashboardDateRange({ range: "thisMonth" }));
    const html = renderDashboard(dashboardData(summary));

    assert(html.includes("Owner Scoreboard"));
    assert(html.indexOf("Total Active Clients") < html.indexOf("Total Leads"));
    assert(html.indexOf("Total Leads") < html.indexOf("New Recurring Customers"));
    assert(html.indexOf("New Recurring Customers") < html.indexOf("Close Rate"));
    assert(html.indexOf("Close Rate") < html.indexOf("Churn Rate"));
    assert(html.indexOf("Churn Rate") < html.indexOf("Average Monthly Ticket"));
    assert(html.indexOf("Average Monthly Ticket") < html.indexOf("Lifetime Value"));
    assert(html.indexOf("Lifetime Value") < html.indexOf("Average Revenue Per Service Hour"));
    assert(html.indexOf("Average Revenue Per Service Hour") < html.indexOf("Net Customer Growth"));
    assert(html.indexOf("Net Customer Growth") < html.indexOf("Total Ad Spend"));
    assert(html.indexOf("Total Ad Spend") < html.indexOf("Meta Spend"));
    assert(!html.includes("<span>Estimated MRR</span>"));
    assert(html.includes("<span>Average Monthly Ticket</span>"));
    assert(html.includes("$95.00"));
    assert(html.includes("As of latest Sweep&amp;Go active roster snapshot"));
    assert(html.includes("/assets/doo-doo-patrol-logo.png"));
    assert(html.includes("<dt>Website</dt>"));
    assert(html.includes("<dt>Facebook</dt>"));
    assert(html.includes("<dt>Unknown/Other</dt>"));
  });

  it("uses the owner-confirmed July 2026 churn baseline when no historical active roster snapshot exists", async () => {
    const summary = await new PostgresDashboardDataSource(new FakePool())
      .getSummary(parseDashboardDateRange({ range: "custom", start: "2026-07-01", end: "2026-07-19" }));

    assert.equal(summary.churnRateDenominator, 252);
    assert.equal(summary.churnRate, 0.4);
    assert(summary.dataNotes.some((note) => note.includes("owner-confirmed starting active count of 252")));
  });

  it("uses a historical active roster snapshot for churn when one exists before the selected start date", async () => {
    class HistoricalSnapshotPool extends FakePool {
      override async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("to_regclass('public.sweepandgo_active_roster_snapshots')")) {
          return { rows: [{ table_name: "sweepandgo_active_roster_snapshots" }] };
        }
        if (sql.includes("FROM sweepandgo_active_roster_snapshots") && sql.includes("snapshot_date <=")) {
          return { rows: [{ active_client_count: 252, snapshot_date: "2026-07-01" }] };
        }
        if (sql.includes("FROM sweepandgo_active_roster_snapshots")) {
          return { rows: [] };
        }
        return await super.query(sql, params);
      }
    }
    const summary = await new PostgresDashboardDataSource(new HistoricalSnapshotPool())
      .getSummary(parseDashboardDateRange({ range: "custom", start: "2026-07-01", end: "2026-07-19" }));

    assert.equal(summary.churnRateDenominator, 252);
    assert(summary.dataNotes.some((note) => note.includes("active roster snapshot from 2026-07-01")));
    assert(!summary.dataNotes.some((note) => note.includes("owner-confirmed starting active count")));
  });

  it("uses the latest Sweep&Go active roster snapshot for Total Active Clients", async () => {
    const pool = new ActiveRosterSnapshotPool();
    const service = new PostgresDashboardDataSource(pool);
    const summary = await service.getSummary(parseDashboardDateRange({ range: "thisMonth" }));

    assert.equal(summary.totalActiveClients, 258);
    assert.equal(summary.totalActiveClientsNeedsVerification, false);
    assert.equal(summary.totalActiveClientsSource, "Latest Sweep&Go active roster snapshot from the official active client count.");
    assert.equal(summary.estimatedActiveMrr, null);
    assert.equal(summary.averageMonthlyTicket, 95);
  });

  it("keeps MRR hidden while showing configured average ticket and revenue-per-hour notes", async () => {
    class MissingPricePool extends FakePool {
      override async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("FROM customers c")) {
          return {
            rows: [{
              active_clients: 4,
              active_mrr: 158,
              priced_active_clients: 2,
              latest_sweepandgo_sync_started_at: "2026-06-22T11:00:00.000Z"
            }]
          };
        }
        if (sql.includes("event_type = 'job:completed'")) {
          return { rows: [] };
        }
        return await super.query(sql, params);
      }
    }
    const summary = await new PostgresDashboardDataSource(new MissingPricePool())
      .getSummary(parseDashboardDateRange({ range: "thisMonth" }));
    const html = renderDashboard(dashboardData(summary));

    assert.equal(summary.averageMonthlyTicket, 95);
    assert.equal(summary.estimatedActiveMrr, null);
    assert.equal(summary.averageMonthlyTicketReason, "Temporary configured constant. Update the dashboard config when the business chooses a new average ticket.");
    assert(html.includes("<span>Average Monthly Ticket</span>"));
    assert(!html.includes("<span>Estimated MRR</span>"));
    assert(!html.includes("<strong>Unavailable</strong>"));
    assert(summary.dataNotes.some((note) => note.includes("Average Monthly Ticket is currently configured")));
    assert(summary.dataNotes.some((note) => note.includes("No stored Sweep&Go completed job rows")));
    assert(!html.includes("Estimated MRR is hidden for now"));
  });

  it("shows Facebook close rate as 0% when Facebook leads and conversions are both zero", async () => {
    class NoFacebookLeadPool extends FakePool {
      override async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("FROM opportunities") && sql.includes("facebook_leads")) {
          return { rows: [{ facebook_leads: 0, website_leads: 10 }] };
        }
        return await super.query(sql, params);
      }
    }
    const summary = await new PostgresDashboardDataSource(new NoFacebookLeadPool())
      .getSummary(parseDashboardDateRange({ range: "thisMonth" }));

    assert.equal(summary.closeRateMetrics.facebookCloseRate, 0);
    assert(renderDashboard(dashboardData(summary)).includes("0%"));
  });

  it("uses selected-period attributed new recurring customers for owner-facing close rate", async () => {
    class JulyWebsiteCloseRatePool extends FakePool {
      override async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("FROM opportunities") && sql.includes("facebook_leads")) {
          return { rows: [{ facebook_leads: 0, website_leads: 14, other_unknown_leads: 0 }] };
        }
        if (sql.includes("FROM opportunities") && sql.includes("GROUP BY") && sql.includes("original_lead_source")) {
          return { rows: [{ source: "website", count: 14 }] };
        }
        if (sql.includes("SUM(monthly_recurring_revenue)")) {
          return { rows: [{ source: "website", count: 5, mrr_added: 0, priced_count: 0 }] };
        }
        if (sql.includes("FROM cancellations")) {
          return {
            rows: [{
              counted_cancellations: 3,
              raw_cancellation_rows: 3,
              unique_cancellation_candidates: 3,
              duplicate_rows_excluded: 0,
              subscription_only_active_excluded: 0,
              pause_rows_excluded: 0,
              needs_review: 0
            }]
          };
        }
        if (sql.includes("facebook_customers")) {
          return { rows: [{ facebook_customers: 0, website_customers: 5, other_unknown_customers: 0 }] };
        }
        if (sql.includes("FROM lead_customer_matches")) {
          return {
            rows: [{
              facebook_future_lead_month_credit: 0,
              website_future_lead_month_credit: 0,
              other_unknown_future_lead_month_credit: 0,
              total_future_lead_month_credit: 0,
              manual_review: 0,
              facebook_prior_period: 0,
              website_prior_period: 1,
              total_prior_period: 1
            }]
          };
        }
        return await super.query(sql, params);
      }
    }
    const summary = await new PostgresDashboardDataSource(new JulyWebsiteCloseRatePool())
      .getSummary(parseDashboardDateRange({ range: "custom", start: "2026-07-01", end: "2026-07-19" }));
    const html = renderDashboard(dashboardData(summary));

    assert.equal(summary.websiteLeads, 14);
    assert.equal(summary.newRecurringCustomers, 6);
    assert.deepEqual(summary.newRecurringCustomerBreakdown, { facebook: 0, website: 5, other: 0, unknown: 0 });
    assert.equal(summary.closeRateMetrics.websiteMatchedConversions, 5);
    assert.equal(summary.closeRateMetrics.websitePriorPeriodLeadConversions, 1);
    assert.equal(summary.priorPeriodLeadConversions, 1);
    assert.equal(summary.cancellations, 3);
    assert.equal(summary.netRecurringCustomerGrowth, 3);
    assert.equal(summary.closeRateMetrics.websiteCloseRate, 35.71);
    assert.equal(summary.closeRateMetrics.facebookCloseRate, 0);
    assert.equal(summary.closeRateMetrics.totalCloseRate, 35.71);
    assert(summary.dataNotes.some((note) => note.includes("leads created before the selected period")));
    assert(summary.dataNotes.some((note) => note.includes("new recurring customers in the selected period divided by leads created in the selected period")));
    assert(html.includes("New Recurring Customers"));
    assert(html.includes("Other/Unknown"));
    assert(html.includes("Prior-period lead"));
    assert(html.includes("Includes 1 prior-period lead conversion."));
  });

  it("updates Facebook and total close rates when Facebook recurring customers exist", async () => {
    class FutureFacebookCloseRatePool extends FakePool {
      override async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("FROM opportunities") && sql.includes("facebook_leads")) {
          return { rows: [{ facebook_leads: 4, website_leads: 6, other_unknown_leads: 0 }] };
        }
        if (sql.includes("facebook_customers")) {
          return { rows: [{ facebook_customers: 2, website_customers: 3, other_unknown_customers: 0 }] };
        }
        if (sql.includes("FROM lead_customer_matches")) {
          return {
            rows: [{
              facebook_future_lead_month_credit: 0,
              website_future_lead_month_credit: 0,
              other_unknown_future_lead_month_credit: 0,
              total_future_lead_month_credit: 0,
              manual_review: 0,
              facebook_prior_period: 0,
              website_prior_period: 0,
              total_prior_period: 0
            }]
          };
        }
        return await super.query(sql, params);
      }
    }
    const summary = await new PostgresDashboardDataSource(new FutureFacebookCloseRatePool())
      .getSummary(parseDashboardDateRange({ range: "custom", start: "2026-07-01", end: "2026-07-19" }));

    assert.equal(summary.closeRateMetrics.facebookCloseRate, 50);
    assert.equal(summary.closeRateMetrics.websiteCloseRate, 50);
    assert.equal(summary.closeRateMetrics.totalCloseRate, 50);
    assert.equal(summary.closeRateMetrics.totalMatchedConversions, 5);
  });

  it("credits the original lead month for a preserved future conversion without inflating that month leads", async () => {
    class OriginalLeadMonthCreditPool extends FakePool {
      override async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("FROM opportunities") && sql.includes("facebook_leads")) {
          return { rows: [{ facebook_leads: 0, website_leads: 10, other_unknown_leads: 0 }] };
        }
        if (sql.includes("FROM opportunities") && sql.includes("GROUP BY") && sql.includes("original_lead_source")) {
          return { rows: [{ source: "website", count: 10 }] };
        }
        if (sql.includes("facebook_customers")) {
          return { rows: [{ facebook_customers: 0, website_customers: 0, other_unknown_customers: 0 }] };
        }
        if (sql.includes("FROM lead_customer_matches")) {
          return {
            rows: [{
              facebook_future_lead_month_credit: 0,
              website_future_lead_month_credit: 1,
              other_unknown_future_lead_month_credit: 0,
              total_future_lead_month_credit: 1,
              manual_review: 0,
              facebook_prior_period: 0,
              website_prior_period: 0,
              total_prior_period: 0
            }]
          };
        }
        return await super.query(sql, params);
      }
    }
    const summary = await new PostgresDashboardDataSource(new OriginalLeadMonthCreditPool())
      .getSummary(parseDashboardDateRange({ range: "lastMonth" }));

    assert.equal(summary.websiteLeads, 10);
    assert.equal(summary.closeRateMetrics.websiteMatchedConversions, 1);
    assert.equal(summary.closeRateMetrics.websiteCloseRate, 10);
    assert.equal(summary.priorPeriodLeadConversions, 0);
  });

  it("calculates average revenue per service hour from completed Sweep&Go job rows", () => {
    const metrics = calculateCompletedJobRevenueMetrics([
      completedJobRow({ client_id: "same-yard", price: "60.00", duration: "00:30", type: "recurring" }),
      completedJobRow({ client_id: "same-yard", price: "20.00", duration: "00:00", pricing_plan_name: "Fresh Poo" }),
      completedJobRow({ client_id: "skipped-yard", price: "50.00", duration: "00:10", status_name: "skipped" }),
      completedJobRow({ client_id: "missed-yard", price: "50.00", duration: "00:10", status_name: "missed" }),
      completedJobRow({ client_id: "free-initial", price: "0.00", duration: "01:00", type: "initial" })
    ], parseDashboardDateRange({ range: "custom", start: "2026-07-01", end: "2026-07-19" }));

    assert.equal(metrics.status, "available");
    assert.equal(metrics.serviceRevenue, 80);
    assert.equal(metrics.serviceHours, 1.5);
    assert.equal(metrics.completedStops, 2);
    assert.equal(metrics.completedJobs, 3);
    assert.equal(metrics.rawCompletedJobRows, 5);
    assert.equal(metrics.eligibleRows, 3);
    assert.equal(metrics.excludedRows, 2);
    assert.equal(metrics.sameStopGroupsCreated, 2);
    assert.equal(metrics.scoopSprayCombinedStopGroups, 1);
    assert.equal(metrics.pricedCompletedJobs, 3);
    assert.equal(metrics.timedCompletedJobs, 2);
    assert.equal(metrics.zeroDurationRevenueJobs, 1);
    assert.equal(metrics.zeroDurationRows, 1);
    assert.equal(metrics.zeroDurationRowsAttachedToValidStop, 1);
    assert.equal(metrics.zeroDurationRowsExcluded, 0);
    assert.equal(metrics.scoopingRevenue, 60);
    assert.equal(metrics.sprayRevenue, 20);
    assert.equal(metrics.revenuePerStop, 40);
    assert.equal(metrics.averageMinutesPerStop, 45);
  });

  it("excludes completed missing-price jobs from revenue while keeping usable service time", () => {
    const metrics = calculateCompletedJobRevenueMetrics([
      completedJobRow({ client_id: "priced-yard", price: "80.00", duration: "00:40", type: "recurring" }),
      completedJobRow({ client_id: "missing-price-yard", duration: "00:20", type: "one_time" })
    ], parseDashboardDateRange({ range: "custom", start: "2026-07-01", end: "2026-07-19" }));

    assert.equal(metrics.status, "available");
    assert.equal(metrics.serviceRevenue, 80);
    assert.equal(metrics.serviceHours, 1);
    assert.equal(metrics.missingPriceRows, 1);
    assert.equal(metrics.completedStops, 2);
    assert.equal(metrics.pricedCompletedJobs, 1);
    assert.equal(metrics.timedCompletedJobs, 2);
    assert.equal(metrics.revenuePerStop, 40);
  });

  it("uses stored completed job facts for dashboard service-hour revenue when available", async () => {
    const pool = new CompletedJobsFactPool();
    const summary = await new PostgresDashboardDataSource(pool)
      .getSummary(parseDashboardDateRange({ range: "custom", start: "2026-07-01", end: "2026-07-19" }));

    assert.equal(summary.averageRevenuePerHour, 160);
    assert.equal(summary.revenuePerHourMetrics.serviceRevenue, 80);
    assert.equal(summary.revenuePerHourMetrics.completedStops, 1);
    assert.equal(summary.revenuePerHourMetrics.sprayRevenue, 20);
    assert.equal(summary.averageRevenuePerShiftHour, null);
    assert.equal(summary.revenuePerShiftHourMetrics.status, "unavailable");
    assert(pool.queries.some((query) => query.sql.includes("FROM sweepandgo_completed_jobs")));
  });

  it("keeps service-hour revenue unavailable when completed jobs have no usable service time", () => {
    const metrics = calculateCompletedJobRevenueMetrics([
      completedJobRow({ client_id: "same-yard", price: "20.00", duration: "00:00", pricing_plan_name: "Fresh Poo" })
    ], parseDashboardDateRange({ range: "custom", start: "2026-07-01", end: "2026-07-19" }));

    assert.equal(metrics.status, "unavailable");
    assert.equal(metrics.serviceRevenue, 20);
    assert.equal(metrics.serviceHours, 0);
    assert.equal(metrics.zeroDurationRows, 1);
    assert.equal(metrics.zeroDurationRowsAttachedToValidStop, 0);
    assert.equal(metrics.zeroDurationRowsExcluded, 0);
    assert.equal(metrics.unavailableReason, "Stored completed job rows did not include usable positive service duration.");
  });

  it("calculates average revenue per shift hour from deduped payroll shift rows", async () => {
    const summary = await new PostgresDashboardDataSource(new CompletedJobsWithShiftPool())
      .getSummary(parseDashboardDateRange({ range: "custom", start: "2026-07-01", end: "2026-07-19" }));
    const html = renderDashboard(dashboardData(summary));

    assert.equal(summary.revenuePerHourMetrics.serviceRevenue, 80);
    assert.equal(summary.revenuePerShiftHourMetrics.rawShiftRows, 3);
    assert.equal(summary.revenuePerShiftHourMetrics.dedupedShiftRows, 2);
    assert.equal(summary.revenuePerShiftHourMetrics.duplicateShiftRowsExcluded, 1);
    assert.deepEqual(summary.revenuePerShiftHourMetrics.technicianShiftHours, [
      { technician: "Alejandro Hinostroza", hours: 2 },
      { technician: "Bryan Long", hours: 1.5 }
    ]);
    assert.equal(summary.revenuePerShiftHourMetrics.shiftHours, 3.5);
    assert.equal(summary.averageRevenuePerShiftHour, 22.86);
    assert(html.includes("Average Revenue Per Shift Hour"));
    assert(html.includes("Service Productivity"));
  });

  it("uses safe cost per new customer display rules", async () => {
    class CostPool extends FakePool {
      private readonly input: { spend: number; customers: number };

      constructor(input: { spend: number; customers: number }) {
        super();
        this.input = input;
      }

      override async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("FROM daily_ad_performance")) {
          return { rows: [{ meta_spend: this.input.spend, google_spend: 0 }] };
        }
        if (sql.includes("SUM(monthly_recurring_revenue)")) {
          return { rows: [{ count: this.input.customers, mrr_added: 0, priced_count: 0 }] };
        }
        return await super.query(sql, params);
      }
    }

    const noSpendNoCustomers = await new PostgresDashboardDataSource(new CostPool({ spend: 0, customers: 0 }))
      .getSummary(parseDashboardDateRange({ range: "today" }));
    assert.equal(noSpendNoCustomers.costPerNewRecurringCustomer, 0);
    assert.equal(noSpendNoCustomers.costPerNewRecurringCustomerNote, "No ad spend");

    const spendNoCustomers = await new PostgresDashboardDataSource(new CostPool({ spend: 100, customers: 0 }))
      .getSummary(parseDashboardDateRange({ range: "today" }));
    assert.equal(spendNoCustomers.costPerNewRecurringCustomer, null);
    assert.equal(spendNoCustomers.costPerNewRecurringCustomerNote, "No new customers");

    const spendAndCustomers = await new PostgresDashboardDataSource(new CostPool({ spend: 100, customers: 4 }))
      .getSummary(parseDashboardDateRange({ range: "today" }));
    assert.equal(spendAndCustomers.costPerNewRecurringCustomer, 25);
    assert.equal(spendAndCustomers.costPerNewRecurringCustomerStatus, "available");
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
    assert(html.includes("Google Spend"));
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

function completedJobRow(data: Record<string, unknown>) {
  return {
    receivedAt: "2026-07-01T12:00:00.000Z",
    payload: {
      data: {
        date: "2026-07-01",
        status_name: "completed",
        assigned_to_id: 1,
        ...data
      }
    }
  };
}

function payrollShiftRow(data: Record<string, unknown>, receivedAt: string) {
  return {
    eventType: "payroll:shift_info",
    receivedAt,
    processingStatus: "processed",
    payload: {
      data
    },
    eventFingerprint: `shift-${receivedAt}`
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
