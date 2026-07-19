import { enumerateDates, type DashboardDateRange } from "./dateRange.ts";
import { calculateCompletedJobRevenueMetrics, calculateCompletedJobRevenueMetricsFromFacts } from "./serviceRevenue.ts";
import type {
  DashboardCampaignRow,
  DashboardAdProviderStatus,
  DashboardCancellationMetrics,
  DashboardCloseRateMetrics,
  DashboardCostPerNewCustomerStatus,
  DashboardDataSource,
  DashboardRevenuePerHourMetrics,
  DashboardRevenuePerShiftHourMetrics,
  DashboardSourceBreakdown,
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
export const TEMP_AVERAGE_MONTHLY_TICKET = 95;
const SWEEPGO_EMPLOYEE_NAMES: Record<string, string> = {
  "5501": "Bryan Long",
  "9638": "Alejandro Hinostroza",
  "11329": "Johnny Brown"
};
const OWNER_CONFIRMED_CHURN_BASELINES = [
  {
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    activeCustomersAtStart: 252,
    note: "July churn uses owner-confirmed starting active count of 252 because historical active roster snapshot was not available."
  }
] as const;

type PayrollShiftRow = {
  employeeId?: string;
  shiftId?: string;
  shiftDate?: string;
  durationMinutes?: number;
  receivedAt?: string;
};

type NewRecurringCustomerMetrics = {
  total: number;
  mrrAdded: number | null;
  bySource: DashboardSourceBreakdown;
};

type ChurnDenominator = {
  count: number;
  note?: string;
};

export class PostgresDashboardDataSource implements DashboardDataSource {
  private readonly pool: Queryable;

  constructor(pool: Queryable) {
    this.pool = pool;
  }

  async getSummary(range: DashboardDateRange): Promise<DashboardSummary> {
    const [
      adSpend,
      leads,
      customers,
      activeCustomers,
      cancellations,
      churnDenominator,
      revenuePerHourMetrics,
      closeRateMetricsBase,
      googleAdsStatus
    ] = await Promise.all([
      this.adSpendByPlatform(range),
      this.leadsBySource(range),
      this.newRecurringCustomers(range),
      this.activeRecurringCustomers(),
      this.cancellations(range),
      this.activeCustomersAtRangeStart(range),
      this.revenuePerHourMetrics(range),
      this.closeRateMetrics(range),
      this.googleAdsStatus()
    ]);
    const priorPeriodLeadConversions = closeRateMetricsBase.totalPriorPeriodLeadConversions;

    const leadBreakdown = { ...leads };
    const recurringBreakdown = { ...customers.bySource };
    const facebookLeads = leadBreakdown.facebook;
    const websiteLeads = leadBreakdown.website;
    const otherLeads = leadBreakdown.other + leadBreakdown.unknown;
    const totalLeads = facebookLeads + websiteLeads + otherLeads;
    const newRecurringCustomers = customers.total + priorPeriodLeadConversions;
    const totalAdSpend = adSpend.meta + adSpend.google;
    const estimatedMrrAdded = customers.mrrAdded === null ? null : roundMoney(customers.mrrAdded);
    const costPerNewCustomer = costPerNewRecurringCustomer(totalAdSpend, newRecurringCustomers);
    const churnRate = churnDenominator.count > 0 ? percentage(cancellations.countedCancellations, churnDenominator.count) : null;
    const churnRateDecimal = churnRate === null ? null : churnRate / 100;
    const lifetimeValue = churnRateDecimal && churnRateDecimal > 0
      ? roundMoney(TEMP_AVERAGE_MONTHLY_TICKET / churnRateDecimal)
      : null;
    const averageRevenuePerHour = revenuePerHourMetrics.status === "available" && revenuePerHourMetrics.serviceHours > 0
      ? roundMoney(revenuePerHourMetrics.serviceRevenue / revenuePerHourMetrics.serviceHours)
      : null;
    const revenuePerShiftHourMetrics = await this.revenuePerShiftHourMetrics(range, revenuePerHourMetrics);
    const averageRevenuePerShiftHour = revenuePerShiftHourMetrics.revenuePerShiftHour;
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
      leadBreakdown,
      totalLeads,
      totalActiveClients: activeCustomers.asOf ? activeCustomers.activeClients : null,
      totalActiveClientsSource: activeCustomers.source,
      totalActiveClientsAsOf: activeCustomers.asOf,
      totalActiveClientsNeedsVerification: activeCustomers.needsVerification,
      newRecurringCustomers,
      newRecurringCustomerBreakdown: recurringBreakdown,
      costPerLead: totalLeads > 0 ? roundMoney(totalAdSpend / totalLeads) : null,
      costPerNewRecurringCustomer: costPerNewCustomer.value,
      costPerNewRecurringCustomerStatus: costPerNewCustomer.status,
      costPerNewRecurringCustomerNote: costPerNewCustomer.note,
      estimatedActiveMrr: null,
      estimatedActiveMrrReason: undefined,
      averageMonthlyTicket: TEMP_AVERAGE_MONTHLY_TICKET,
      averageMonthlyTicketReason: "Temporary configured constant. Update the dashboard config when the business chooses a new average ticket.",
      estimatedMrrAdded,
      cancellations: cancellations.countedCancellations,
      cancellationMetrics: cancellations,
      churnRate,
      churnRateDenominator: churnDenominator.count,
      churnRateReason: churnDenominator.count > 0
        ? `${cancellations.countedCancellations} counted cancellations divided by ${churnDenominator.count} customers active at the start of the selected range.`
        : "Churn unavailable because customers active at the start of the selected range could not be calculated.",
      lifetimeValue,
      lifetimeValueReason: lifetimeValue === null
        ? "Lifetime value unavailable when churn is zero or unavailable."
        : "Average Monthly Ticket divided by Monthly Churn Rate.",
      averageRevenuePerHour,
      averageRevenuePerHourReason: averageRevenuePerHour === null
        ? (revenuePerHourMetrics.unavailableReason ?? "Revenue Per Recurring Service Hour unavailable until stored Sweep&Go completed job rows include recurring service revenue and duration.")
        : "Recurring completed job revenue divided by adjusted recurring service time. Initial, one-time, custom, skipped, missed, canceled, and missing-price jobs are excluded.",
      revenuePerHourMetrics,
      averageRevenuePerShiftHour,
      averageRevenuePerShiftHourReason: averageRevenuePerShiftHour === null
        ? (revenuePerShiftHourMetrics.unavailableReason ?? "Revenue Per Recurring Shift Hour unavailable until stored Sweep&Go payroll shift rows include usable shift duration.")
        : "Recurring completed job revenue divided by recorded shift hours after removing initial and one-time cleanup job time. Includes route, drive, break, and admin time for normal recurring work.",
      revenuePerShiftHourMetrics,
      priorPeriodLeadConversions,
      netRecurringCustomerGrowth: newRecurringCustomers - cancellations.countedCancellations,
      closeRate: closeRateMetrics.totalCloseRate,
      closeRateMetrics,
      dataNotes: dataNotes({
        googleAdsStatus,
        totalLeads,
        newRecurringCustomers,
        churnRate,
        lifetimeValue,
        revenuePerHourMetrics,
        revenuePerShiftHourMetrics,
        closeRateMetrics,
        churnDenominatorNote: churnDenominator.note,
        cancellationMetrics: cancellations,
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

  private async newRecurringCustomers(range: DashboardDateRange): Promise<NewRecurringCustomerMetrics> {
    const result = await this.pool.query(
      `SELECT COALESCE(source, 'unknown') AS source,
              COUNT(*)::int AS count,
              SUM(monthly_recurring_revenue)::float AS mrr_added,
              COUNT(monthly_recurring_revenue)::int AS priced_count
       FROM customers
       WHERE first_recurring_date BETWEEN $1::date AND $2::date
       GROUP BY COALESCE(source, 'unknown')`,
      [range.startDate, range.endDate]
    );
    const bySource = sourceCountMap(result.rows, "source", "count");
    const pricedCount = result.rows.reduce((sum, row) => sum + integerValue(row.priced_count), 0);
    const mrrAdded = result.rows.reduce((sum, row) => sum + numberValue(row.mrr_added), 0);
    return {
      total: bySource.facebook + bySource.website + bySource.other + bySource.unknown,
      mrrAdded: pricedCount > 0 ? mrrAdded : null,
      bySource
    };
  }

  private async activeRecurringCustomers(): Promise<{
    activeClients: number;
    activeMrr: number;
    pricedActiveClients: number;
    source: string;
    needsVerification: boolean;
    asOf?: string;
  }> {
    const snapshotTable = await this.pool.query("SELECT to_regclass('public.sweepandgo_active_roster_snapshots') AS table_name");
    if (snapshotTable.rows[0]?.table_name) {
      const snapshotResult = await this.pool.query(
        `SELECT active_client_count,
                derived_active_recurring_count,
                updated_at
         FROM sweepandgo_active_roster_snapshots
         ORDER BY snapshot_date DESC, updated_at DESC
         LIMIT 1`
      );
      const snapshot = snapshotResult.rows[0];
      if (snapshot) {
        const mrrResult = await this.pool.query(
          `SELECT COALESCE(SUM(c.monthly_recurring_revenue), 0)::float AS active_mrr,
                  COUNT(DISTINCT c.id) FILTER (WHERE c.monthly_recurring_revenue IS NOT NULL)::int AS priced_active_clients
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
        const mrrRow = mrrResult.rows[0] ?? {};
        return {
          activeClients: integerValue(snapshot.active_client_count),
          activeMrr: numberValue(mrrRow.active_mrr),
          pricedActiveClients: integerValue(mrrRow.priced_active_clients),
          source: "Latest Sweep&Go active roster snapshot from the official active client count.",
          needsVerification: false,
          asOf: isoString(snapshot.updated_at)
        };
      }
    }

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
      source: "Sweep&Go BI customers where status is active and at least one recurring service is present.",
      needsVerification: !row.latest_sweepandgo_sync_started_at,
      asOf: isoString(row.latest_sweepandgo_sync_started_at)
    };
  }

  private async cancellations(range: DashboardDateRange): Promise<DashboardCancellationMetrics> {
    const result = await this.pool.query(
      `WITH cancellation_rows AS (
         SELECT
           COALESCE(cn.customer_id::text, cn.external_sweepgo_id, cn.id::text) AS cancellation_key,
           COALESCE(c.status, 'missing') AS customer_status,
           COALESCE(cn.metadata->>'eventType', cn.metadata->>'event_type', '') AS event_type
         FROM cancellations cn
         LEFT JOIN customers c ON c.id = cn.customer_id
         WHERE cn.cancelled_on BETWEEN $1::date AND $2::date
       ),
       grouped AS (
         SELECT
           cancellation_key,
           MAX(customer_status) AS customer_status,
           COUNT(*)::int AS row_count,
           BOOL_OR(event_type ILIKE '%pause%') AS has_pause_signal
         FROM cancellation_rows
         GROUP BY cancellation_key
       )
       SELECT
         COUNT(*) FILTER (WHERE customer_status = 'inactive')::int AS counted_cancellations,
         COALESCE(SUM(row_count), 0)::int AS raw_cancellation_rows,
         COUNT(*)::int AS unique_cancellation_candidates,
         COALESCE(SUM(row_count - 1), 0)::int AS duplicate_rows_excluded,
         COUNT(*) FILTER (WHERE customer_status = 'active')::int AS subscription_only_active_excluded,
         COUNT(*) FILTER (WHERE has_pause_signal AND customer_status <> 'inactive')::int AS pause_rows_excluded,
         COUNT(*) FILTER (WHERE customer_status NOT IN ('active', 'inactive'))::int AS needs_review
       FROM grouped`,
      [range.startDate, range.endDate]
    );
    const row = result.rows[0] ?? {};
    return {
      countedCancellations: integerValue(row.counted_cancellations),
      rawCancellationRows: integerValue(row.raw_cancellation_rows),
      uniqueCancellationCandidates: integerValue(row.unique_cancellation_candidates),
      duplicateRowsExcluded: integerValue(row.duplicate_rows_excluded),
      subscriptionOnlyActiveExcluded: integerValue(row.subscription_only_active_excluded),
      pauseRowsExcluded: integerValue(row.pause_rows_excluded),
      needsReview: integerValue(row.needs_review)
    };
  }

  private async activeCustomersAtRangeStart(range: DashboardDateRange): Promise<ChurnDenominator> {
    const snapshotTable = await this.pool.query("SELECT to_regclass('public.sweepandgo_active_roster_snapshots') AS table_name");
    if (snapshotTable.rows[0]?.table_name) {
      const snapshotResult = await this.pool.query(
        `SELECT active_client_count,
                snapshot_date::text AS snapshot_date
         FROM sweepandgo_active_roster_snapshots
         WHERE snapshot_date <= $1::date
         ORDER BY snapshot_date DESC, updated_at DESC
         LIMIT 1`,
        [range.startDate]
      );
      const snapshot = snapshotResult.rows[0];
      if (snapshot) {
        const count = integerValue(snapshot.active_client_count);
        return {
          count,
          note: `Churn denominator uses the Sweep&Go active roster snapshot from ${stringValue(snapshot.snapshot_date) ?? range.startDate}.`
        };
      }
    }

    const ownerBaseline = OWNER_CONFIRMED_CHURN_BASELINES.find((baseline) =>
      range.startDate >= baseline.startDate && range.startDate <= baseline.endDate
    );
    if (ownerBaseline) {
      return {
        count: ownerBaseline.activeCustomersAtStart,
        note: ownerBaseline.note
      };
    }

    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS active_at_start
       FROM customers
       WHERE first_recurring_date IS NOT NULL
         AND first_recurring_date < $1::date
         AND (cancellation_date IS NULL OR cancellation_date >= $1::date)`,
      [range.startDate]
    );
    return {
      count: integerValue(result.rows[0]?.active_at_start),
      note: "Churn denominator uses BI customer first recurring and cancellation dates because no active roster snapshot was available for the selected start date."
    };
  }

  private async revenuePerHourMetrics(range: DashboardDateRange): Promise<DashboardRevenuePerHourMetrics> {
    const completedJobsTable = await this.pool.query("SELECT to_regclass('public.sweepandgo_completed_jobs') AS table_name");
    if (completedJobsTable.rows[0]?.table_name) {
      const factRows = await this.pool.query(
        `SELECT service_date::text AS "serviceDate",
                technician_key AS "technicianKey",
                stop_fingerprint AS "stopFingerprint",
                job_status AS "jobStatus",
                job_type AS "jobType",
                allocated_service_price::float AS "allocatedServicePrice",
                recorded_duration_minutes::float AS "recordedDurationMinutes",
                is_spray AS "isSpray",
                is_initial AS "isInitial"
         FROM sweepandgo_completed_jobs
         WHERE service_date BETWEEN $1::date AND $2::date
         ORDER BY service_date, technician_key, stop_fingerprint`,
        [range.startDate, range.endDate]
      );
      return calculateCompletedJobRevenueMetricsFromFacts(factRows.rows, range);
    }

    const result = await this.pool.query(
      `SELECT payload,
              received_at AS "receivedAt"
       FROM webhook_events
       WHERE event_type = 'job:completed'
         AND processing_status <> 'failed'
       ORDER BY received_at`,
      []
    );

    return calculateCompletedJobRevenueMetrics(result.rows.map((row) => ({
      payload: row.payload,
      receivedAt: row.receivedAt
    })), range);
  }

  private async revenuePerShiftHourMetrics(
    range: DashboardDateRange,
    revenuePerHourMetrics: DashboardRevenuePerHourMetrics
  ): Promise<DashboardRevenuePerShiftHourMetrics> {
    const result = await this.pool.query(
      `SELECT id::text AS id,
              event_type AS "eventType",
              received_at::text AS "receivedAt",
              processing_status AS "processingStatus",
              payload,
              event_fingerprint AS "eventFingerprint"
       FROM webhook_events
       WHERE event_type IN ('payroll:shift_info', 'staff:staff_clock_in')
         AND processing_status <> 'failed'
         AND (
           payload->'data'->>'shift_date' BETWEEN $1::text AND $2::text
           OR (
             payload->'data'->>'shift_date' IS NULL
             AND received_at::date BETWEEN $1::date AND $2::date
           )
         )
       ORDER BY received_at`,
      [range.startDate, range.endDate]
    );

    const payrollRows = result.rows.filter((row) => stringValue(row.eventType) === "payroll:shift_info");
    const rawShiftRows = payrollRows.length;
    if (rawShiftRows === 0) {
      return {
        serviceRevenue: revenuePerHourMetrics.serviceRevenue,
        shiftHours: 0,
        unadjustedShiftHours: 0,
        initialCleanupHoursSubtracted: 0,
        oneTimeCleanupHoursSubtracted: 0,
        otherNonRecurringHoursSubtracted: 0,
        rawShiftRows,
        dedupedShiftRows: 0,
        duplicateShiftRowsExcluded: 0,
        technicianShiftHours: [],
        revenuePerShiftHour: null,
        status: "unavailable",
        unavailableReason: "No stored Sweep&Go payroll shift rows were available for the selected range."
      };
    }

    const dedupedShifts = dedupePayrollShifts(payrollRows
      .map(parsePayrollShiftRow)
      .filter((shift) => shift.shiftDate && shift.shiftDate >= range.startDate && shift.shiftDate <= range.endDate));
    const shiftMinutes = dedupedShifts.reduce((sum, shift) => sum + (shift.durationMinutes ?? 0), 0);
    const unadjustedShiftHours = roundMoney(shiftMinutes / 60);
    const initialCleanupHoursSubtracted = revenuePerHourMetrics.initialCleanupHoursExcluded;
    const oneTimeCleanupHoursSubtracted = revenuePerHourMetrics.oneTimeCleanupHoursExcluded;
    const otherNonRecurringHoursSubtracted = revenuePerHourMetrics.customNonRecurringHoursExcluded;
    const shiftHours = roundMoney(Math.max(
      0,
      unadjustedShiftHours
        - initialCleanupHoursSubtracted
        - oneTimeCleanupHoursSubtracted
        - otherNonRecurringHoursSubtracted
    ));
    const dedupedShiftRows = dedupedShifts.length;
    const technicianShiftHours = technicianShiftHourBreakdown(dedupedShifts);
    const revenuePerShiftHour = revenuePerHourMetrics.serviceRevenue > 0 && shiftHours > 0
      ? roundMoney(revenuePerHourMetrics.serviceRevenue / shiftHours)
      : null;

    return {
      serviceRevenue: revenuePerHourMetrics.serviceRevenue,
      shiftHours,
      unadjustedShiftHours,
      initialCleanupHoursSubtracted,
      oneTimeCleanupHoursSubtracted,
      otherNonRecurringHoursSubtracted,
      rawShiftRows,
      dedupedShiftRows,
      duplicateShiftRowsExcluded: rawShiftRows - dedupedShiftRows,
      technicianShiftHours,
      revenuePerShiftHour,
      status: revenuePerShiftHour === null ? "unavailable" : "available",
      unavailableReason: revenuePerShiftHour === null
        ? "Adjusted recurring shift hours were not positive after removing non-recurring cleanup time."
        : undefined
    };
  }

  private async closeRateMetrics(range: DashboardDateRange): Promise<DashboardCloseRateMetrics> {
    const [leadRows, customerRows, matchRows] = await Promise.all([
      this.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE original_lead_source = 'facebook')::int AS facebook_leads,
           COUNT(*) FILTER (WHERE original_lead_source = 'website')::int AS website_leads,
           COUNT(*) FILTER (WHERE COALESCE(original_lead_source, 'unknown') NOT IN ('facebook', 'website'))::int AS other_unknown_leads
         FROM opportunities o
         WHERE o.original_lead_date::date BETWEEN $1::date AND $2::date
           AND ${reportingLeadExclusionSql("o")}`,
        [range.startDate, range.endDate]
      ),
      this.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE source = 'facebook')::int AS facebook_customers,
           COUNT(*) FILTER (WHERE source = 'website')::int AS website_customers,
           COUNT(*) FILTER (WHERE COALESCE(source, 'unknown') NOT IN ('facebook', 'website'))::int AS other_unknown_customers
         FROM customers
         WHERE first_recurring_date BETWEEN $1::date AND $2::date`,
        [range.startDate, range.endDate]
      ),
      this.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'matched' AND lead_source = 'facebook' AND lead_date BETWEEN $1::date AND $2::date AND conversion_date > $2::date)::int AS facebook_future_lead_month_credit,
           COUNT(*) FILTER (WHERE status = 'matched' AND lead_source = 'website' AND lead_date BETWEEN $1::date AND $2::date AND conversion_date > $2::date)::int AS website_future_lead_month_credit,
           COUNT(*) FILTER (WHERE status = 'matched' AND COALESCE(lead_source, 'unknown') NOT IN ('facebook', 'website') AND lead_date BETWEEN $1::date AND $2::date AND conversion_date > $2::date)::int AS other_unknown_future_lead_month_credit,
           COUNT(*) FILTER (WHERE status = 'matched' AND lead_date BETWEEN $1::date AND $2::date AND conversion_date > $2::date)::int AS total_future_lead_month_credit,
           COUNT(*) FILTER (WHERE status = 'review' AND conversion_date BETWEEN $1::date AND $2::date)::int AS manual_review,
           COUNT(*) FILTER (WHERE status = 'matched' AND lead_source = 'facebook' AND lead_date < $1::date AND conversion_date BETWEEN $1::date AND $2::date)::int AS facebook_prior_period,
           COUNT(*) FILTER (WHERE status = 'matched' AND lead_source = 'website' AND lead_date < $1::date AND conversion_date BETWEEN $1::date AND $2::date)::int AS website_prior_period,
           COUNT(*) FILTER (WHERE status = 'matched' AND lead_date < $1::date AND conversion_date BETWEEN $1::date AND $2::date)::int AS total_prior_period
         FROM lead_customer_matches
         WHERE lead_date BETWEEN $1::date AND $2::date
            OR conversion_date BETWEEN $1::date AND $2::date`,
        [range.startDate, range.endDate]
      )
    ]);
    const leadRow = leadRows.rows[0] ?? {};
    const customerRow = customerRows.rows[0] ?? {};
    const matchRow = matchRows.rows[0] ?? {};
    const facebookLeads = integerValue(leadRow.facebook_leads);
    const websiteLeads = integerValue(leadRow.website_leads);
    const otherUnknownLeads = integerValue(leadRow.other_unknown_leads);
    const facebookMatchedConversions = integerValue(customerRow.facebook_customers) + integerValue(matchRow.facebook_future_lead_month_credit);
    const websiteMatchedConversions = integerValue(customerRow.website_customers) + integerValue(matchRow.website_future_lead_month_credit);
    const otherUnknownMatchedConversions = integerValue(customerRow.other_unknown_customers) + integerValue(matchRow.other_unknown_future_lead_month_credit);
    const totalMatchedConversions = facebookMatchedConversions + websiteMatchedConversions + otherUnknownMatchedConversions;

    return {
      facebookMatchedConversions,
      websiteMatchedConversions,
      totalMatchedConversions,
      manualReviewConversions: integerValue(matchRow.manual_review),
      facebookPriorPeriodLeadConversions: integerValue(matchRow.facebook_prior_period),
      websitePriorPeriodLeadConversions: integerValue(matchRow.website_prior_period),
      totalPriorPeriodLeadConversions: integerValue(matchRow.total_prior_period),
      facebookCloseRate: percentage(facebookMatchedConversions, facebookLeads),
      websiteCloseRate: percentage(websiteMatchedConversions, websiteLeads),
      otherUnknownCloseRate: percentage(otherUnknownMatchedConversions, otherUnknownLeads),
      totalCloseRate: percentage(totalMatchedConversions, facebookLeads + websiteLeads + otherUnknownLeads),
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
      leadBreakdown: emptySourceBreakdown(),
      totalLeads: 0,
      totalActiveClients: null,
      totalActiveClientsSource: "No database connection is configured.",
      totalActiveClientsNeedsVerification: true,
      newRecurringCustomers: 0,
      newRecurringCustomerBreakdown: emptySourceBreakdown(),
      costPerLead: null,
      costPerNewRecurringCustomer: 0,
      costPerNewRecurringCustomerStatus: "no_ad_spend",
      costPerNewRecurringCustomerNote: "No ad spend",
      estimatedActiveMrr: null,
      estimatedActiveMrrReason: undefined,
      averageMonthlyTicket: TEMP_AVERAGE_MONTHLY_TICKET,
      averageMonthlyTicketReason: "Temporary configured constant. Update the dashboard config when the business chooses a new average ticket.",
      estimatedMrrAdded: null,
      cancellations: 0,
      cancellationMetrics: emptyCancellationMetrics(),
      churnRate: null,
      churnRateDenominator: 0,
      churnRateReason: "Churn unavailable because no database connection is configured.",
      lifetimeValue: null,
      lifetimeValueReason: "Lifetime value unavailable when churn is zero or unavailable.",
      averageRevenuePerHour: null,
      averageRevenuePerHourReason: "Revenue Per Recurring Service Hour unavailable because no database connection is configured.",
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
        nonRecurringRowsExcluded: 0,
        initialCleanupRowsExcluded: 0,
        oneTimeCleanupRowsExcluded: 0,
        customNonRecurringRowsExcluded: 0,
        unknownClassificationRowsExcluded: 0,
        nonRecurringServiceHoursExcluded: 0,
        initialCleanupHoursExcluded: 0,
        oneTimeCleanupHoursExcluded: 0,
        customNonRecurringHoursExcluded: 0,
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
        unavailableReason: "No database connection is configured."
      },
      averageRevenuePerShiftHour: null,
      averageRevenuePerShiftHourReason: "Revenue Per Recurring Shift Hour unavailable because no database connection is configured.",
      revenuePerShiftHourMetrics: {
        serviceRevenue: 0,
        shiftHours: 0,
        unadjustedShiftHours: 0,
        initialCleanupHoursSubtracted: 0,
        oneTimeCleanupHoursSubtracted: 0,
        otherNonRecurringHoursSubtracted: 0,
        rawShiftRows: 0,
        dedupedShiftRows: 0,
        duplicateShiftRowsExcluded: 0,
        technicianShiftHours: [],
        revenuePerShiftHour: null,
        status: "unavailable",
        unavailableReason: "No database connection is configured."
      },
      priorPeriodLeadConversions: 0,
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
  const output = emptySourceBreakdown();
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
  churnRate: number | null;
  lifetimeValue: number | null;
  revenuePerHourMetrics: DashboardRevenuePerHourMetrics;
  revenuePerShiftHourMetrics: DashboardRevenuePerShiftHourMetrics;
  closeRateMetrics: DashboardCloseRateMetrics;
  churnDenominatorNote?: string;
  cancellationMetrics: DashboardCancellationMetrics;
  costPerNewRecurringCustomerStatus: DashboardCostPerNewCustomerStatus;
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
  notes.push(`Average Monthly Ticket is currently configured at $${TEMP_AVERAGE_MONTHLY_TICKET.toFixed(2)}.`);
  if (input.churnRate === null) {
    notes.push("Churn Rate is unavailable until customers active at the start of the selected range can be calculated.");
  }
  if (input.churnDenominatorNote) {
    notes.push(input.churnDenominatorNote);
  }
  if (input.cancellationMetrics.rawCancellationRows !== input.cancellationMetrics.countedCancellations) {
    notes.push(`Cancellation quality check: ${input.cancellationMetrics.countedCancellations} counted, ${input.cancellationMetrics.subscriptionOnlyActiveExcluded} active subscription-only candidates excluded, ${input.cancellationMetrics.duplicateRowsExcluded} duplicate rows excluded, ${input.cancellationMetrics.needsReview} candidate needs review.`);
  }
  if (input.lifetimeValue === null) {
    notes.push("Lifetime Value uses Average Monthly Ticket divided by Monthly Churn Rate; it is unavailable when churn is zero or unavailable.");
  }
  if (input.revenuePerHourMetrics.status !== "available") {
    notes.push(input.revenuePerHourMetrics.unavailableReason ?? "Revenue Per Recurring Service Hour is unavailable until stored Sweep&Go completed job rows include recurring service revenue and duration.");
  } else {
    notes.push("Revenue Per Recurring Service Hour uses recurring completed job revenue divided by adjusted recurring service time. Initial, one-time, custom, skipped, missed, canceled, and missing-price jobs are excluded.");
  }
  if (input.revenuePerShiftHourMetrics.status !== "available") {
    notes.push(input.revenuePerShiftHourMetrics.unavailableReason ?? "Revenue Per Recurring Shift Hour is unavailable until stored Sweep&Go payroll shift rows include usable shift duration.");
  } else {
    notes.push("Revenue Per Recurring Shift Hour uses recurring completed job revenue divided by deduped Sweep&Go shift hours after subtracting initial, one-time, and custom cleanup job time.");
  }
  notes.push("Initial and one-time cleanup jobs are excluded from recurring productivity.");
  if (input.closeRateMetrics.totalPriorPeriodLeadConversions > 0) {
    notes.push(`${input.closeRateMetrics.totalPriorPeriodLeadConversions} conversion(s) in this range came from leads created before the selected period; they do not increase the selected-period lead count.`);
  }
  if (input.costPerNewRecurringCustomerStatus !== "available") {
    notes.push(`Cost per new customer note: ${input.costPerNewRecurringCustomerNote}.`);
  }
  notes.push("Close rate uses new recurring customers in the selected period divided by leads created in the selected period. Website and Facebook rates use the same source-specific formula; manual review rows are not counted as conversions.");
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
    facebookPriorPeriodLeadConversions: 0,
    websitePriorPeriodLeadConversions: 0,
    totalPriorPeriodLeadConversions: 0,
    facebookCloseRate: null,
    websiteCloseRate: null,
    otherUnknownCloseRate: null,
    totalCloseRate: null,
    costPerNewCustomerStatus: "no_ad_spend"
  };
}

function emptySourceBreakdown(): DashboardSourceBreakdown {
  return { facebook: 0, website: 0, other: 0, unknown: 0 };
}

function emptyCancellationMetrics(): DashboardCancellationMetrics {
  return {
    countedCancellations: 0,
    rawCancellationRows: 0,
    uniqueCancellationCandidates: 0,
    duplicateRowsExcluded: 0,
    subscriptionOnlyActiveExcluded: 0,
    pauseRowsExcluded: 0,
    needsReview: 0
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

function parsePayrollShiftRow(row: Record<string, unknown>): PayrollShiftRow {
  const payload = recordValue(row.payload);
  const data = recordValue(payload.data);
  return {
    employeeId: identifierValue(data.employee_id),
    shiftId: identifierValue(data.shift_id),
    shiftDate: stringValue(data.shift_date)?.slice(0, 10) ?? stringValue(row.receivedAt)?.slice(0, 10),
    durationMinutes: durationMinutes(data.duration_time),
    receivedAt: stringValue(row.receivedAt)
  };
}

function technicianShiftHourBreakdown(shifts: PayrollShiftRow[]): Array<{ technician: string; hours: number }> {
  const minutesByEmployee = new Map<string, number>();
  for (const shift of shifts) {
    const employeeId = shift.employeeId ?? "unknown";
    minutesByEmployee.set(employeeId, (minutesByEmployee.get(employeeId) ?? 0) + (shift.durationMinutes ?? 0));
  }

  return [...minutesByEmployee.entries()]
    .map(([employeeId, minutes]) => ({
      technician: SWEEPGO_EMPLOYEE_NAMES[employeeId] ?? "Unknown technician",
      hours: roundMoney(minutes / 60)
    }))
    .sort((left, right) => right.hours - left.hours || left.technician.localeCompare(right.technician));
}

function dedupePayrollShifts(shifts: PayrollShiftRow[]): PayrollShiftRow[] {
  const groups = new Map<string, PayrollShiftRow[]>();
  for (const shift of shifts) {
    const key = [
      shift.employeeId ?? "unknown",
      shift.shiftDate ?? "unknown",
      shift.shiftId ?? shift.receivedAt ?? "unknown"
    ].join(":");
    groups.set(key, [...(groups.get(key) ?? []), shift]);
  }
  return [...groups.values()].map((group) => [...group].sort(comparePayrollShifts)[0]);
}

function comparePayrollShifts(left: PayrollShiftRow, right: PayrollShiftRow): number {
  const leftHasDuration = (left.durationMinutes ?? 0) > 0 ? 1 : 0;
  const rightHasDuration = (right.durationMinutes ?? 0) > 0 ? 1 : 0;
  if (rightHasDuration !== leftHasDuration) {
    return rightHasDuration - leftHasDuration;
  }
  return timestampValue(right.receivedAt) - timestampValue(left.receivedAt);
}

function durationMinutes(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  const raw = stringValue(value);
  if (!raw) {
    return undefined;
  }
  const parts = raw.split(":").map((part) => Number(part));
  if ((parts.length === 2 || parts.length === 3) && parts.every(Number.isFinite)) {
    const [hours, minutes, seconds = 0] = parts;
    const total = hours * 60 + minutes + seconds / 60;
    return total > 0 ? total : undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function timestampValue(value: unknown): number {
  const raw = stringValue(value);
  if (!raw) {
    return 0;
  }
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

function identifierValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return stringValue(value);
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
