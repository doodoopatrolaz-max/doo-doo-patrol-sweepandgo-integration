import { loadConfig } from "../src/config.ts";
import { SweepAndGoClient } from "../src/sweepandgo/client.ts";
import { calculateDirectActiveSubscriptionMrr } from "../src/sweepandgo/mrrMapper.ts";
import { PostgresClient } from "./postgres_tool.mjs";

function integer(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return Math.round(value * 100) / 100;
}

function pushAll(target, values) {
  for (const value of values) {
    target.add(value);
  }
}

async function loadJuneCustomers(pool) {
  const rows = await queryRows(pool,
    `SELECT id, external_sweepgo_id
     FROM customers
     WHERE first_recurring_date BETWEEN '2026-06-01'::date AND '2026-06-30'::date
       AND external_sweepgo_id IS NOT NULL
     ORDER BY id`
  );
  return rows.map((row) => ({
    id: row.id,
    externalSweepGoId: String(row.external_sweepgo_id)
  }));
}

async function loadDashboardJuneMrr(pool) {
  const rows = await queryRows(pool,
    `SELECT COUNT(*)::int AS count,
            SUM(monthly_recurring_revenue)::float AS mrr_added,
            COUNT(monthly_recurring_revenue)::int AS priced_count
     FROM customers
     WHERE first_recurring_date BETWEEN '2026-06-01'::date AND '2026-06-30'::date`
  );
  const row = rows[0] ?? {};
  return {
    juneNewRecurringCustomers: integer(row.count),
    currentlyPricedCustomers: integer(row.priced_count),
    currentStoredMrrAdded: money(Number(row.mrr_added ?? 0))
  };
}

async function main() {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (!config.sweepgoApiToken) {
    throw new Error("SWEEPGO_API_TOKEN is required");
  }

  const pool = new PostgresClient(parseDatabaseUrl(config.databaseUrl));
  const sweepgo = new SweepAndGoClient(config);

  const aggregate = {
    endpointUsed: "POST /api/v2/clients/client_details",
    activeClientListAmountAvailability: "GET /api/v1/clients/active provides subscription_names but no verified direct amount field in the current mapper.",
    billingSubscriptionsEndpointAvailability: "No separate billing/subscriptions endpoint is implemented in this repository.",
    invoicePaymentUse: "Invoices and payments are ignored for MRR.",
    newRecurringCustomersInJune: 0,
    customersWithSubscriptionDataFound: 0,
    customersWithAtLeastOneActiveSubscription: 0,
    activeSubscriptionsCounted: 0,
    canceledSubscriptionsIgnored: 0,
    pausedSubscriptionsIgnored: 0,
    inactiveSubscriptionsIgnored: 0,
    customersWithNoActiveSubscriptionFound: 0,
    customersWithAmbiguousBillingInterval: 0,
    customersWithDirectMonthlyMrrCalculated: 0,
    totalMrrAdded: 0,
    averageMrrPerNewCustomer: 0,
    customersNeedingReview: 0,
    missingAmountSubscriptions: 0,
    nonMonthlySubscriptions: 0,
    detailRequestsAttempted: 0,
    detailRequestsSucceeded: 0,
    detailRequestErrors: 0,
    fieldPaths: {
      subscriptionContainerPaths: [],
      statusPaths: [],
      amountPaths: [],
      intervalPaths: []
    },
    dashboardJuneMrrBeforeDryRun: {}
  };

  const fieldPaths = {
    subscriptionContainerPaths: new Set(),
    statusPaths: new Set(),
    amountPaths: new Set(),
    intervalPaths: new Set()
  };

  try {
    await pool.connect();
    const juneCustomers = await loadJuneCustomers(pool);
    const dashboardJuneMrr = await loadDashboardJuneMrr(pool);
    aggregate.newRecurringCustomersInJune = juneCustomers.length;
    aggregate.dashboardJuneMrrBeforeDryRun = dashboardJuneMrr;

    for (const customer of juneCustomers) {
      aggregate.detailRequestsAttempted += 1;
      let details;
      try {
        details = await sweepgo.getClientDetailsAndPayments(customer.externalSweepGoId);
        aggregate.detailRequestsSucceeded += 1;
      } catch {
        aggregate.detailRequestErrors += 1;
        aggregate.customersNeedingReview += 1;
        continue;
      }

      const mrr = calculateDirectActiveSubscriptionMrr(details);
      pushAll(fieldPaths.subscriptionContainerPaths, mrr.fieldPaths.subscriptionContainerPaths);
      pushAll(fieldPaths.statusPaths, mrr.fieldPaths.statusPaths);
      pushAll(fieldPaths.amountPaths, mrr.fieldPaths.amountPaths);
      pushAll(fieldPaths.intervalPaths, mrr.fieldPaths.intervalPaths);

      const subscriptionDataFound = mrr.fieldPaths.subscriptionContainerPaths.length > 0
        || mrr.activeSubscriptions.length > 0
        || mrr.canceledSubscriptionsIgnored > 0
        || mrr.pausedSubscriptionsIgnored > 0
        || mrr.inactiveSubscriptionsIgnored > 0
        || mrr.missingAmountSubscriptions > 0
        || mrr.nonMonthlySubscriptions > 0
        || mrr.ambiguousIntervalSubscriptions > 0;

      if (subscriptionDataFound) {
        aggregate.customersWithSubscriptionDataFound += 1;
      }
      if (mrr.activeSubscriptions.length > 0) {
        aggregate.customersWithAtLeastOneActiveSubscription += 1;
      } else {
        aggregate.customersWithNoActiveSubscriptionFound += 1;
      }

      aggregate.activeSubscriptionsCounted += mrr.activeSubscriptions.length;
      aggregate.canceledSubscriptionsIgnored += mrr.canceledSubscriptionsIgnored;
      aggregate.pausedSubscriptionsIgnored += mrr.pausedSubscriptionsIgnored;
      aggregate.inactiveSubscriptionsIgnored += mrr.inactiveSubscriptionsIgnored;
      aggregate.missingAmountSubscriptions += mrr.missingAmountSubscriptions;
      aggregate.nonMonthlySubscriptions += mrr.nonMonthlySubscriptions;

      if (mrr.ambiguousIntervalSubscriptions > 0) {
        aggregate.customersWithAmbiguousBillingInterval += 1;
      }

      if (mrr.monthlyRecurringRevenue !== undefined) {
        aggregate.customersWithDirectMonthlyMrrCalculated += 1;
        aggregate.totalMrrAdded = money(aggregate.totalMrrAdded + mrr.monthlyRecurringRevenue);
      } else {
        aggregate.customersNeedingReview += 1;
      }
    }

    aggregate.averageMrrPerNewCustomer = aggregate.customersWithDirectMonthlyMrrCalculated > 0
      ? money(aggregate.totalMrrAdded / aggregate.customersWithDirectMonthlyMrrCalculated)
      : 0;
    aggregate.fieldPaths.subscriptionContainerPaths = [...fieldPaths.subscriptionContainerPaths].sort();
    aggregate.fieldPaths.statusPaths = [...fieldPaths.statusPaths].sort();
    aggregate.fieldPaths.amountPaths = [...fieldPaths.amountPaths].sort();
    aggregate.fieldPaths.intervalPaths = [...fieldPaths.intervalPaths].sort();

    process.stdout.write(`${JSON.stringify(aggregate, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

async function queryRows(pool, sql) {
  const statements = await pool.query(sql);
  return statements.find((statement) => Array.isArray(statement.rows))?.rows ?? [];
}

function parseDatabaseUrl(value) {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, ""))
  };
}

await main();
