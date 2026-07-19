import { enumerateDates, type DashboardDateRange } from "./dateRange.ts";
import type {
  DashboardCampaignRow,
  DashboardAdProviderStatus,
  DashboardCloseRateMetrics,
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
const DASHBOARD_LEAD_EXCLUSION_METRICS = "ARRAY['lead_denominator', 'dashboard_leads']";

export class PostgresDashboardDataSource implements DashboardDataSource {
  private readonly pool: Queryable;

  constructor(pool: Queryable) {
    this.pool = pool;
  }

  async getSummary(range: DashboardDateRange): Promise<DashboardSummary> {
    const [adSpend, leads, customers, activeCustomers, cancellations, closeRateMetricsBase, googleAdsStatus] = await Promise.all([
      this.adSpendByPlatform(range),
      this.leadsBySource(range),
      this.newRecurringCustomers(range),
      this.activeRecurringCustomers(),
      this.cancellations(range),
      this.closeRateMetrics(range),
      this.googleAdsStatus()
    ]);

    const facebookLeads = leads.facebook;
    const websiteLeads = leads.website;
    const otherLeads = leads.other + leads.unknown;
    const totalLeads = facebookLeads + websiteLeads + otherLeads;
    const newRecurringCustomers = customers.total;
    const totalAdSpend = adSpend.meta + adSpend.google;
    const estimatedMrrAdded = customers.mrrAdded === null ? null : roundMoney(customers.mrrAdded);
    const costPerNewCustomer = costPerNewRecurringCustomer(totalAdSpend, newRecurringCustomers);
    const activeMrrAvailable = activeCustomers.activeClients > 0
      && activeCustomers.pricedActiveClients === activeCustomers.activeClients;
    const estimatedActiveMrr = activeMrrAvailable ? roundMoney(activeCustomers.activeMrr) : null;
    const averageMonthlyTicket = activeMrrAvailable
      ? roundMoney(activeCustomers.activeMrr / activeCustomers.activeClients)
      : null;
    const activeMrrUnavailableReason = activeMrrAvailable
      ? undefined
      : "Active recurring monthly subscription amounts are not available yet.";
    const closeRateMetrics = {
      ...closeRateMetricsBase,
      costPerNewCustomerStatus: costPerNewCustomer.status
    };

    return {
      range,
      totalAdSpend: roundMoney(totalAdSpend),
      metaSpend: roundMoney(adSpend.meta),
      googleSpend: roundMoney(adSpend.google),
      googleAdsStatus,
      facebookLeads,
      websiteLeads,
      otherLeads,
      totalLeads,
      totalActiveClients: activeCustomers.asOf ? activeCustomers.activeClients : null,
      totalActiveClientsSource: "Sweep&Go BI customers where status is active and at least one recurring service is present.",
      totalActiveClientsAsOf: activeCustomers.asOf,
      totalActiveClientsNeedsVerification: !activeCustomers.asOf,
      newRecurringCustomers,
      costPerLead: totalLeads > 0 ? roundMoney(totalAdSpend / totalLeads) : null,
      costPerNewRecurringCustomer: costPerNewCustomer.value,
      costPerNewRecurringCustomerStatus: costPerNewCustomer.status,
      costPerNewRecurringCustomerNote: costPerNewCustomer.note,
      estimatedActiveMrr,
      estimatedActiveMrrReason: activeMrrUnavailableReason
        ? "Estimated MRR is unavailable until active recurring subscription amounts are captured from Sweep&Go subscriptions or another reliable recurring revenue source."
        : undefined,
      averageMonthlyTicket,
      averageMonthlyTicketReason: activeMrrUnavailableReason,
      estimatedMrrAdded,
      cancellations,
      netRecurringCustomerGrowth: newRecurringCustomers - cancellations,
      closeRate: closeRateMetrics.totalCloseRate,
      closeRateMetrics,
      dataNotes: dataNotes({
        googleAdsStatus,
        totalLeads,
        newRecurringCustomers,
        estimatedActiveMrr,
        averageMonthlyTicket,
        closeRateMetrics,
        costPerNewRecurringCustomerStatus: costPerNewCustomer.status,
        costPerNewRecurringCustomerNote: costPerNewCustomer.note,
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
         FROM opportunities o
         WHERE o.original_lead_date::date BETWEEN $1::date AND $2::date
           AND original_lead_source IN ('facebook', 'website', 'other', 'unknown')
           AND ${reportingLeadExclusionSql("o")}
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
         FROM opportunities o
         WHERE o.original_lead_date::date BETWEEN $1::date AND $2::date
           AND ${reportingLeadExclusionSql("o")}
         GROUP BY o.original_lead_source`,
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
         FROM opportunities o
         WHERE o.original_lead_date::date BETWEEN $1::date AND $2::date
           AND o.original_lead_source IN ('facebook', 'website')
           AND o.contact_id IS NULL
           AND ${reportingLeadExclusionSql("o")}`,
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
        note: "Unmatched lead count uses GoHighLevel lead records without a linked BI contact."
      },
      matchingStatus: "Close rate uses stored stable lead-to-customer matches only."
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

  private async googleAdsStatus(): Promise<DashboardAdProviderStatus> {
    const result = await this.pool.query(
      `SELECT
          EXISTS (
            SELECT 1
            FROM sync_runs
            WHERE provider = 'google_ads'
              AND status = 'completed'
          ) AS has_successful_sync,
          EXISTS (
            SELECT 1
            FROM daily_ad_performance
            WHERE platform IN ('google', 'google_ads')
          ) AS has_historical_performance,
          (
            SELECT status
            FROM sync_runs
            WHERE provider = 'google_ads'
            ORDER BY started_at DESC
            LIMIT 1
          ) AS latest_status
       `
    );
    const row = result.rows[0] ?? {};
    const hasSuccessfulSync = Boolean(row.has_successful_sync);
    const hasHistoricalPerformance = Boolean(row.has_historical_performance);
    const latestStatus = stringValue(row.latest_status);
    const latestFailed = latestStatus === "failed";
    const connected = hasSuccessfulSync || hasHistoricalPerformance;
    return {
      connected,
      latestStatus,
      latestFailed,
      hasHistoricalPerformance,
      warning: latestFailed
        ? "Latest Google Ads sync failed. Stored spend remains visible; check Sync Health for the current sync issue."
        : undefined
    };
  }

  private async leadsBySource(range: DashboardDateRange): Promise<Record<DashboardSourceRow["source"], number>> {
    const result = await this.pool.query(
      `SELECT original_lead_source AS source, COUNT(*)::int AS count
       FROM opportunities o
       WHERE o.original_lead_date::date BETWEEN $1::date AND $2::date
         AND ${reportingLeadExclusionSql("o")}
       GROUP BY o.original_lead_source`,
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

  private async activeRecurringCustomers(): Promise<{
    activeClients: number;
    activeMrr: number;
    pricedActiveClients: number;
    asOf?: string;
  }> {
    const result = await this.pool.query(
      `SELECT COUNT(DISTINCT c.id)::int AS active_clients,
              COALESCE(SUM(c.monthly_recurring_revenue), 0)::float AS active_mrr,
              COUNT(DISTINCT c.id) FILTER (WHERE c.monthly_recurring_revenue IS NOT NULL)::int AS priced_active_clients,
              (
                SELECT started_at
                FROM sync_runs
                WHERE provider = 'sweepandgo'
                  AND status = 'completed'
                ORDER BY started_at DESC
                LIMIT 1
              ) AS latest_sweepandgo_sync_started_at
       FROM customers c
       WHERE c.status = 'active'
         AND EXISTS (
           SELECT 1
           FROM customer_services cs
           WHERE cs.customer_id = c.id
             AND cs.cadence = 'recurring'
             AND (cs.ended_on IS NULL OR cs.ended_on > CURRENT_DATE)
         )`
    );
    const row = result.rows[0] ?? {};
    return {
      activeClients: integerValue(row.active_clients),
      activeMrr: numberValue(row.active_mrr),
      pricedActiveClients: integerValue(row.priced_active_clients),
      asOf: isoString(row.latest_sweepandgo_sync_started_at)
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

  private async closeRateMetrics(range: DashboardDateRange): Promise<DashboardCloseRateMetrics> {
    const [leadRows, matchRows] = await Promise.all([
      this.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE original_lead_source = 'facebook')::int AS facebook_leads,
           COUNT(*) FILTER (WHERE original_lead_source = 'website')::int AS website_leads
         FROM opportunities o
         WHERE o.original_lead_date::date BETWEEN $1::date AND $2::date
           AND o.original_lead_source IN ('facebook', 'website')
           AND ${reportingLeadExclusionSql("o")}`,
        [range.startDate, range.endDate]
      ),
      this.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'matched' AND lead_source = 'facebook')::int AS facebook_matched,
           COUNT(*) FILTER (WHERE status = 'matched' AND lead_source = 'website')::int AS website_matched,
           COUNT(*) FILTER (WHERE status = 'matched')::int AS total_matched,
           COUNT(*) FILTER (WHERE status = 'review')::int AS manual_review
         FROM lead_customer_matches
         WHERE lead_date BETWEEN $1::date AND $2::date`,
        [range.startDate, range.endDate]
      )
    ]);
    const leadRow = leadRows.rows[0] ?? {};
    const matchRow = matchRows.rows[0] ?? {};
    const facebookLeads = integerValue(leadRow.facebook_leads);
    const websiteLeads = integerValue(leadRow.website_leads);
    const facebookMatchedConversions = integerValue(matchRow.facebook_matched);
    const websiteMatchedConversions = integerValue(matchRow.website_matched);
    const totalMatchedConversions = integerValue(matchRow.total_matched);

    return {
      facebookMatchedConversions,
      websiteMatchedConversions,
      totalMatchedConversions,
      manualReviewConversions: integerValue(matchRow.manual_review),
      facebookCloseRate: percentage(facebookMatchedConversions, facebookLeads),
      websiteCloseRate: percentage(websiteMatchedConversions, websiteLeads),
      totalCloseRate: percentage(totalMatchedConversions, facebookLeads + websiteLeads),
      costPerNewCustomerStatus: "unavailable_incomplete_spend_coverage"
    };
  }
}

export class EmptyDashboardDataSource implements DashboardDataSource {
  async getSummary(range: DashboardDateRange): Promise<DashboardSummary> {
    return {
      range,
      totalAdSpend: 0,
      metaSpend: 0,
      googleSpend: 0,
      googleAdsStatus: disconnectedGoogleAdsStatus(),
      facebookLeads: 0,
      websiteLeads: 0,
      otherLeads: 0,
      totalLeads: 0,
      totalActiveClients: null,
      totalActiveClientsSource: "No database connection is configured.",
      totalActiveClientsNeedsVerification: true,
      newRecurringCustomers: 0,
      costPerLead: null,
      costPerNewRecurringCustomer: 0,
      costPerNewRecurringCustomerStatus: "no_ad_spend",
      costPerNewRecurringCustomerNote: "No ad spend",
      estimatedActiveMrr: null,
      estimatedActiveMrrReason: "Estimated MRR is unavailable until active recurring subscription amounts are captured from Sweep&Go subscriptions or another reliable recurring revenue source.",
      averageMonthlyTicket: null,
      averageMonthlyTicketReason: "Active recurring monthly subscription amounts are not available yet.",
      estimatedMrrAdded: null,
      cancellations: 0,
      netRecurringCustomerGrowth: 0,
      closeRate: null,
      closeRateMetrics: emptyCloseRateMetrics(),
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
        note: "No database connection is configured."
      },
      matchingStatus: "No database connection is configured."
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

function reportingLeadExclusionSql(alias: string): string {
  return `NOT EXISTS (
    SELECT 1
    FROM reporting_exclusions re
    WHERE re.provider = 'gohighlevel'
      AND re.entity_type = 'opportunity'
      AND re.entity_external_id = ${alias}.external_opportunity_id
      AND re.applies_to_metric && ${DASHBOARD_LEAD_EXCLUSION_METRICS}
  )`;
}

function dataNotes(input: {
  googleAdsStatus: DashboardAdProviderStatus;
  totalLeads: number;
  newRecurringCustomers: number;
  estimatedActiveMrr: number | null;
  averageMonthlyTicket: number | null;
  closeRateMetrics: DashboardCloseRateMetrics;
  costPerNewRecurringCustomerStatus: "available" | "no_ad_spend" | "no_new_customers";
  costPerNewRecurringCustomerNote: string;
  sweepAndGoLiveWebhookProcessingActive?: boolean;
}): string[] {
  const notes: string[] = [];
  if (input.sweepAndGoLiveWebhookProcessingActive) {
    notes.push("Sweep&Go live webhook processing is active for safe customer status, subscription, and cancellation signals.");
  }
  if (!input.googleAdsStatus.connected) {
    notes.push("Google Ads is not connected yet. Add a successful sync or stored performance rows to enable Google spend reporting.");
  } else if (input.googleAdsStatus.latestFailed) {
    notes.push(input.googleAdsStatus.warning ?? "Latest Google Ads sync failed. Stored spend remains visible; check Sync Health for details.");
  }
  if (input.totalLeads === 0) {
    notes.push("No GoHighLevel leads found for this range.");
  }
  if (input.newRecurringCustomers === 0) {
    notes.push("No new recurring Sweep&Go customers found for this range.");
  }
  if (input.estimatedActiveMrr === null) {
    notes.push("Estimated MRR is unavailable until active recurring subscription amounts are captured from Sweep&Go subscriptions or another reliable recurring revenue source.");
  }
  if (input.averageMonthlyTicket === null) {
    notes.push("Average monthly ticket is unavailable until active recurring monthly subscription amounts are available for active clients.");
  }
  if (input.costPerNewRecurringCustomerStatus !== "available") {
    notes.push(`Cost per new customer note: ${input.costPerNewRecurringCustomerNote}.`);
  }
  notes.push("Close rate uses stored stable GoHighLevel lead-to-customer matches only; manual review rows are not counted as conversions.");
  return notes;
}

function disconnectedGoogleAdsStatus(): DashboardAdProviderStatus {
  return {
    connected: false,
    latestFailed: false,
    hasHistoricalPerformance: false
  };
}

function emptyCloseRateMetrics(): DashboardCloseRateMetrics {
  return {
    facebookMatchedConversions: 0,
    websiteMatchedConversions: 0,
    totalMatchedConversions: 0,
    manualReviewConversions: 0,
    facebookCloseRate: null,
    websiteCloseRate: null,
    totalCloseRate: null,
    costPerNewCustomerStatus: "no_ad_spend"
  };
}

function integerValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentage(part: number, total: number): number | null {
  if (total === 0 && part === 0) {
    return 0;
  }
  return total > 0 ? Math.round((part / total) * 10000) / 100 : null;
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

function costPerNewRecurringCustomer(
  totalAdSpend: number,
  newRecurringCustomers: number
): { value: number | null; status: "available" | "no_ad_spend" | "no_new_customers"; note: string } {
  if (totalAdSpend === 0) {
    return {
      value: 0,
      status: "no_ad_spend",
      note: "No ad spend"
    };
  }
  if (newRecurringCustomers === 0) {
    return {
      value: null,
      status: "no_new_customers",
      note: "No new customers"
    };
  }
  return {
    value: roundMoney(totalAdSpend / newRecurringCustomers),
    status: "available",
    note: "Ad spend divided by new recurring customers"
  };
}
