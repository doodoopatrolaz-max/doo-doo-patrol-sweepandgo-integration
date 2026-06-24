import { loadConfig } from "../src/config.ts";
import { PostgresClient } from "./postgres_tool.mjs";

const EVENT_TYPES = [
  "client:subscription_created",
  "client:subscription_canceled",
  "client:subscription_paused",
  "client:subscription_unpaused",
  "client:client_onboarding_recurring"
];

const FIELD_GROUPS = {
  clientId: ["client", "customer", "client_id", "customer_id", "client_identifier", "clientId", "customerId"],
  subscriptionId: ["subscription_id", "subscriptionId", "subscription"],
  subscriptionName: ["subscription_name", "subscriptionName", "subscription_names", "subscriptionNames"],
  subscriptionStatus: ["status", "state", "state_name", "subscription_status", "subscriptionStatus"],
  subscriptionAmount: ["amount", "price", "monthly_amount", "monthlyAmount", "monthly_price", "monthlyPrice", "subscription_amount", "subscriptionAmount"],
  billingInterval: ["billing_interval", "billingInterval", "interval", "billing_frequency", "billingFrequency", "frequency"],
  billingOption: ["billing_option", "billingOption", "billing_type", "billingType", "payment_option", "paymentOption"],
  eventCreatedDate: ["created", "created_at", "createdAt", "timestamp", "event_timestamp", "eventTimestamp"],
  canceledIndicator: ["canceled_at", "cancelled_at", "canceledAt", "cancelledAt", "cancellation_reason", "cancel_reason", "termination_reason"],
  pausedIndicator: ["paused_at", "pausedAt", "pause_reason", "paused_reason"]
};

function integer(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return Math.round(value * 100) / 100;
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

async function queryRows(client, sql) {
  const statements = await client.query(sql);
  return statements.find((statement) => Array.isArray(statement.rows))?.rows ?? [];
}

function parseJson(value) {
  if (!value) {
    return {};
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return {};
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
    out.push({ path, key: path.split(".").pop()?.replace(/\[\d+\]$/, ""), value });
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    out.push({ path: nextPath, key, value: child });
    walk(child, nextPath, out);
  }
  return out;
}

function firstByKeys(payload, keys) {
  const entries = walk(payload);
  for (const key of keys) {
    const found = entries.find((entry) => entry.key === key && scalarValue(entry.value) !== undefined);
    if (found) {
      return { value: scalarValue(found.value), path: found.path };
    }
  }
  return {};
}

function allByKeys(payload, keys) {
  const entries = walk(payload);
  return entries.filter((entry) => keys.includes(entry.key) && scalarValue(entry.value) !== undefined);
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

function normalizeStatus(value, eventType) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["active", "in_progress", "open"].includes(text)) {
    return "active";
  }
  if (["canceled", "cancelled", "inactive", "deleted", "ended", "expired"].includes(text)) {
    return "inactive";
  }
  if (["paused", "pause"].includes(text)) {
    return "paused";
  }
  if (eventType === "client:subscription_created") {
    return "active_from_event_semantics";
  }
  return undefined;
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

function amountValue(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return money(value);
  }
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
    if (match) {
      return money(Number(match[1]));
    }
  }
  return undefined;
}

function createEventSummary(eventType) {
  return {
    eventType,
    totalEvents: 0,
    mostRecentTimestamp: null,
    clientIdPresent: 0,
    subscriptionIdPresent: 0,
    subscriptionNamePresent: 0,
    subscriptionStatusPresent: 0,
    subscriptionAmountPresent: 0,
    billingIntervalPresent: 0,
    billingOptionPresent: 0,
    createdDatePresent: 0,
    canceledIndicatorPresent: 0,
    pausedIndicatorPresent: 0,
    monthlyDirectAmountCandidates: 0,
    activeOrCreatedActiveCandidates: 0,
    usableLedgerCandidates: 0,
    fieldPaths: Object.fromEntries(Object.keys(FIELD_GROUPS).map((key) => [key, []]))
  };
}

function summarizeEvents(rows) {
  const byType = new Map(EVENT_TYPES.map((eventType) => [eventType, createEventSummary(eventType)]));
  const pathSets = new Map(EVENT_TYPES.map((eventType) => [eventType, Object.fromEntries(Object.keys(FIELD_GROUPS).map((key) => [key, new Set()]))]));

  for (const row of rows) {
    const eventType = row.event_type;
    const summary = byType.get(eventType);
    if (!summary) {
      continue;
    }
    const payload = parseJson(row.payload);
    summary.totalEvents += 1;
    summary.mostRecentTimestamp = row.received_at > (summary.mostRecentTimestamp ?? "") ? row.received_at : summary.mostRecentTimestamp;

    const fields = {};
    for (const [group, keys] of Object.entries(FIELD_GROUPS)) {
      const found = allByKeys(payload, keys);
      if (found.length) {
        summary[`${group}Present`] = (summary[`${group}Present`] ?? 0) + 1;
        for (const entry of found) {
          pathSets.get(eventType)[group].add(entry.path);
        }
      }
      fields[group] = firstByKeys(payload, keys);
    }

    const amount = amountValue(fields.subscriptionAmount.value);
    const interval = normalizeInterval(fields.billingInterval.value);
    const status = normalizeStatus(fields.subscriptionStatus.value, eventType);
    if (amount !== undefined && interval === "monthly") {
      summary.monthlyDirectAmountCandidates += 1;
    }
    if (status === "active" || status === "active_from_event_semantics") {
      summary.activeOrCreatedActiveCandidates += 1;
    }
    if (
      eventType === "client:subscription_created"
      && fields.clientId.value
      && fields.subscriptionId.value
      && amount !== undefined
      && interval === "monthly"
      && (status === "active" || status === "active_from_event_semantics")
    ) {
      summary.usableLedgerCandidates += 1;
    }
  }

  for (const [eventType, summary] of byType) {
    const sets = pathSets.get(eventType);
    for (const group of Object.keys(FIELD_GROUPS)) {
      summary.fieldPaths[group] = [...sets[group]].sort();
    }
  }
  return [...byType.values()];
}

function buildLedgerDryRun(rows, juneCustomerIds) {
  const ledger = new Map();
  const result = {
    attempted: false,
    reasonSkipped: null,
    subscriptionCreatedEventsProcessed: 0,
    subscriptionCanceledEventsProcessed: 0,
    subscriptionPausedEventsProcessed: 0,
    subscriptionUnpausedEventsProcessed: 0,
    activeSubscriptionsReconstructed: 0,
    customersWithMrrCalculated: 0,
    customersNeedingReview: 0,
    totalMrrForJuneNewCustomers: 0
  };

  const createdRows = rows.filter((row) => row.event_type === "client:subscription_created");
  const anyUsableCreated = createdRows.some((row) => {
    const parsed = parseWebhook(row);
    return parsed.clientId && parsed.subscriptionId && parsed.amount !== undefined && parsed.interval === "monthly";
  });

  if (!anyUsableCreated) {
    result.reasonSkipped = "Stored subscription_created events do not include the minimum stable fields needed for a ledger.";
    result.customersNeedingReview = juneCustomerIds.size;
    return result;
  }

  result.attempted = true;
  for (const row of rows.sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)))) {
    const parsed = parseWebhook(row);
    if (!parsed.clientId || !parsed.subscriptionId) {
      continue;
    }
    const key = `${parsed.clientId}:${parsed.subscriptionId}`;
    if (row.event_type === "client:subscription_created") {
      result.subscriptionCreatedEventsProcessed += 1;
      if (parsed.amount !== undefined && parsed.interval === "monthly") {
        ledger.set(key, {
          clientId: parsed.clientId,
          subscriptionId: parsed.subscriptionId,
          amount: parsed.amount,
          status: parsed.status === "paused" ? "paused" : "active"
        });
      }
    }
    if (row.event_type === "client:subscription_canceled" && ledger.has(key)) {
      result.subscriptionCanceledEventsProcessed += 1;
      ledger.get(key).status = "inactive";
    }
    if (row.event_type === "client:subscription_paused" && ledger.has(key)) {
      result.subscriptionPausedEventsProcessed += 1;
      ledger.get(key).status = "paused";
    }
    if (row.event_type === "client:subscription_unpaused" && ledger.has(key)) {
      result.subscriptionUnpausedEventsProcessed += 1;
      ledger.get(key).status = "active";
    }
  }

  const byClient = new Map();
  for (const item of ledger.values()) {
    if (item.status !== "active") {
      continue;
    }
    result.activeSubscriptionsReconstructed += 1;
    byClient.set(item.clientId, money((byClient.get(item.clientId) ?? 0) + item.amount));
  }
  for (const clientId of juneCustomerIds) {
    const amount = byClient.get(clientId);
    if (amount !== undefined) {
      result.customersWithMrrCalculated += 1;
      result.totalMrrForJuneNewCustomers = money(result.totalMrrForJuneNewCustomers + amount);
    } else {
      result.customersNeedingReview += 1;
    }
  }
  return result;
}

function parseWebhook(row) {
  const payload = parseJson(row.payload);
  const clientId = firstByKeys(payload, FIELD_GROUPS.clientId).value;
  const subscriptionId = firstByKeys(payload, FIELD_GROUPS.subscriptionId).value;
  const amount = amountValue(firstByKeys(payload, FIELD_GROUPS.subscriptionAmount).value);
  const interval = normalizeInterval(firstByKeys(payload, FIELD_GROUPS.billingInterval).value);
  const status = normalizeStatus(firstByKeys(payload, FIELD_GROUPS.subscriptionStatus).value, row.event_type);
  return { clientId, subscriptionId, amount, interval, status };
}

async function main() {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const client = new PostgresClient(parseDatabaseUrl(config.databaseUrl));
  await client.connect();
  try {
    const eventRows = await queryRows(
      client,
      `SELECT event_type, received_at::text, payload
       FROM webhook_events
       WHERE event_type IN ('${EVENT_TYPES.join("','")}')
       ORDER BY received_at ASC`
    );
    const juneRows = await queryRows(
      client,
      `SELECT external_sweepgo_id
       FROM customers
       WHERE first_recurring_date BETWEEN '2026-06-01'::date AND '2026-06-30'::date
         AND external_sweepgo_id IS NOT NULL`
    );
    const juneCustomerIds = new Set(juneRows.map((row) => String(row.external_sweepgo_id)));
    const summaries = summarizeEvents(eventRows);
    const created = summaries.find((summary) => summary.eventType === "client:subscription_created");
    const canceled = summaries.find((summary) => summary.eventType === "client:subscription_canceled");
    const paused = summaries.find((summary) => summary.eventType === "client:subscription_paused");
    const unpaused = summaries.find((summary) => summary.eventType === "client:subscription_unpaused");
    const ledgerDryRun = buildLedgerDryRun(eventRows, juneCustomerIds);

    const result = {
      totalEventsInspected: eventRows.length,
      juneNewRecurringCustomers: juneCustomerIds.size,
      eventSummaries: summaries,
      conclusions: {
        subscriptionCreatedIncludesDirectAmount: Boolean(created?.subscriptionAmountPresent),
        subscriptionCreatedIncludesBillingInterval: Boolean(created?.billingIntervalPresent),
        subscriptionCreatedIncludesSubscriptionId: Boolean(created?.subscriptionIdPresent),
        subscriptionCreatedUsableForLedgerNow: Boolean(created?.usableLedgerCandidates),
        cancellationCanMaintainInactiveStatus: Boolean(canceled?.subscriptionIdPresent),
        pauseCanMaintainPausedStatus: Boolean(paused?.subscriptionIdPresent && unpaused?.subscriptionIdPresent),
        webhookDataCanSafelySupportMrrGoingForward: Boolean(
          created?.usableLedgerCandidates
          && canceled?.subscriptionIdPresent
        ),
        existingStoredWebhooksCanBackfillJuneMrr: ledgerDryRun.attempted && ledgerDryRun.customersWithMrrCalculated > 0
      },
      ledgerDryRun
    };

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

await main();
