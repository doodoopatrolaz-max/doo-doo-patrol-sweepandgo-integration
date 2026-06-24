import { loadConfig } from "../src/config.ts";
import { PostgresClient } from "./postgres_tool.mjs";

const FIELD_GROUPS = {
  clientId: ["client", "customer", "client_id", "customer_id", "clientId", "customerId"],
  subscriptionId: ["subscription_id", "subscriptionId", "subscription", "id"],
  subscriptionName: ["subscription_name", "subscriptionName", "subscription_names", "subscriptionNames", "name", "plan_name", "planName"],
  subscriptionStatus: ["status", "state", "state_name", "subscription_status", "subscriptionStatus", "active", "is_active"],
  subscriptionAmount: ["amount", "price", "monthly_amount", "monthlyAmount", "monthly_price", "monthlyPrice", "subscription_amount", "subscriptionAmount", "unit_amount", "unitAmount"],
  billingInterval: ["billing_interval", "billingInterval", "interval", "billing_frequency", "billingFrequency", "frequency"],
  billingOption: ["billing_option", "billingOption", "billing_type", "billingType", "payment_option", "paymentOption"],
  createdDate: ["created", "created_at", "createdAt", "started_at", "startedAt", "start_date", "startDate"],
  canceledDate: ["canceled_at", "cancelled_at", "canceledAt", "cancelledAt", "ended_at", "endedAt", "end_date", "endDate"]
};

const BASE_CANDIDATES = [
  { method: "GET", path: "/api/v2/packages_list", scope: "official_packaged_cross_sells" },
  { method: "GET", path: "/api/v2/clients/{client}/subscriptions" },
  { method: "GET", path: "/api/v2/clients/{client}/billing/subscriptions" },
  { method: "GET", path: "/api/v2/client/{client}/subscriptions" },
  { method: "GET", path: "/api/v2/client/{client}/billing/subscriptions" },
  { method: "GET", path: "/api/v2/clients/subscriptions", queryClient: true },
  { method: "GET", path: "/api/v2/clients/client_subscriptions", queryClient: true },
  { method: "GET", path: "/api/v2/clients/billing_subscriptions", queryClient: true },
  { method: "GET", path: "/api/v2/clients/billing", queryClient: true },
  { method: "GET", path: "/api/v2/client_subscriptions", queryClient: true },
  { method: "GET", path: "/api/v2/subscriptions", queryClient: true },
  { method: "GET", path: "/api/v2/billing/subscriptions", queryClient: true },
  { method: "GET", path: "/api/v2/report/client_subscriptions", queryClient: true },
  { method: "GET", path: "/api/v2/report/subscriptions", queryClient: true },
  { method: "GET", path: "/api/v2/reports/subscriptions", queryClient: true },
  { method: "GET", path: "/api/v1/clients/{client}/subscriptions" },
  { method: "GET", path: "/api/v1/clients/{client}/billing/subscriptions" },
  { method: "GET", path: "/api/v1/clients/subscriptions", queryClient: true },
  { method: "GET", path: "/api/v1/client_subscriptions", queryClient: true },
  { method: "GET", path: "/api/v1/subscriptions", queryClient: true },
  { method: "POST", path: "/api/v2/clients/client_subscriptions", bodyClient: true },
  { method: "POST", path: "/api/v2/clients/subscriptions", bodyClient: true },
  { method: "POST", path: "/api/v2/client_subscriptions", bodyClient: true },
  { method: "POST", path: "/api/v2/subscriptions", bodyClient: true },
  { method: "POST", path: "/api/v2/billing/subscriptions", bodyClient: true }
];

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

async function queryRows(client, sql) {
  const statements = await client.query(sql);
  return statements.find((statement) => Array.isArray(statement.rows))?.rows ?? [];
}

async function sampleClientIds(db) {
  const rows = await queryRows(
    db,
    `SELECT DISTINCT c.external_sweepgo_id
     FROM customers c
     WHERE c.first_recurring_date BETWEEN '2026-06-01'::date AND '2026-06-30'::date
       AND c.external_sweepgo_id IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM webhook_events w
         WHERE w.event_type = 'client:subscription_created'
           AND w.payload #>> '{data,client}' = c.external_sweepgo_id
       )
     ORDER BY c.external_sweepgo_id
     LIMIT 2`
  );
  return rows.map((row) => String(row.external_sweepgo_id)).filter(Boolean);
}

async function juneClientIds(db) {
  const rows = await queryRows(
    db,
    `SELECT external_sweepgo_id
     FROM customers
     WHERE first_recurring_date BETWEEN '2026-06-01'::date AND '2026-06-30'::date
       AND external_sweepgo_id IS NOT NULL
     ORDER BY external_sweepgo_id`
  );
  return rows.map((row) => String(row.external_sweepgo_id)).filter(Boolean);
}

function apiUrl(config, candidate, clientId) {
  const rawPath = candidate.path.replace("{client}", encodeURIComponent(clientId ?? ""));
  const url = new URL(rawPath, config.sweepgoBaseUrl);
  if (candidate.queryClient && clientId) {
    url.searchParams.set("client", clientId);
  }
  return url;
}

async function requestCandidate(config, candidate, clientId) {
  const url = apiUrl(config, candidate, clientId);
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${config.sweepgoApiToken}`
  };
  let body;
  if (candidate.bodyClient) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ client: clientId });
  }
  try {
    const response = await fetch(url, {
      method: candidate.method,
      headers,
      body
    });
    const text = await response.text();
    const parsed = parseJson(text);
    return {
      ok: response.ok,
      status: response.status,
      payload: parsed,
      contentType: response.headers.get("content-type") ?? ""
    };
  } catch (error) {
    return {
      ok: false,
      status: "network_error",
      payload: { errorType: error?.name ?? "Error" },
      contentType: ""
    };
  }
}

function parseJson(text) {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function walk(value, path = "$", out = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, out));
    return out;
  }
  if (!asRecord(value)) {
    out.push({ path, key: lastPathKey(path), value });
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    out.push({ path: nextPath, key, value: child });
    walk(child, nextPath, out);
  }
  return out;
}

function lastPathKey(path) {
  return path.split(".").pop()?.replace(/\[\d+\]$/, "");
}

function scalarValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function fieldAvailability(payload) {
  const entries = walk(payload);
  const fields = {};
  for (const [group, keys] of Object.entries(FIELD_GROUPS)) {
    const found = entries.filter((entry) => keys.includes(entry.key) && scalarValue(entry.value) !== undefined);
    fields[group] = {
      present: found.length > 0,
      paths: [...new Set(found.map((entry) => entry.path))].sort()
    };
  }
  return fields;
}

function responseShape(payload) {
  if (Array.isArray(payload)) {
    return { topLevel: "array", rowCount: payload.length };
  }
  if (asRecord(payload)) {
    return {
      topLevel: "object",
      topLevelKeys: Object.keys(payload).sort(),
      dataRowCount: Array.isArray(payload.data) ? payload.data.length : undefined,
      crossSellCount: Array.isArray(payload.cross_sells) ? payload.cross_sells.length : undefined
    };
  }
  return { topLevel: typeof payload };
}

function isDirectBillingCandidate(candidate, fields) {
  if (candidate.scope && candidate.scope !== "client_sample") {
    return false;
  }
  return fields.subscriptionId.present
    && fields.subscriptionAmount.present
    && fields.billingInterval.present
    && (fields.subscriptionStatus.present || fields.subscriptionName.present);
}

function normalizeInterval(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return undefined;
  }
  if (text === "monthly" || text === "month" || text.includes("monthly")) {
    return "monthly";
  }
  return "non_monthly";
}

function normalizeStatus(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["active", "in_progress", "open", "true", "1"].includes(text)) {
    return "active";
  }
  if (["canceled", "cancelled", "inactive", "deleted", "ended", "expired", "false", "0"].includes(text)) {
    return "inactive";
  }
  if (["paused", "pause"].includes(text)) {
    return "paused";
  }
  return undefined;
}

function amountValue(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return roundMoney(value);
  }
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
    if (match) {
      return roundMoney(Number(match[1]));
    }
  }
  return undefined;
}

function firstByKeys(payload, keys) {
  const entries = walk(payload);
  for (const key of keys) {
    const found = entries.find((entry) => entry.key === key && scalarValue(entry.value) !== undefined);
    if (found) {
      return scalarValue(found.value);
    }
  }
  return undefined;
}

function recordsFromPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.filter(asRecord);
  }
  const record = asRecord(payload);
  if (!record) {
    return [];
  }
  for (const key of ["subscriptions", "active_subscriptions", "client_subscriptions", "data", "billing_subscriptions"]) {
    if (Array.isArray(record[key])) {
      return record[key].filter(asRecord);
    }
  }
  return [record];
}

async function dryRunJuneMrr(config, source, clientIds) {
  const result = {
    attempted: true,
    juneNewRecurringCustomersChecked: clientIds.length,
    customersWithSubscriptionRowsFound: 0,
    activeMonthlySubscriptionsCounted: 0,
    canceledSubscriptionsIgnored: 0,
    pausedSubscriptionsIgnored: 0,
    nonMonthlySubscriptionsNeedingReview: 0,
    customersWithNoSubscriptionRows: 0,
    customersWithAmbiguousAmounts: 0,
    directMrrTotal: 0,
    averageMrrPerPricedCustomer: 0,
    customersNeedingReview: 0
  };

  let pricedCustomers = 0;
  for (const clientId of clientIds) {
    const response = await requestCandidate(config, source, clientId);
    const records = recordsFromPayload(response.payload);
    if (!response.ok || records.length === 0) {
      result.customersWithNoSubscriptionRows += 1;
      result.customersNeedingReview += 1;
      continue;
    }
    result.customersWithSubscriptionRowsFound += 1;
    let customerTotal = 0;
    let countedForCustomer = false;
    let reviewForCustomer = false;
    for (const record of records) {
      const amount = amountValue(firstByKeys(record, FIELD_GROUPS.subscriptionAmount));
      const interval = normalizeInterval(firstByKeys(record, FIELD_GROUPS.billingInterval));
      const status = normalizeStatus(firstByKeys(record, FIELD_GROUPS.subscriptionStatus)) ?? "active";
      if (status === "inactive") {
        result.canceledSubscriptionsIgnored += 1;
        continue;
      }
      if (status === "paused") {
        result.pausedSubscriptionsIgnored += 1;
        continue;
      }
      if (interval !== "monthly") {
        result.nonMonthlySubscriptionsNeedingReview += 1;
        reviewForCustomer = true;
        continue;
      }
      if (amount === undefined) {
        result.customersWithAmbiguousAmounts += 1;
        reviewForCustomer = true;
        continue;
      }
      customerTotal = roundMoney(customerTotal + amount);
      result.activeMonthlySubscriptionsCounted += 1;
      countedForCustomer = true;
    }
    if (countedForCustomer) {
      result.directMrrTotal = roundMoney(result.directMrrTotal + customerTotal);
      pricedCustomers += 1;
    }
    if (reviewForCustomer || !countedForCustomer) {
      result.customersNeedingReview += 1;
    }
  }
  result.averageMrrPerPricedCustomer = pricedCustomers > 0 ? roundMoney(result.directMrrTotal / pricedCustomers) : 0;
  return result;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

async function main() {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (!config.sweepgoApiToken) {
    throw new Error("SWEEPGO_API_TOKEN is required");
  }

  const db = new PostgresClient(parseDatabaseUrl(config.databaseUrl));
  await db.connect();
  try {
    const sampleIds = await sampleClientIds(db);
    const juneIds = await juneClientIds(db);
    const attempts = [];
    const candidates = [];

    for (const candidate of BASE_CANDIDATES) {
      const clientsToTry = candidate.scope === "official_packaged_cross_sells" ? [undefined] : sampleIds;
      for (const clientId of clientsToTry) {
        const response = await requestCandidate(config, candidate, clientId);
        const fields = fieldAvailability(response.payload);
        const directBillingCandidate = response.ok && isDirectBillingCandidate(candidate, fields);
        attempts.push({
          method: candidate.method,
          path: candidate.path,
          scope: candidate.scope ?? "client_sample",
          httpStatus: response.status,
          ok: response.ok,
          responseShape: responseShape(response.payload),
          directBillingCandidate,
          fields
        });
        if (directBillingCandidate) {
          candidates.push(candidate);
        }
      }
    }

    const uniqueCandidates = candidates.filter((candidate, index, all) =>
      all.findIndex((item) => item.method === candidate.method && item.path === candidate.path) === index
    );
    const dryRun = uniqueCandidates.length > 0
      ? await dryRunJuneMrr(config, uniqueCandidates[0], juneIds)
      : {
          attempted: false,
          reasonSkipped: "No direct Billing -> Subscriptions source was discovered."
        };

    const statusCounts = attempts.reduce((counts, attempt) => {
      const key = String(attempt.httpStatus);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});

    process.stdout.write(`${JSON.stringify({
      officialDocsFinding: "The public Sweep&Go Open API docs list clients, client_details, reports, packages, and webhooks, but no documented customer Billing -> Subscriptions read endpoint.",
      sampleCustomersChecked: sampleIds.length,
      juneNewRecurringCustomersAvailable: juneIds.length,
      endpointAttempts: attempts.length,
      endpointStatusCounts: statusCounts,
      directBillingSourcesFound: uniqueCandidates.map((candidate) => ({
        method: candidate.method,
        path: candidate.path,
        scope: candidate.scope ?? "client_sample"
      })),
      successfulNonDirectSources: attempts
        .filter((attempt) => attempt.ok && !attempt.directBillingCandidate)
        .map((attempt) => ({
          method: attempt.method,
          path: attempt.path,
          scope: attempt.scope,
          responseShape: attempt.responseShape,
          fieldPresence: Object.fromEntries(Object.entries(attempt.fields).map(([key, value]) => [key, value.present]))
        })),
      attemptsSummary: attempts.map((attempt) => ({
        method: attempt.method,
        path: attempt.path,
        scope: attempt.scope,
        httpStatus: attempt.httpStatus,
        ok: attempt.ok,
        directBillingCandidate: attempt.directBillingCandidate
      })),
      dryRun
    }, null, 2)}\n`);
  } finally {
    await db.end();
  }
}

await main();
