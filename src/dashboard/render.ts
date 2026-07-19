import type { DashboardDateRange } from "./dateRange.ts";
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
        <div>
          <p class="eyebrow">Someone's gotta Doo it</p>
          <h1>Doo Doo Patrol KPI Dashboard</h1>
          <p class="subtitle">Clean yards. Clean data.</p>
        </div>
        <a class="logout" href="/dashboard/logout">Log out</a>
      </header>
      <main class="dashboard">
        ${renderDateFilters(data.summary.range)}
        ${renderSummary(data.summary)}
        ${renderCharts(data.trends)}
        ${renderSources(data.sources)}
        ${renderDataNotes(data.summary)}
        ${renderSyncHealth(data.syncHealth)}
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
      <form class="custom-range" method="get" action="/dashboard">
        <input type="hidden" name="range" value="custom">
        <label>Start <input type="date" name="start" value="${escapeHtml(range.startDate)}"></label>
        <label>End <input type="date" name="end" value="${escapeHtml(range.endDate)}"></label>
        <button type="submit">Apply</button>
      </form>
      <p class="range-label">${escapeHtml(range.label)}: ${escapeHtml(range.startDate)} to ${escapeHtml(range.endDate)} (${escapeHtml(range.timeZone)})</p>
    </section>
  `;
}

function renderSummary(summary: DashboardSummary): string {
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
      label: "Average Monthly Ticket",
      value: summary.averageMonthlyTicket === null ? "Unavailable" : money(summary.averageMonthlyTicket),
      note: summary.averageMonthlyTicketReason
    },
    { label: "Total Leads", value: String(summary.totalLeads) },
    { label: "New Recurring Customers", value: String(summary.newRecurringCustomers) },
    { label: "Close Rate", value: maybePercent(summary.closeRateMetrics.totalCloseRate) },
    { label: "Net Customer Growth", value: signed(summary.netRecurringCustomerGrowth) }
  ];
  const secondaryCards: DashboardCard[] = [
    { label: "Total Ad Spend", value: money(summary.totalAdSpend) },
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
    { label: "Cancellations", value: String(summary.cancellations) },
    {
      label: "Estimated MRR",
      value: summary.estimatedActiveMrr === null ? "Unavailable" : money(summary.estimatedActiveMrr),
      note: summary.estimatedActiveMrrReason
    }
  ];

  return `
    <section>
      <h2>Owner Scoreboard</h2>
      <div class="cards owner-scoreboard primary">
        ${primaryCards.map(renderCard).join("")}
      </div>
      <div class="cards owner-scoreboard secondary">
        ${secondaryCards.map(renderCard).join("")}
      </div>
    </section>
  `;
}

type DashboardCard = {
  label: string;
  value: string;
  note?: string;
};

function renderCard(card: DashboardCard): string {
  return `
    <article class="card">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      ${card.note ? `<small>${escapeHtml(card.note)}</small>` : ""}
    </article>
  `;
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
        <table>
          <thead><tr><th>Date</th><th>Total leads</th><th>Cost per lead</th></tr></thead>
          <tbody>
            ${trends.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${row.totalLeads}</td><td>${escapeHtml(maybeMoney(row.costPerLead))}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div>
        <h2>Meta Spend vs Facebook Leads</h2>
        <table>
          <thead><tr><th>Date</th><th>Meta spend</th><th>Facebook leads</th></tr></thead>
          <tbody>
            ${trends.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(money(row.metaSpend))}</td><td>${row.facebookLeads}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSources(sources: DashboardSources): string {
  return `
    <section class="grid-two">
      <div>
        <h2>Lead Source Performance</h2>
        <table>
          <thead><tr><th>Source</th><th>Leads</th><th>New recurring customers</th></tr></thead>
          <tbody>
            ${sources.leadSources.map((row) => `<tr><td>${escapeHtml(title(row.source))}</td><td>${row.leads}</td><td>${row.newRecurringCustomers}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div>
        <h2>Campaign Performance</h2>
        <table>
          <thead><tr><th>Provider</th><th>Campaigns</th><th>Spend</th><th>Clicks</th><th>Leads</th></tr></thead>
          <tbody>
            ${sources.campaignPerformance.length ? sources.campaignPerformance.map((row) => `
              <tr><td>${escapeHtml(title(row.provider))}</td><td>${row.campaignCount}</td><td>${escapeHtml(money(row.spend))}</td><td>${row.clicks}</td><td>${row.leads}</td></tr>
            `).join("") : `<tr><td colspan="5">No ad performance rows for this range.</td></tr>`}
          </tbody>
        </table>
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
      <table>
        <thead>
          <tr><th>Provider</th><th>Status</th><th>Last started</th><th>Read</th><th>Written</th><th>Recent events</th><th>Failed events</th><th>Open issues</th></tr>
        </thead>
        <tbody>
          ${syncHealth.rows.length ? syncHealth.rows.map((row) => `
            <tr class="${row.isStale ? "stale-sync" : ""}">
              <td>${escapeHtml(title(row.provider))}</td>
              <td>${escapeHtml(row.latestStatus)}</td>
              <td>${escapeHtml(row.lastStartedAt ?? "No data")}</td>
              <td>${row.recordsRead}</td>
              <td>${row.recordsWritten}</td>
              <td>${row.recentEvents}</td>
              <td>${row.failedEvents}</td>
              <td>${row.openReconciliationIssues}</td>
            </tr>
          `).join("") : `<tr><td colspan="8">No sync runs found yet.</td></tr>`}
        </tbody>
      </table>
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
    .topbar { display:flex; justify-content:space-between; gap:16px; align-items:center; padding:28px clamp(18px, 4vw, 48px); background:linear-gradient(135deg, #00a8ff, #0477bf); color:white; }
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
    .owner-scoreboard.primary { grid-template-columns:repeat(6, minmax(0, 1fr)); }
    .owner-scoreboard.secondary { grid-template-columns:repeat(7, minmax(0, 1fr)); margin-top:12px; }
    .card { background:white; border:1px solid var(--line); border-radius:8px; padding:16px; min-height:104px; box-shadow:0 8px 24px rgba(16,42,67,.06); }
    .card span { display:block; color:#557083; font-weight:700; min-height:38px; }
    .card strong { display:block; color:var(--navy); font-size:clamp(1.25rem, 3vw, 2rem); margin-top:8px; overflow-wrap:anywhere; }
    .card small { display:block; margin-top:8px; color:#557083; font-weight:700; line-height:1.35; }
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
    @media (max-width: 1100px) { .owner-scoreboard.primary, .owner-scoreboard.secondary { grid-template-columns:repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 850px) { .topbar { align-items:flex-start; flex-direction:column; } .cards, .owner-scoreboard.primary, .owner-scoreboard.secondary, .grid-two { grid-template-columns:1fr; } .bar-row { grid-template-columns:48px 1fr 64px; } }
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
