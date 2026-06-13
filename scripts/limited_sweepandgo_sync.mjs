import { PostgresClient } from "./postgres_tool.mjs";
import {
  extractSweepAndGoRows,
  mapSweepAndGoCustomer,
  mapSweepAndGoLead
} from "../src/sweepandgo/reportingMapper.ts";

export async function runLimitedSweepAndGoSync() {
  const db = new PostgresClient(parseDatabaseUrl(process.env.DATABASE_URL));
  await db.connect();
  const startedAt = new Date().toISOString();
  const syncRun = await one(db, `INSERT INTO sync_runs (provider, sync_type, status, started_at)
    VALUES ('sweepandgo', 'sweepandgo_daily', 'started', NOW())
    RETURNING id::text, started_at::text`);

  const counts = {
    apiRecordsRead: 0,
    contactsInserted: 0,
    contactsUpdated: 0,
    customersInserted: 0,
    customersUpdated: 0,
    customerServicesInserted: 0,
    customerServicesUpdated: 0,
    customerSourcesInserted: 0,
    customerSourcesUpdated: 0,
    leadsInserted: 0,
    leadsUpdated: 0,
    activeRecurring: 0,
    oneTime: 0,
    inactive: 0,
    sourceFacebook: 0,
    sourceWebsite: 0,
    sourceOther: 0,
    sourceUnknown: 0,
    recordsSkipped: 0,
    errors: 0,
    dataQualityIssues: []
  };

  try {
    const customers = [
      ["active", await sweepGet("/api/v1/clients/active?page=1")],
      ["active_no_subscription", await sweepGet("/api/v1/clients/active_no_subscription?page=1")],
      ["inactive", await sweepGet("/api/v1/clients/inactive?page=1")]
    ];

    const seenClientIds = new Set();
    for (const [listType, response] of customers) {
      for (const row of extractSweepAndGoRows(response)) {
        counts.apiRecordsRead += 1;
        const mapped = mapSweepAndGoCustomer(row, listType);
        if (!mapped) {
          counts.recordsSkipped += 1;
          counts.dataQualityIssues.push("customer_missing_external_id");
          continue;
        }

        if (seenClientIds.has(mapped.externalCustomerId)) {
          counts.dataQualityIssues.push("duplicate_sweepandgo_client_id_in_limited_api_window");
        }
        seenClientIds.add(mapped.externalCustomerId);

        if (mapped.hasActiveSubscription) counts.activeRecurring += 1;
        if (mapped.isOneTimeClient) counts.oneTime += 1;
        if (mapped.status === "inactive") counts.inactive += 1;
        incrementSource(counts, mapped.source);
        if (!mapped.subscriptionNames && mapped.status === "active" && !mapped.isOneTimeClient) {
          counts.dataQualityIssues.push("active_customer_missing_subscription_names");
        }
        if (mapped.sourceRaw && mapped.source === "other") {
          counts.dataQualityIssues.push("unexpected_or_other_tracking_field_value");
        }

        await upsertCustomer(db, mapped, counts);
      }
    }

    const leads = await sweepGet("/api/v1/leads/list?page=1");
    for (const row of extractSweepAndGoRows(leads)) {
      counts.apiRecordsRead += 1;
      const mapped = mapSweepAndGoLead(row);
      if (!mapped) {
        counts.recordsSkipped += 1;
        counts.dataQualityIssues.push("lead_missing_external_id");
        continue;
      }
      incrementSource(counts, mapped.source);
      await upsertLead(db, mapped, counts);
    }

    const completed = await one(db, `UPDATE sync_runs
      SET status = 'completed',
          completed_at = NOW(),
          records_read = ${numberLiteral(counts.apiRecordsRead)},
          records_written = ${numberLiteral(counts.contactsInserted + counts.contactsUpdated + counts.customersInserted + counts.customersUpdated + counts.leadsInserted + counts.leadsUpdated)}
      WHERE id = ${literal(syncRun.id)}
      RETURNING status, started_at::text, completed_at::text`);

    await db.end();

    return {
      ...counts,
      dataQualityIssues: summarizeIssues(counts.dataQualityIssues),
      syncRunStatus: completed.status,
      syncStartedAt: completed.started_at,
      syncCompletedAt: completed.completed_at,
      localStartedAt: startedAt
    };
  } catch (error) {
    counts.errors += 1;
    await db.query(`UPDATE sync_runs
      SET status = 'failed',
          completed_at = NOW(),
          error_message = ${literal(error.message)}
      WHERE id = ${literal(syncRun.id)}`);
    await db.end();
    throw error;
  }
}

async function upsertCustomer(db, mapped, counts) {
  const contact = await one(db, `INSERT INTO contacts (external_sweepgo_id, metadata)
    VALUES (${literal(mapped.externalCustomerId)}, ${jsonLiteral({ lastSweepAndGoSyncAt: new Date().toISOString() })})
    ON CONFLICT (external_sweepgo_id)
    DO UPDATE SET metadata = contacts.metadata || EXCLUDED.metadata,
                  updated_at = NOW()
    RETURNING id::text, (xmax = 0)::text AS inserted`);
  incrementInserted(counts, "contacts", contact.inserted);

  const customer = await one(db, `INSERT INTO customers (
      contact_id,
      external_sweepgo_id,
      status,
      source,
      source_raw,
      monthly_recurring_revenue,
      metadata
    )
    VALUES (
      ${literal(contact.id)},
      ${literal(mapped.externalCustomerId)},
      ${literal(mapped.status)},
      ${literal(mapped.source)},
      ${literal(mapped.sourceRaw)},
      NULL,
      ${jsonLiteral({
        hasActiveSubscription: mapped.hasActiveSubscription,
        isPaused: mapped.isPaused,
        isOneTimeClient: mapped.isOneTimeClient,
        cleanupFrequency: mapped.cleanupFrequency,
        subscriptionNames: mapped.subscriptionNames,
        serviceDays: mapped.serviceDays,
        sourceEvidenceField: mapped.sourceEvidenceField
      })}
    )
    ON CONFLICT (external_sweepgo_id)
    DO UPDATE SET status = EXCLUDED.status,
                  source = EXCLUDED.source,
                  source_raw = EXCLUDED.source_raw,
                  metadata = EXCLUDED.metadata,
                  updated_at = NOW()
    RETURNING id::text, (xmax = 0)::text AS inserted`);
  incrementInserted(counts, "customers", customer.inserted);

  const service = await one(db, `INSERT INTO customer_services (
      customer_id,
      external_service_id,
      cadence,
      service_name,
      frequency,
      metadata
    )
    VALUES (
      ${literal(customer.id)},
      ${literal(`${mapped.externalCustomerId}:primary`)},
      ${literal(mapped.serviceCadence)},
      ${literal(mapped.subscriptionNames)},
      ${literal(mapped.cleanupFrequency)},
      ${jsonLiteral({ source: "sweepandgo_limited_sync" })}
    )
    ON CONFLICT (customer_id, external_service_id)
    DO UPDATE SET cadence = EXCLUDED.cadence,
                  service_name = EXCLUDED.service_name,
                  frequency = EXCLUDED.frequency,
                  metadata = EXCLUDED.metadata,
                  updated_at = NOW()
    RETURNING id::text, (xmax = 0)::text AS inserted`);
  incrementInserted(counts, "customerServices", service.inserted);

  if (mapped.source !== "unknown" || mapped.sourceRaw) {
    const source = await one(db, `INSERT INTO customer_sources (
        customer_id,
        source,
        source_raw,
        source_provider,
        evidence
      )
      VALUES (
        ${literal(customer.id)},
        ${literal(mapped.source)},
        ${literal(mapped.sourceRaw)},
        'sweepandgo',
        ${jsonLiteral({ field: mapped.sourceEvidenceField })}
      )
      ON CONFLICT (customer_id, source_provider, source_raw)
      DO UPDATE SET source = EXCLUDED.source,
                    evidence = EXCLUDED.evidence,
                    updated_at = NOW()
      RETURNING id::text, (xmax = 0)::text AS inserted`);
    incrementInserted(counts, "customerSources", source.inserted);
  }
}

async function upsertLead(db, mapped, counts) {
  const lead = await one(db, `INSERT INTO leads (
      provider,
      external_lead_id,
      source,
      source_raw,
      stage_name,
      metadata
    )
    VALUES (
      'sweepandgo',
      ${literal(mapped.externalLeadId)},
      ${literal(mapped.source)},
      ${literal(mapped.sourceRaw)},
      ${literal(mapped.status)},
      ${jsonLiteral({ type: mapped.type, sourceEvidenceField: mapped.sourceEvidenceField })}
    )
    ON CONFLICT (provider, external_lead_id)
    DO UPDATE SET source = EXCLUDED.source,
                  source_raw = EXCLUDED.source_raw,
                  stage_name = EXCLUDED.stage_name,
                  metadata = EXCLUDED.metadata,
                  updated_at = NOW()
    RETURNING id::text, (xmax = 0)::text AS inserted`);

  if (lead.inserted === "true") counts.leadsInserted += 1;
  else counts.leadsUpdated += 1;
}

async function sweepGet(path) {
  const base = process.env.SWEEPGO_BASE_URL.replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${process.env.SWEEPGO_API_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error(`Sweep&Go read failed with HTTP ${response.status}`);
  }
  return await response.json();
}

async function one(db, sql) {
  const statements = await db.query(sql);
  const rows = statements.at(-1)?.rows ?? [];
  return rows[0] ?? {};
}

function incrementSource(counts, source) {
  if (source === "facebook") counts.sourceFacebook += 1;
  else if (source === "website") counts.sourceWebsite += 1;
  else if (source === "other") counts.sourceOther += 1;
  else counts.sourceUnknown += 1;
}

function incrementInserted(counts, prefix, inserted) {
  if (inserted === "true") counts[`${prefix}Inserted`] += 1;
  else counts[`${prefix}Updated`] += 1;
}

function summarizeIssues(issues) {
  const output = {};
  for (const issue of issues) {
    output[issue] = (output[issue] ?? 0) + 1;
  }
  return output;
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

function literal(value) {
  if (value === undefined || value === null || value === "") return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsonLiteral(value) {
  return `${literal(JSON.stringify(value))}::jsonb`;
}

function numberLiteral(value) {
  return Number.isFinite(value) ? String(value) : "0";
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const result = await runLimitedSweepAndGoSync();
  console.log(JSON.stringify(result, null, 2));
}
