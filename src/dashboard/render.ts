import type { DashboardDateRange } from "./dateRange.ts";
import { DASHBOARD_SOURCE_BUCKETS, labelForDashboardSourceBucket, type DashboardDetailedSourceBreakdown } from "./sourceAttribution.ts";
import type { DashboardData, DashboardSummary, DashboardSyncHealth, DashboardTrendPoint, DashboardSources } from "./types.ts";

export function renderDashboardLogin(input: { disabled: boolean; failed?: boolean }): string {
  return pageShell({
    title: "Doo Doo Patrol KPI Dashboard",
    body: `
      <main class="login">
        <section class="login-panel">
          <p class="eyebrow">Someone's gotta Doo it</p>
          <h1>Doo Doo Patrol KPI Dashboard</h1>
          <p class="subtitle">Clean yards. Clean data.</p>
          ${input.disabled ? `
            <div class="notice">
              <strong>Dashboard setup needed.</strong>
              <span>Set <code>DASHBOARD_PASSWORD</code> in Railway to enable the private dashboard.</span>
            </div>
          ` : `
            <form method="post" action="/dashboard/login" class="login-form">
              <label for="dashboard-password">Dashboard password</label>
              <input id="dashboard-password" name="password" type="password" autocomplete="current-password" required autofocus>
              ${input.failed ? `<p class="error">That password did not work.</p>` : ""}
              <button type="submit">Open dashboard</button>
            </form>
          `}
        </section>
      </main>
    `
  });
}

export function renderDashboard(data: DashboardData): string {
  return pageShell({
    title: "Doo Doo Patrol KPI Dashboard",
    body: `
      <header class="topbar">
        <div class="brand-lockup">
          <img class="brand-logo" src="/assets/doo-doo-patrol-logo.png" alt="Doo Doo Patrol">
          <div>
            <p class="eyebrow">Doo Doo Patrol</p>
            <h1>Owner dashboard</h1>
          </div>
        </div>
        <a class="logout" href="/dashboard/logout">Log out</a>
      </header>
      <main class="dashboard">
        ${renderDateFilters(data.summary.range)}
        ${renderSummary(data.summary, data.sources)}
        <details class="section-group"><summary>Daily trends <span>Leads &amp; ad spend</span></summary>${renderCharts(data.trends)}</details>
        <details class="section-group"><summary>Data status <span>Notes &amp; source updates</span></summary>${renderDataNotes(data.summary)}${renderSyncHealth(data.syncHealth)}</details>
      </main>
    `
  });
}

function renderDateFilters(range: DashboardDateRange): string {
  const presets = [
    ["today", "Today"],
    ["yesterday", "Yesterday"],
    ["last7", "Last 7 days"],
    ["thisMonth", "This month"],
    ["lastMonth", "Last month"]
  ];

  return `
    <section class="filters" aria-label="Date filters">
      <div class="preset-row">
        ${presets.map(([key, label]) => `<a class="chip ${range.key === key ? "active" : ""}" href="/dashboard?range=${key}">${label}</a>`).join("")}
      </div>
      <details class="custom-dates"><summary>Custom dates</summary><form class="custom-range" method="get" action="/dashboard">
        <input type="hidden" name="range" value="custom">
        <label>Start <input type="date" name="start" value="${escapeHtml(range.startDate)}"></label>
        <label>End <input type="date" name="end" value="${escapeHtml(range.endDate)}"></label>
        <button type="submit">Apply</button>
      </form></details>
      <p class="range-label">${escapeHtml(range.label)}: ${escapeHtml(range.startDate)} to ${escapeHtml(range.endDate)} (${escapeHtml(range.timeZone)})</p>
    </section>
  `;
}

function renderSummary(summary: DashboardSummary, sources: DashboardSources): string {
  const activeClientsNote = summary.totalActiveClientsAsOf
    ? `As of latest Sweep&Go active roster snapshot: ${summary.totalActiveClientsAsOf}`
    : "Needs verification";
  const primaryCards: DashboardCard[] = [
    {
      label: "Total Active Clients",
      value: summary.totalActiveClients === null ? "Needs verification" : String(summary.totalActiveClients),
      note: activeClientsNote
    },
    {
      label: "One-Time Cleanups",
      value: String(summary.oneTimeCleanups),
      note: summary.oneTimeCleanupsReason,
      breakdown: detailedSourceBreakdownRows(summary.oneTimeCleanupSourceBreakdown)
    },
    {
      label: "Total Leads",
      value: String(summary.totalLeads),
      breakdown: detailedSourceBreakdownRows(summary.leadSourceBreakdown)
    },
    {
      label: "New Recurring Customers",
      value: String(summary.newRecurringCustomers),
      breakdown: [
        ...detailedSourceBreakdownRows(summary.newRecurringCustomerSourceBreakdown),
        ...(summary.priorPeriodLeadConversions > 0
          ? [{ label: "Prior-period lead", value: String(summary.priorPeriodLeadConversions) }]
          : [])
      ]
    },
    {
      label: "Close Rate",
      value: maybePercent(summary.closeRateMetrics.totalCloseRate),
      breakdown: DASHBOARD_SOURCE_BUCKETS.map((bucket) => {
        const source = summary.closeRateMetrics.sourceBreakdown[bucket];
        return {
          label: labelForDashboardSourceBucket(bucket),
          value: `${source.conversions} · ${source.leads > 0 ? maybePercent(source.closeRate) : "No leads"}`
        };
      }),
      note: summary.priorPeriodLeadConversions > 0
        ? `Includes ${summary.priorPeriodLeadConversions} prior-period lead conversion${summary.priorPeriodLeadConversions === 1 ? "" : "s"}. One-time cleanup signups are included in close rate; recurring customer count remains separate.`
        : "Close rate includes recurring customer signups and one-time cleanup signups in the selected period. Recurring customer count remains separate."
    },
    {
      label: "Churn Rate",
      value: maybePercent(summary.churnRate),
      note: summary.churnRateReason,
      breakdown: [
        { label: "Counted", value: String(summary.cancellationMetrics.countedCancellations) },
        { label: "Needs Review", value: String(summary.cancellationMetrics.needsReview) },
        { label: "Excluded", value: String(summary.cancellationMetrics.subscriptionOnlyActiveExcluded + summary.cancellationMetrics.duplicateRowsExcluded + summary.cancellationMetrics.pauseRowsExcluded) }
      ]
    },
    {
      label: "Average Monthly Ticket",
      value: money(summary.averageMonthlyTicket ?? 0),
      note: summary.averageMonthlyTicketReason
    },
    {
      label: "Lifetime Value",
      value: maybeMoney(summary.lifetimeValue),
      note: summary.lifetimeValueReason
    },
    {
      label: "Revenue Per Recurring Service Hour",
      value: maybeMoney(summary.averageRevenuePerHour),
      note: summary.averageRevenuePerHourReason,
      breakdown: [
        { label: "Recurring Hrs", value: String(summary.revenuePerHourMetrics.serviceHours) },
        { label: "Revenue", value: money(summary.revenuePerHourMetrics.serviceRevenue) }
      ]
    },
    {
      label: "Revenue Per Recurring Shift Hour",
      value: maybeMoney(summary.averageRevenuePerShiftHour),
      note: summary.averageRevenuePerShiftHourReason,
      breakdown: [
        { label: "Adjusted Shift Hrs", value: String(summary.revenuePerShiftHourMetrics.shiftHours) },
        { label: "Revenue", value: money(summary.revenuePerShiftHourMetrics.serviceRevenue) }
      ]
    },
    { label: "Net Customer Growth", value: signed(summary.netRecurringCustomerGrowth) },
    { label: "Total Ad Spend", value: money(summary.totalAdSpend) }
  ];
  const secondaryCards: DashboardCard[] = [
    { label: "Meta Spend", value: money(summary.metaSpend) },
    {
      label: "Google Spend",
      value: summary.googleAdsStatus.connected ? money(summary.googleSpend) : "Not connected yet",
      note: summary.googleAdsStatus.latestFailed ? "Latest sync failed; stored spend remains visible" : undefined
    },
    { label: "Cost Per Lead", value: maybeMoney(summary.costPerLead) },
    {
      label: "Cost Per New Customer",
      value: maybeMoney(summary.costPerNewRecurringCustomer),
      note: summary.costPerNewRecurringCustomerNote
    },
    { label: "Cancellations", value: String(summary.cancellations) }
  ];

  const find = (label: string) => [...primaryCards, ...secondaryCards].find(card => card.label === label)!;
  const period = summary.range.startDate === summary.range.endDate ? shortDate(summary.range.startDate) : `${shortDate(summary.range.startDate)}–${shortDate(summary.range.endDate)}`;
  const ownerCards: DashboardCard[] = [
    { ...find("Total Active Clients"), label: "Active clients", context: "Latest roster snapshot", timestamp: summary.totalActiveClientsAsOf },
    { ...find("Net Customer Growth"), label: "Net recurring growth", context: `${summary.newRecurringCustomers} first-time + ${summary.recurringReturnMetrics?.available ? summary.recurringReturnMetrics.growthContribution : "unverified"} returns − ${summary.cancellations} cancellations`, note: summary.recurringReturnMetrics?.available ? "Verified returning recurring customers contribute to growth separately from first-time acquisition. Same-month resumptions are excluded to match the existing churn policy. Historical losses are not recalculated. Not a full roster reconciliation." : "Return tracking is not available; growth currently includes first-time customers minus counted cancellations only.", breakdown: [{label:"First-time recurring",value:String(summary.newRecurringCustomers)},{label:"Returns added to growth",value:summary.recurringReturnMetrics?.available ? String(summary.recurringReturnMetrics.growthContribution) : "Unavailable"},{label:"Same-month resumptions",value:summary.recurringReturnMetrics?.available ? String(summary.recurringReturnMetrics.sameMonthResumptions) : "Unavailable"},{label:"Returns needing review",value:summary.recurringReturnMetrics?.available ? String(summary.recurringReturnMetrics.needsReview) : "Unavailable"},{label:"Cancellations",value:String(summary.cancellations)}] },
    { ...find("Total Leads"), label: "Unique leads", context: period },
    { ...find("Close Rate"), label: "Lead closing rate", context: `${summary.closeRateMetrics.totalMatchedConversions} conversion${summary.closeRateMetrics.totalMatchedConversions === 1 ? "" : "s"} / ${summary.totalLeads} lead${summary.totalLeads === 1 ? "" : "s"}`, note: `Existing lead-cohort calculation. Recurring and one-time signups are included; ${summary.priorPeriodLeadConversions} prior-period lead conversion(s) are shown separately from the selected-period numerator.` },
    { ...find("Churn Rate"), label: "Customer churn", context: `${summary.cancellations} / ${summary.churnRateDenominator} starting customers` },
    { label: "Recurring earned revenue", value: money(summary.revenuePerHourMetrics.serviceRevenue), context: summary.revenuePerHourMetrics.unavailableReason === "No stored Sweep&Go completed job rows were available for the selected range." ? "No stored jobs for this range" : period, note: "Recurring earned service revenue, including noncredited skipped jobs and zero-duration revenue. Initial and one-time cleanup jobs are excluded. This is not net profit.", breakdown: [{label:"Recurring scooping",value:money(summary.revenuePerHourMetrics.scoopingRevenue)},{label:"Recurring spray",value:money(summary.revenuePerHourMetrics.sprayRevenue)},{label:"Skipped revenue included",value:money(summary.revenuePerHourMetrics.skippedRecurringRevenue)}] },
    { ...find("Revenue Per Recurring Shift Hour"), label: "Revenue / shift hour", context: "Adjusted recurring shift time" },
    { label: "Lead & acquisition cost", value: "", extraHtml: renderAcquisitionChannels(summary, sources), context: "Blended recorded ad spend", values: [
      {label:"Per lead", value:summary.totalLeads > 0 ? maybeMoney(summary.costPerLead) : "Unavailable"},
      {label:"Per new recurring", value:summary.newRecurringCustomers > 0 ? maybeMoney(summary.costPerNewRecurringCustomer) : "Unavailable"}
    ], note: `Recorded Meta + Google spend divided by unique leads, or by all new recurring signups, in the selected period; one-time signups are excluded from acquisition cost. Recurring signups may come from earlier leads. These are blended period ratios, not matched-cohort paid-channel CAC or verified payments. ${summary.totalLeads === 0 ? "Per lead unavailable: no leads in the range. " : ""}${summary.newRecurringCustomers === 0 ? "Per new recurring unavailable: no new recurring signups in the range. " : ""}${summary.totalAdSpend === 0 ? "No recorded ad spend; zero does not establish free acquisition or complete source coverage." : "Uses stored spend; it does not certify complete marketing-cost coverage."}`, breakdown: [{label:"Recorded ad spend",value:money(summary.totalAdSpend)},{label:"Unique leads",value:String(summary.totalLeads)},{label:"New recurring signups",value:String(summary.newRecurringCustomers)},{label:"Period",value:period}] }
  ];
  return `
    <section aria-labelledby="owner-heading">
      <div class="section-heading"><h2 id="owner-heading">Owner Scoreboard</h2><p>Growth, retention &amp; route productivity</p></div>
      <div class="cards owner-scoreboard primary">${ownerCards.map(renderCard).join("")}</div>
    </section>
    <details class="section-group"><summary>Acquisition <span>Signups, sources &amp; ad costs</span></summary>
      <div class="cards secondary">${["New Recurring Customers", "One-Time Cleanups", "Total Ad Spend", "Meta Spend", "Google Spend", "Cost Per Lead", "Cost Per New Customer"].map(label => renderCard({...find(label), context:period})).join("")}</div>
      ${renderSources(sources)}
    </details>
    <details class="section-group"><summary>Retention &amp; assumptions <span>Cancellations, ticket &amp; LTV</span></summary>
      <div class="cards secondary">${["Cancellations", "Average Monthly Ticket", "Lifetime Value"].map(label => renderCard({...find(label), context:label === "Average Monthly Ticket" ? "Configured assumption" : period})).join("")}</div>
      <p class="panel-note">Same-calendar-month cancellation and return is excluded under your existing policy. Lifetime Value retains the existing formula; its monthly versus selected-period interpretation still needs review.</p>
    </details>
    <details class="section-group"><summary>Route productivity <span>Time, stops, scoop &amp; spray</span></summary>
      <div class="cards secondary">${renderCard({...find("Revenue Per Recurring Service Hour"), context:period})}</div>
      ${renderServiceProductivity(summary)}
    </details>
  `;
}

function renderServiceProductivity(summary: DashboardSummary): string {
  const metrics = summary.revenuePerHourMetrics;
  return `
    <div class="productivity-panel">
      <h3>Recurring Route Productivity</h3>
      <div class="mini-stats">
        ${[
          ["Recurring stops", String(metrics.completedStops)],
          ["Adjusted recurring service hours", String(metrics.serviceHours)],
          ["Adjusted recurring shift hours", String(summary.revenuePerShiftHourMetrics.shiftHours)],
          ["Recurring service revenue", money(metrics.serviceRevenue)],
          ["Revenue / recurring stop", maybeMoney(metrics.revenuePerStop)],
          ["Avg min / recurring stop", metrics.averageMinutesPerStop === null ? "No data" : String(metrics.averageMinutesPerStop)],
          ["Recurring scooping revenue", money(metrics.scoopingRevenue)],
          ["Recurring spray revenue", money(metrics.sprayRevenue)],
          ["Skipped recurring revenue included", money(metrics.skippedRecurringRevenue)],
          ["Same-stop scoop/spray", String(metrics.scoopSprayCombinedStopGroups)]
        ].map(([label, value]) => `
          <div>
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </div>
        `).join("")}
      </div>
      <p class="panel-note">Initial and one-time cleanup jobs are excluded from recurring productivity. Paid skipped recurring jobs count as revenue only.</p>
    </div>
  `;
}

type DashboardCard = {
  label: string;
  value: string;
  note?: string;
  context?: string;
  timestamp?: string;
  values?: DashboardCardBreakdown[];
  extraHtml?: string;
  breakdown?: DashboardCardBreakdown[];
};

type DashboardCardBreakdown = {
  label: string;
  value: string;
};

function renderCard(card: DashboardCard): string {
  return `
    <article class="card${card.extraHtml ? " channel-card" : ""}" aria-label="${escapeHtml(card.label)}">
      <span class="card-label">${escapeHtml(card.label)}</span>
      ${card.values ? `<dl class="metric-pair">${card.values.map(row => `<div><dt>${escapeHtml(row.label)}</dt><dd class="${row.value === "Unavailable" ? "unavailable-value" : ""}">${escapeHtml(row.value)}</dd></div>`).join("")}</dl>` : `<strong class="metric-value">${escapeHtml(card.value)}</strong>`}
      ${card.context ? `<p class="card-context">${escapeHtml(card.context)}</p>` : ""}
      ${card.timestamp ? `<time class="card-context" datetime="${escapeHtml(card.timestamp)}" title="${escapeHtml(card.timestamp)}">Updated ${escapeHtml(phoenixTime(card.timestamp))}</time>` : ""}
      ${(card.breakdown?.length || card.note) ? `<details class="metric-details"><summary aria-label="Details for ${escapeHtml(card.label)}">Details</summary>
        ${card.breakdown?.length ? `<dl class="card-breakdown">${card.breakdown.map(row => `<div><dt>${escapeHtml(row.label)}</dt><dd class="${row.value === "Unavailable" ? "unavailable-value" : ""}">${escapeHtml(row.value)}</dd></div>`).join("")}</dl>` : ""}
        ${card.note ? `<small>${escapeHtml(card.note)}</small>` : ""}
        ${card.extraHtml ?? ""}
      </details>` : ""}
    </article>
  `;
}

function renderAcquisitionChannels(summary: DashboardSummary, sources: DashboardSources): string {
  const google = sources.campaignPerformance.filter(row => row.provider === "google_ads" || row.provider === "google");
  const meta = sources.campaignPerformance.filter(row => row.provider === "meta");
  const row = (label: string, value: string) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  const channels = [
    { title:"Google", records:google, spend:summary.googleSpend, bucket:"website_paid" as const,
      leadsLabel:"Website Paid leads · proxy", conversionsLabel:"Website Paid conversions",
      limitation:"Website Paid includes your approved Search Engine / Google self-report rules. It is not a verified Google Ads-only cohort. Conversions are dashboard recurring + one-time outcomes, not verified ad-linked sales.",
      costReason:"Not available: no verified Google Ads-only lead or acquired-customer denominator." },
    { title:"Facebook / Meta", records:meta, spend:summary.metaSpend, bucket:"facebook" as const,
      leadsLabel:"Facebook leads · all sources", conversionsLabel:"Facebook conversions",
      limitation:"The Facebook bucket combines paid, organic and self-reported social traffic. Conversions are dashboard recurring + one-time outcomes, not verified ad-linked sales.",
      costReason:"Not available: paid Meta leads/customers are not separated from organic Facebook." }
  ];
  return `<div class="acquisition-channels"><h3>Google versus Facebook</h3><p class="panel-note">Same selected period. Spend records and dashboard attribution are shown separately; a completed sync with no rows does not verify zero spend.</p><div class="channel-grid">${channels.map(channel => {
    const source = sources.leadSources.find(source => source.source === channel.bucket);
    const conversions = summary.closeRateMetrics.sourceBreakdown[channel.bucket];
    const connected = channel.title !== "Google" || summary.googleAdsStatus.connected;
    const spend = !connected ? "Not available · Google not connected" : channel.records.length ? money(channel.spend) + (channel.spend === 0 ? " · recorded zero" : " · recorded") : "Not available · no spend rows";
    return `<section class="channel-detail" aria-label="${escapeHtml(channel.title)} acquisition details"><h4>${escapeHtml(channel.title)}</h4><dl class="card-breakdown">
      ${row("Ad spend",spend)}
      ${row(channel.leadsLabel,source ? String(source.leads) : "Not available")}
      ${row(channel.conversionsLabel,conversions ? String(conversions.conversions) : "Not available")}
      ${row("New recurring signups",source ? String(source.newRecurringCustomers) : "Not available")}
      ${row("Paid-channel CPL","Not available")}
      ${row("Paid-channel acquisition cost","Not available")}
      </dl><p class="panel-note">${escapeHtml(channel.costReason)}</p><p class="panel-note">${escapeHtml(channel.limitation)}</p>
      ${connected && channel.records.length === 1 ? `<details class="platform-details"><summary>Ad-platform actions</summary><dl class="card-breakdown">${row("Platform conversion actions",String(channel.records[0].adPlatformConversions))}${row("Cost / platform action",maybeMoney(channel.records[0].costPerAdPlatformConversion))}</dl><p class="panel-note">Platform actions are not unique paying customers or dashboard customer acquisitions.</p></details>` : ""}
    </section>`;
  }).join("")}</div></div>`;
}

function shortDate(value: string): string {
  const date = new Date(value + "T12:00:00Z");
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", {month:"short",day:"numeric",timeZone:"America/Phoenix"});
}
function phoenixTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", {month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/Phoenix",timeZoneName:"short"});
}

function detailedSourceBreakdownRows(input: DashboardDetailedSourceBreakdown): DashboardCardBreakdown[] {
  return DASHBOARD_SOURCE_BUCKETS.map((bucket) => ({
    label: labelForDashboardSourceBucket(bucket),
    value: String(input[bucket])
  }));
}

function renderCharts(trends: DashboardTrendPoint[]): string {
  const maxSpend = Math.max(1, ...trends.map((row) => row.totalSpend));
  const maxLeads = Math.max(1, ...trends.map((row) => row.totalLeads));

  return `
    <section class="grid-two">
      <div>
        <h2>Ad Spend By Day</h2>
        <div class="bars">
          ${trends.map((row) => bar(row.date.slice(5), row.totalSpend, maxSpend, money(row.totalSpend))).join("")}
        </div>
      </div>
      <div>
        <h2>Leads By Day</h2>
        <div class="bars">
          ${trends.map((row) => bar(row.date.slice(5), row.totalLeads, maxLeads, String(row.totalLeads))).join("")}
        </div>
      </div>
      <div>
        <h2>Cost Per Lead Trend</h2>
        <div class="table-scroll" role="region" aria-label="Dashboard details table" tabindex="0"><table>
          <thead><tr><th>Date</th><th>Total leads</th><th>Cost per lead</th></tr></thead>
          <tbody>
            ${trends.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${row.totalLeads}</td><td>${escapeHtml(maybeMoney(row.costPerLead))}</td></tr>`).join("")}
          </tbody>
        </table></div>
      </div>
      <div>
        <h2>Meta Spend vs Facebook Leads</h2>
        <div class="table-scroll" role="region" aria-label="Dashboard details table" tabindex="0"><table>
          <thead><tr><th>Date</th><th>Meta spend</th><th>Facebook leads</th></tr></thead>
          <tbody>
            ${trends.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(money(row.metaSpend))}</td><td>${row.facebookLeads}</td></tr>`).join("")}
          </tbody>
        </table></div>
      </div>
    </section>
  `;
}

function renderSources(sources: DashboardSources): string {
  return `
    <section class="grid-two">
      <div>
        <h2>Lead Source Performance</h2>
        <div class="table-scroll" role="region" aria-label="Dashboard details table" tabindex="0"><table>
          <thead><tr><th>Source</th><th>Leads</th><th>New recurring customers</th></tr></thead>
          <tbody>
            ${sources.leadSources.map((row) => `<tr><td>${escapeHtml(labelForDashboardSourceBucket(row.source))}</td><td>${row.leads}</td><td>${row.newRecurringCustomers}</td></tr>`).join("")}
          </tbody>
        </table></div>
      </div>
      <div>
        <h2>Campaign Performance</h2>
        <div class="table-scroll" role="region" aria-label="Dashboard details table" tabindex="0"><table>
          <thead><tr><th>Provider</th><th>Campaigns</th><th>Spend</th><th>Clicks</th><th>Avg CPC</th><th>Ad Conv.</th><th>Cost / Conv.</th><th>Dash Leads</th></tr></thead>
          <tbody>
            ${sources.campaignPerformance.length ? sources.campaignPerformance.map((row) => `
              <tr><td>${escapeHtml(title(row.provider))}</td><td>${row.campaignCount}</td><td>${escapeHtml(money(row.spend))}</td><td>${row.clicks}</td><td>${escapeHtml(maybeMoneyWithFallback(row.averageCpc, "No clicks"))}</td><td>${escapeHtml(metricNumber(row.adPlatformConversions))}</td><td>${escapeHtml(maybeMoneyWithFallback(row.costPerAdPlatformConversion, "No conversions"))}</td><td>${row.dashboardLeads}</td></tr>
            `).join("") : `<tr><td colspan="8">No ad performance rows for this range.</td></tr>`}
          </tbody>
        </table></div>
      </div>
      <div>
        <h2>Unmatched Leads</h2>
        <p class="big-number">${sources.unmatchedLeads.count}</p>
        <p class="muted">${escapeHtml(sources.unmatchedLeads.note)}</p>
      </div>
      <div>
        <h2>Close Rate</h2>
        <p class="big-number">Stored Matches</p>
        <p class="muted">${escapeHtml(sources.matchingStatus)}</p>
      </div>
    </section>
  `;
}

function renderDataNotes(summary: DashboardSummary): string {
  return `
    <section>
      <h2>Data Notes</h2>
      <div class="notes">
        ${summary.dataNotes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}
      </div>
    </section>
  `;
}

function renderSyncHealth(syncHealth: DashboardSyncHealth): string {
  const staleWarnings = syncHealth.rows
    .map((row) => row.staleWarning)
    .filter((warning): warning is string => Boolean(warning));

  return `
    <section>
      <h2>Sync Health</h2>
      ${staleWarnings.length ? `
        <div class="warning">
          ${staleWarnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}
        </div>
      ` : ""}
      <div class="table-scroll" role="region" aria-label="Dashboard details table" tabindex="0"><table>
        <thead>
          <tr><th>Provider</th><th>Status</th><th>Last started</th><th>Read</th><th>Written</th><th>Recent events</th><th>Failed events</th><th>Open issues</th></tr>
        </thead>
        <tbody>
          ${syncHealth.rows.length ? syncHealth.rows.map((row) => `
            <tr class="${row.isStale ? "stale-sync" : ""}">
              <td>${escapeHtml(title(row.provider))}</td>
              <td>${escapeHtml(row.latestStatus)}</td>
              <td>${row.lastStartedAt ? `<time datetime="${escapeHtml(row.lastStartedAt)}" title="${escapeHtml(row.lastStartedAt)}">${escapeHtml(phoenixTime(row.lastStartedAt))}</time>` : "No data"}</td>
              <td>${row.recordsRead}</td>
              <td>${row.recordsWritten}</td>
              <td>${row.recentEvents}</td>
              <td>${row.failedEvents}</td>
              <td>${row.openReconciliationIssues}</td>
            </tr>
          `).join("") : `<tr><td colspan="8">No sync runs found yet.</td></tr>`}
        </tbody>
      </table></div>
    </section>
  `;
}

function bar(label: string, value: number, max: number, display: string): string {
  const width = Math.max(2, Math.round((value / max) * 100));
  return `
    <div class="bar-row">
      <span>${escapeHtml(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
      <strong>${escapeHtml(display)}</strong>
    </div>
  `;
}

function pageShell(input: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root { --blue:#00a8ff; --navy:#102a43; --charcoal:#263238; --soft:#eef8ff; --line:#d8e7f1; --green:#17a673; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--charcoal); background:#f7fbff; }
    .topbar { display:flex; justify-content:space-between; gap:16px; align-items:center; padding:22px clamp(18px, 4vw, 48px); background:linear-gradient(135deg, #00a8ff, #0477bf); color:white; }
    .brand-lockup { display:flex; align-items:center; gap:18px; min-width:0; }
    .brand-logo { width:92px; height:92px; object-fit:contain; flex:0 0 auto; filter:drop-shadow(0 10px 18px rgba(16,42,67,.2)); }
    .eyebrow { margin:0 0 6px; font-weight:800; letter-spacing:0; text-transform:uppercase; font-size:0.78rem; }
    h1 { margin:0; font-size:clamp(1.8rem, 4vw, 3.4rem); letter-spacing:0; }
    h2 { margin:0 0 14px; color:var(--navy); font-size:1.15rem; }
    .subtitle { margin:8px 0 0; font-size:1.05rem; }
    .logout, button, .chip { border:0; border-radius:8px; background:white; color:var(--navy); padding:10px 14px; font-weight:800; text-decoration:none; cursor:pointer; }
    .dashboard { width:min(1180px, 100%); margin:0 auto; padding:22px clamp(14px, 3vw, 28px) 48px; }
    section { margin-top:22px; }
    .filters, .notes, .login-panel, .grid-two > div { background:white; border:1px solid var(--line); border-radius:8px; padding:18px; box-shadow:0 8px 24px rgba(16,42,67,.06); }
    .preset-row { display:flex; gap:8px; flex-wrap:wrap; }
    .chip { background:var(--soft); }
    .chip.active { background:var(--navy); color:white; }
    .custom-range { display:flex; gap:12px; flex-wrap:wrap; align-items:end; margin-top:14px; }
    label { display:grid; gap:5px; font-weight:700; color:var(--navy); }
    input { min-height:40px; border:1px solid var(--line); border-radius:8px; padding:8px 10px; font:inherit; }
    button { background:var(--blue); color:white; min-height:40px; }
    .range-label, .muted { color:#557083; margin:12px 0 0; }
    .cards { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:12px; }
    .owner-scoreboard.primary { grid-template-columns:repeat(5, minmax(0, 1fr)); }
    .owner-scoreboard.secondary { grid-template-columns:repeat(5, minmax(0, 1fr)); margin-top:12px; }
    .card { background:white; border:1px solid var(--line); border-radius:8px; padding:16px; min-height:104px; box-shadow:0 8px 24px rgba(16,42,67,.06); }
    .card span { display:block; color:#557083; font-weight:700; min-height:38px; }
    .card strong { display:block; color:var(--navy); font-size:clamp(1.25rem, 3vw, 2rem); margin-top:8px; overflow-wrap:anywhere; }
    .card-breakdown { display:grid; gap:4px; margin:10px 0 0; }
    .card-breakdown div { display:flex; justify-content:space-between; gap:10px; color:#557083; font-size:.82rem; font-weight:800; }
    .card-breakdown dt, .card-breakdown dd { margin:0; }
    .card-breakdown dd { color:var(--navy); }
    .card small { display:block; margin-top:8px; color:#557083; font-weight:700; line-height:1.35; }
    .productivity-panel { margin-top:12px; background:white; border:1px solid var(--line); border-radius:8px; padding:16px; box-shadow:0 8px 24px rgba(16,42,67,.06); }
    .productivity-panel h3 { margin:0 0 12px; color:var(--navy); font-size:1rem; }
    .mini-stats { display:grid; grid-template-columns:repeat(6, minmax(0, 1fr)); gap:10px; }
    .mini-stats div { background:var(--soft); border-radius:8px; padding:10px; }
    .mini-stats span { display:block; color:#557083; font-size:.78rem; font-weight:800; }
    .mini-stats strong { display:block; margin-top:4px; color:var(--navy); font-size:1rem; overflow-wrap:anywhere; }
    .panel-note { margin:10px 0 0; color:#557083; font-size:.82rem; }
    .notes p { margin:4px 0; }
    .grid-two { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    table { width:100%; border-collapse:collapse; background:white; border-radius:8px; overflow:hidden; }
    th, td { text-align:left; padding:10px; border-bottom:1px solid var(--line); font-size:.92rem; }
    th { color:var(--navy); background:var(--soft); }
    .bars { display:grid; gap:10px; }
    .bar-row { display:grid; grid-template-columns:54px 1fr 74px; gap:10px; align-items:center; }
    .bar-track { height:12px; background:var(--soft); border-radius:999px; overflow:hidden; }
    .bar-fill { height:100%; background:linear-gradient(90deg, var(--blue), var(--green)); border-radius:999px; }
    .big-number { margin:8px 0 0; color:var(--navy); font-size:2.4rem; font-weight:900; }
    .login { min-height:100vh; display:grid; place-items:center; padding:24px; background:linear-gradient(135deg, #00a8ff, #102a43); }
    .login-panel { width:min(460px, 100%); }
    .login-panel h1 { color:var(--navy); }
    .login-form { display:grid; gap:12px; margin-top:18px; }
    .notice { display:grid; gap:8px; margin-top:16px; padding:14px; border-radius:8px; background:var(--soft); }
    .warning { margin:0 0 14px; padding:12px 14px; border-radius:8px; border:1px solid #f4bf50; background:#fff8e6; color:#6f4800; font-weight:800; }
    .warning p { margin:4px 0; }
    .stale-sync td { background:#fffaf0; }
    .error { color:#b42318; font-weight:800; margin:0; }
    code { background:var(--soft); padding:2px 5px; border-radius:5px; }
    @media (max-width: 1100px) { .owner-scoreboard.primary, .owner-scoreboard.secondary, .mini-stats { grid-template-columns:repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 850px) { .topbar { align-items:flex-start; flex-direction:column; } .brand-lockup { align-items:flex-start; } .brand-logo { width:74px; height:74px; } .cards, .owner-scoreboard.primary, .owner-scoreboard.secondary, .grid-two { grid-template-columns:1fr; } .bar-row { grid-template-columns:48px 1fr 64px; } }
    @media (max-width: 520px) { .brand-lockup { flex-direction:column; gap:10px; } .brand-logo { width:88px; height:88px; } .mini-stats { grid-template-columns:1fr; } }

    /* Compact owner preview: no calculation or query changes. */
    .topbar { padding:14px max(16px, calc((100vw - 1120px)/2)); background:#102a43; gap:12px; }
    .brand-lockup { gap:10px; align-items:center; }
    .brand-logo { width:42px; height:42px; filter:none; }
    .topbar .eyebrow { font-size:.7rem; color:#b7dcf3; margin:0 0 3px; letter-spacing:.08em; }
    .topbar h1 { font-size:1.25rem; line-height:1.2; }
    .logout { padding:12px; font-size:.8rem; background:transparent; color:white; white-space:nowrap; }
    .dashboard { width:min(1152px,100%); padding:0 16px 32px; }
    .dashboard section { margin-top:20px; min-width:0; }
    .filters { padding:12px; box-shadow:none; margin-top:12px !important; }
    .preset-row { gap:6px; }
    .chip { display:inline-flex; align-items:center; min-height:44px; padding:8px 10px; font-size:.82rem; }
    .custom-dates { margin-top:4px; }
    summary { cursor:pointer; }
    .custom-dates > summary { min-height:44px; padding:12px 0; font-size:.85rem; font-weight:700; color:#244b68; }
    .custom-range { margin:0 0 8px; gap:8px; }
    .custom-range label { flex:1; min-width:110px; font-size:.8rem; }
    .custom-range input { width:100%; min-width:0; }
    .custom-range button { min-height:44px; background:#14638f; }
    .range-label { margin:0; font-size:.78rem; line-height:1.5; }
    .section-heading h2 { margin:0; font-size:1.08rem; }
    .section-heading p { margin:4px 0 12px; font-size:.8rem; color:#486476; }
    .cards, .owner-scoreboard.primary, .owner-scoreboard.secondary { grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; align-items:start; }
    .card { padding:14px; min-height:0; min-width:0; box-shadow:none; border-radius:12px; border-color:#d0dfe9; }
    .card > .card-label { min-height:0; font-size:.84rem; line-height:1.35; color:#36536a; font-weight:650; }
    .card > .metric-value { margin:7px 0 5px; font-size:clamp(1.55rem,2.8vw,2.15rem); font-weight:750; line-height:1.12; letter-spacing:-.025em; font-variant-numeric:tabular-nums; overflow-wrap:normal; }
    .card-context { display:block; margin:0; color:#486476; font-size:.73rem; line-height:1.45; }
    .card time { margin-top:3px; }
    .channel-card:has(.metric-details[open]) { grid-column:1 / -1; }
    .channel-card:has(.metric-details[open]) > .metric-pair { max-width:340px; }
    .acquisition-channels { margin-top:16px; border-top:1px solid #d0dfe9; padding-top:12px; }
    .acquisition-channels h3 { font-size:1rem; margin:0; }
    .channel-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .channel-detail { margin-top:12px !important; background:#f3f8fc; border:1px solid #d0dfe9; border-radius:8px; padding:12px; }
    .channel-detail h4 { margin:0 0 10px; font-size:.95rem; }
    .channel-detail .card-breakdown div { align-items:baseline; }
    .channel-detail .card-breakdown dd { text-align:right; max-width:52%; }
    .channel-detail .panel-note { font-size:.76rem; line-height:1.5; }
    .platform-details summary { min-height:44px; padding:12px 0; font-size:.8rem; color:#126390; }
    @media(max-width:650px) { .channel-grid { grid-template-columns:1fr; } }
    .metric-pair { margin:8px 0; display:grid; gap:8px; }
    .metric-pair div { display:flex; align-items:baseline; justify-content:space-between; gap:6px; }
    .metric-pair dt { font-size:.72rem; line-height:1.35; color:#36536a; max-width:65px; }
    .metric-pair dd { margin:0; font-size:1.25rem; font-weight:750; color:#102a43; font-variant-numeric:tabular-nums; }
    .metric-pair .unavailable-value { font-size:.72rem; }
    .metric-details { margin-top:4px; }
    .metric-details > summary { color:#126390; min-height:44px; display:list-item; padding:12px 0 8px; font-size:.76rem; font-weight:700; }
    .card-breakdown div { font-size:.76rem; line-height:1.5; font-weight:500; }
    .card small { font-weight:400; font-size:.76rem; line-height:1.5; }
    .section-group { margin-top:14px; border:1px solid #d0dfe9; background:white; border-radius:12px; padding:0 14px; min-width:0; }
    .section-group > summary { min-height:58px; padding:15px 0; font-weight:750; color:#173c58; font-size:.94rem; }
    .section-group > summary span { display:block; margin:3px 0 0 16px; color:#486476; font-size:.76rem; font-weight:400; }
    .section-group[open] { padding-bottom:14px; }
    .section-group .grid-two { margin-top:12px; }
    .section-group .grid-two > div { padding:12px; box-shadow:none; min-width:0; }
    .section-group h2 { font-size:.96rem; }
    .table-scroll { overflow-x:auto; max-width:100%; border-radius:8px; }
    .table-scroll table { min-width:360px; overflow:visible; }
    th, td { font-size:.8rem; padding:10px 8px; vertical-align:top; }
    th:not(:first-child),td:not(:first-child) { text-align:right; font-variant-numeric:tabular-nums; }
    .mini-stats { grid-template-columns:repeat(3,minmax(0,1fr)); }
    .mini-stats span { font-weight:500; line-height:1.4; }
    .notes { box-shadow:none; font-size:.84rem; line-height:1.5; }
    a:focus-visible, button:focus-visible, summary:focus-visible, input:focus-visible, .table-scroll:focus-visible { outline:3px solid #b15a00; outline-offset:3px; }
    @media(max-width:850px) {
      .topbar { flex-direction:row; align-items:center; }
      .brand-lockup { flex-direction:row; align-items:center; gap:10px; }
      .brand-logo { width:38px; height:38px; }
      .cards, .owner-scoreboard.primary, .owner-scoreboard.secondary { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .grid-two { grid-template-columns:1fr; }
      .mini-stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
    }
    @media(max-width:520px) {
      .dashboard { padding:0 12px 24px; }
      .topbar { padding:12px; }
      .topbar h1 { font-size:1.05rem; }
      .brand-logo { width:34px; height:34px; }
      .card { padding:12px 10px 4px; }
      .card > .metric-value { font-size:1.6rem; }
      .card > .card-label { font-size:.78rem; }
      .card-context { font-size:.7rem; }
      .cards, .owner-scoreboard.primary { gap:8px; }
      .section-group { padding-left:10px; padding-right:10px; }
    }
    @media(max-width:340px) { .cards, .owner-scoreboard.primary, .owner-scoreboard.secondary { grid-template-columns:1fr; } }
  </style>
</head>
<body>${input.body}</body>
</html>`;
}

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function maybeMoney(value: number | null): string {
  return value === null ? "No data" : money(value);
}

function maybeMoneyWithFallback(value: number | null, fallback: string): string {
  return value === null ? fallback : money(value);
}

function metricNumber(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function maybePercent(value: number | null): string {
  return value === null ? "No data" : `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function title(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
