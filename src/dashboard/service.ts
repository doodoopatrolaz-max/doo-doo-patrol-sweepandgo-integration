import { enumerateDates, type DashboardDateRange } from "./dateRange.ts";
import type {
  DashboardCampaignRow,
  DashboardDataSource,
  DashboardSourceRow,
  DashboardSources,
  DashboardSummary,
  DashboardSyncHealth,
  DashboardTrendPoint
} from "./types.ts";

type Queryable = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

const SOURCES: DashboardSourceRow["source"][] = ["facebook", "website", "other", "unknown"];

export class PostgresDashboardDataSource implements DashboardDataSource {
  private readonly pool: Queryable;

  constructor(pool: Queryable) {
    this.pool = pool;
  }

  async getSummary(range: DashboardDateRange): Promise<DashboardSummary> {
    const [adSpend, leads, customers, cancellations] = await Promise.all([
      this.adSpendByPlatform(range),
      this.leadsBySource(range),
      this.newRecurringCustomers(range),
      this.cancellations(range)
    ]);

    const facebookLeads = leads.facebook;
    const websiteLeads = leads.website;
    const otherLeads = leads.other + leads.unknown;
    const totalLeads = facebookLeads + websiteLeads + otherLeads;
    const newRecurringCustomers = customers.total;
    const totalAdSpend = adSpend.meta + adSpend.google;
    const estimatedMrrAdded = customers.mrrAdded === null ? null : roundMoney(customers.mrrAdded);

    return {
      range,
      totalAdSpend: roundMoney(totalAdSpend),
      metaSpend: roundMoney(adSpend.meta),
      googleSpend: roundMoney(adSpend.google),
      facebookLeads,
      websiteLeads,
      otherLeads,
      totalLeads,
      newRecurringCustomers,
      costPerLead: totalLeads > 0 ? roundMoney(totalAdSpend / totalLeads) : null,
      costPerNewRecurringCustomer: newRecurringCustomers > 0 ? roundMoney(totalAdSpend / newRecurringCustomers) : null,
      estimatedMrrAdded,
      cancellations,
      netRecurringCustomerGrowth: newRecurringCustomers - cancellations,
      closeRate: null,
      dataNotes: dataNotes({
        googleSpend: adSpend.google,
        totalLeads,
        newRecurringCustomers,
        estimatedMrrAdded,
        sweepAndGoLiveWebhookProcessingActive: true
      })
    };
  }

  async getTrends(range: DashboardDateRange): Promise<DashboardTrendPoint[]> {
    const [spendRows, leadRows, customerRows] = await Promise.all([
      this.pool.query(
        `SELECT report_date::text AS date,
                SUM(CASE WHEN platform = 'meta' THEN spend_amount ELSE 0 END)::float AS meta_spend,
                SUM(CASE WHEN platform IN ('google', 'google_ads') THEN spend_amount ELSE 0 END)::float AS google_spend
         FROM daily_ad_performance
         WHERE report_date BETWEEN $1::date AND $2::date
         GROUP BY report_date
         ORDER BY report_date`,
        [range.startDate, range.endDate]
      ),
      this.pool.query(
        `SELECT original_lead_date::date::text AS date,
                COUNT(*) FILTER (WHERE original_lead_source = 'facebook')::int AS facebook_leads,
                COUNT(*) FILTER (WHERE original_lead_source = 'website')::int AS website_leads,
                COUNT(*)::int AS total_leads
         FROM opportunities
         WHERE original_lead_date::date BETWEEN $1::date AND $2::date
           AND original_lead_source IN ('facebook', 'website', 'other', 'unknown')
         GROUP BY original_lead_date::date
         ORDER BY original_lead_date::date`,
        [range.startDate, range.endDate]
      ),
      this.pool.query(
        `SELECT first_recurring_date::text AS date,
                COUNT(*)::int AS new_recurring_customers
         FROM customers
         WHERE first_recurring_date BETWEEN $1::date AND $2::date
         GROUP BY first_recurring_date
         ORDER BY first_recurring_date`,
        [range.startDate, range.endDate]
      )
    ]);

    const spendByDate = indexByDate(spendRows.rows);
    const leadsByDate = indexByDate(leadRows.rows);
    const customersByDate = indexByDate(customerRows.rows);

    return enumerateDates(range.startDate, range.endDate).map((date) => {
      const spend = spendByDate.get(date) ?? {};
      const leads = leadsByDate.get(date) ?? {};
      const customers = customersByDate.get(date) ?? {};
      const metaSpend = numberValue(spend.meta_spend);
      const googleSpend = numberValue(spend.google_spend);
      const totalSpend = metaSpend + googleSpend;
      const totalLeads = integerValue(leads.total_leads);
      const newRecurringCustomers = integerValue(customers.new_recurring_customers);

      return {
        date,
        metaSpend: roundMoney(metaSpend),
        googleSpend: roundMoney(googleSpend),
        totalSpend: roundMoney(totalSpend),
        facebookLeads: integerValue(leads.facebook_leads),
        websiteLeads: integerValue(leads.website_leads),
        totalLeads,
        newRecurringCustomers,
        costPerLead: totalLeads > 0 ? roundMoney(totalSpend / totalLeads) : null,
        costPerNewRecurringCustomer: newRecurringCustomers > 0 ? roundMoney(totalSpend / newRecurringCustomers) : null
      };
    });
  }

  async getSources(range: DashboardDateRange): Promise<DashboardSources> {
    const [leadRows, customerRows, campaignRows, unmatchedRows] = await Promise.all([
      this.pool.query(
        `SELECT original_lead_source AS source, COUNT(*)::int AS count
         FROM opportunities
         WHERE original_lead_date::date BETWEEN $1::date AND $2::date
         GROUP BY original_lead_source`,
        [range.startDate, range.endDate]
      ),
      this.pool.query(
        `SELECT source, COUNT(*)::int AS count
         FROM customers
         WHERE first_recurring_date BETWEEN $1::date AND $2::date
         GROUP BY source`,
        [range.startDate, range.endDate]
      ),
      this.pool.query(
        `SELECT provider,
                COUNT(DISTINCT external_campaign_id)::int AS campaign_count,
                SUM(spend_amount)::float AS spend,
                SUM(impressions)::int AS impressions,
                SUM(clicks)::int AS clicks,
                SUM(leads)::int AS leads,
                SUM(conversions)::int AS conversions
         FROM daily_ad_performance
         WHERE report_date BETWEEN $1::date AND $2::date
         GROUP BY provider
         ORDER BY provider`,
        [range.startDate, range.endDate]
      ),
      this.pool.query(
        `SELECT COUNT(*)::int AS count
         FROM opportunities
         WHERE original_lead_date::date BETWEEN $1::date AND $2::date
           AND original_lead_source IN ('facebook', 'website')
           AND contact_id IS NULL`,
        [range.startDate, range.endDate]
      )
    ]);

    const leadCounts = sourceCountMap(leadRows.rows, "source", "count");
    const customerCounts = sourceCountMap(customerRows.rows, "source", "count");
    const leadSources = SOURCES.map((source) => ({
      source,
      leads: leadCounts[source] ?? 0,
      newRecurringCustomers: customerCounts[source] ?? 0
    }));

    return {
      leadSources,
      campaignPerformance: campaignRows.rows.map((row) => ({
        provider: stringValue(row.provider) || "unknown",
        campaignCount: integerValue(row.campaign_count),
        spend: roundMoney(numberValue(row.spend)),
        impressions: integerValue(row.impressions),
        clicks: integerValue(row.clicks),
        leads: integerValue(row.leads),
        conversions: integerValue(row.conversions)
      })) satisfies DashboardCampaignRow[],
      unmatchedLeads: {
        count: integerValue(unmatchedRows.rows[0]?.count),
        note: "Lead to customer matching is coming next."
      },
      matchingStatus: "Lead to customer matching: coming next"
    };
  }

  async getSyncHealth(range: DashboardDateRange): Promise<DashboardSyncHealth> {
    const [syncRows, eventRows, issueRows] = await Promise.all([
      this.pool.query(
        `SELECT DISTINCT ON (provider)
                provider,
                status,
                started_at,
                completed_at,
                records_read,
                records_written
         FROM sync_runs
         ORDER BY provider, started_at DESC`
      ),
      this.pool.query(
        `SELECT provider,
                COUNT(*)::int AS recent_events,
                COUNT(*) FILTER (WHERE processing_status = 'failed')::int AS failed_events
         FROM unified_webhook_events
         WHERE received_at::date BETWEEN $1::date AND $2::date
         GROUP BY provider`,
        [range.startDate, range.endDate]
      ),
      this.pool.query(
        `SELECT COUNT(*)::int AS open_reconciliation_issues
         FROM reconciliation_issues
         WHERE status = 'open'`
      )
    ]);

    const eventsByProvider = new Map(eventRows.rows.map((row) => [stringValue(row.provider), row]));
    const openIssues = integerValue(issueRows.rows[0]?.open_reconciliation_issues);

    return {
      rows: syncRows.rows.map((row) => {
        const provider = stringValue(row.provider) || "unknown";
        const events = eventsByProvider.get(provider) ?? {};
        const staleWarning = syncStaleWarning(provider, row.started_at);
        return {
          provider,
          latestStatus: stringValue(row.status) || "unknown",
          lastStartedAt: isoString(row.started_at),
          lastCompletedAt: isoString(row.completed_at),
          recordsRead: integerValue(row.records_read),
          recordsWritten: integerValue(row.records_written),
          recentEvents: integerValue(events.recent_events),
          failedEvents: integerValue(events.failed_events),
          openReconciliationIssues: openIssues,
          isStale: Boolean(staleWarning),
          staleWarning
        };
      })
    };
  }

  private async adSpendByPlatform(range: DashboardDateRange): Promise<{ meta: number; google: number }> {
    const result = await this.pool.query(
      `SELECT
          SUM(CASE WHEN platform = 'meta' THEN spend_amount ELSE 0 END)::float AS meta_spend,
          SUM(CASE WHEN platform IN ('google', 'google_ads') THEN spend_amount ELSE 0 END)::float AS google_spend
       FROM daily_ad_performance
       WHERE report_date BETWEEN $1::date AND $2::date`,
      [range.startDate, range.endDate]
    );
    return {
      meta: numberValue(result.rows[0]?.meta_spend),
      google: numberValue(result.rows[0]?.google_spend)
    };
  }

  private async leadsBySource(range: DashboardDateRange): Promise<Record<DashboardSourceRow["source"], number>> {
    const result = await this.pool.query(
      `SELECT original_lead_source AS source, COUNT(*)::int AS count
       FROM opportunities
       WHERE original_lead_date::date BETWEEN $1::date AND $2::date
       GROUP BY original_lead_source`,
      [range.startDate, range.endDate]
    );
    return sourceCountMap(result.rows, "source", "count");
  }

  private async newRecurringCustomers(range: DashboardDateRange): Promise<{ total: number; mrrAdded: number | null }> {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count,
              SUM(monthly_recurring_revenue)::float AS mrr_added,
              COUNT(monthly_recurring_revenue)::int AS priced_count
       FROM customers
       WHERE first_recurring_date BETWEEN $1::date AND $2::date`,
      [range.startDate, range.endDate]
    );
    const row = result.rows[0] ?? {};
    return {
      total: integerValue(row.count),
      mrrAdded: integerValue(row.priced_count) > 0 ? numberValue(row.mrr_added) : null
    };
  }

  private async cancellations(range: DashboardDateRange): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count
       FROM cancellations
       WHERE cancelled_on BETWEEN $1::date AND $2::date`,
      [range.startDate, range.endDate]
    );
    return integerValue(result.rows[0]?.count);
  }
}

export class EmptyDashboardDataSource implements DashboardDataSource {
  async getSummary(range: DashboardDateRange): Promise<DashboardSummary> {
    return {
      range,
      totalAdSpend: 0,
      metaSpend: 0,
      googleSpend: 0,
      facebookLeads: 0,
      websiteLeads: 0,
      otherLeads: 0,
      totalLeads: 0,
      newRecurringCustomers: 0,
      costPerLead: null,
      costPerNewRecurringCustomer: null,
      estimatedMrrAdded: null,
      cancellations: 0,
      netRecurringCustomerGrowth: 0,
      closeRate: null,
      dataNotes: ["No database connection is configured."]
    };
  }

  async getTrends(range: DashboardDateRange): Promise<DashboardTrendPoint[]> {
    return enumerateDates(range.startDate, range.endDate).map((date) => ({
      date,
      metaSpend: 0,
      googleSpend: 0,
      totalSpend: 0,
      facebookLeads: 0,
      websiteLeads: 0,
      totalLeads: 0,
      newRecurringCustomers: 0,
      costPerLead: null,
      costPerNewRecurringCustomer: null
    }));
  }

  async getSources(): Promise<DashboardSources> {
    return {
      leadSources: SOURCES.map((source) => ({ source, leads: 0, newRecurringCustomers: 0 })),
      campaignPerformance: [],
      unmatchedLeads: {
        count: 0,
        note: "Lead to customer matching is coming next."
      },
      matchingStatus: "Lead to customer matching: coming next"
    };
  }

  async getSyncHealth(): Promise<DashboardSyncHealth> {
    return { rows: [] };
  }
}

function indexByDate(rows: Array<Record<string, unknown>>): Map<string, Record<string, unknown>> {
  return new Map(rows.map((row) => [String(row.date), row]));
}

function sourceCountMap(
  rows: Array<Record<string, unknown>>,
  sourceKey: string,
  countKey: string
): Record<DashboardSourceRow["source"], number> {
  const output = { facebook: 0, website: 0, other: 0, unknown: 0 };
  for (const row of rows) {
    const source = normalizeSource(row[sourceKey]);
    output[source] += integerValue(row[countKey]);
  }
  return output;
}

function normalizeSource(value: unknown): DashboardSourceRow["source"] {
  if (value === "facebook" || value === "website" || value === "other") {
    return value;
  }
  return "unknown";
}

function dataNotes(input: {
  googleSpend: number;
  totalLeads: number;
  newRecurringCustomers: number;
  estimatedMrrAdded: number | null;
  sweepAndGoLiveWebhookProcessingActive?: boolean;
}): string[] {
  const notes: string[] = [];
  if (input.sweepAndGoLiveWebhookProcessingActive) {
    notes.push("Sweep&Go live webhook processing is active for safe customer status, subscription, and cancellation signals.");
  }
  if (input.googleSpend === 0) {
    notes.push("Google Ads live reads are not connected yet or have no spend for this range.");
  }
  if (input.totalLeads === 0) {
    notes.push("No GoHighLevel leads found for this range.");
  }
  if (input.newRecurringCustomers === 0) {
    notes.push("No new recurring Sweep&Go customers found for this range.");
  }
  if (input.estimatedMrrAdded === null) {
    notes.push("MRR added is unavailable until recurring price fields are confirmed.");
  }
  notes.push("Close rate is deferred until safe lead-to-customer matching is complete.");
  return notes;
}

function integerValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isoString(value: unknown): string | undefined {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function syncStaleWarning(provider: string, startedAt: unknown): string | undefined {
  if (provider !== "sweepandgo") {
    return undefined;
  }

  const startedAtDate = dateValue(startedAt);
  if (!startedAtDate) {
    return "Sweep&Go customer sync has never run. Customer KPIs may be stale.";
  }

  const ageMs = Date.now() - startedAtDate.getTime();
  if (ageMs > 24 * 60 * 60 * 1000) {
    return "Sweep&Go customer sync is older than 24 hours. Customer KPIs may be stale.";
  }

  return undefined;
}

function dateValue(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
