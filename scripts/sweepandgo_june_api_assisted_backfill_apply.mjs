import crypto from "node:crypto";
import { loadConfig } from "../src/config.ts";
import { createPool } from "../src/db/pool.ts";
import { SweepAndGoClient } from "../src/sweepandgo/client.ts";
import { extractSweepAndGoRows } from "../src/sweepandgo/reportingMapper.ts";

const HASH_KEY = "ddp-sweepandgo-local-csv-dry-run-v1";

function hmac(value) {
  return crypto.createHmac("sha256", HASH_KEY).update(value).digest("hex");
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizePhone(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }
  const digits = String(value).replace(/\D+/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function stringValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function isJune2026(date) {
  return date >= "2026-06-01" && date <= "2026-06-30";
}

function indexByHash(rows, key) {
  const index = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!value) {
      continue;
    }
    const list = index.get(value) ?? [];
    list.push(row);
    index.set(value, list);
  }
  return index;
}

function parsePayload() {
  const encoded = process.argv[2];
  if (!encoded) {
    throw new Error("A base64url-encoded CSV hash payload is required");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  return Array.isArray(payload.rows) ? payload.rows : [];
}

async function loadApiClients(config) {
  const client = new SweepAndGoClient(config);
  const response = await client.getActiveClients({ allPages: true, maxPages: 100 });
  return extractSweepAndGoRows(response).map((row) => {
    const externalSweepGoId = stringValue(row.client);
    const email = normalizeEmail(row.email);
    const phone = normalizePhone(row.cell_phone);
    return {
      externalSweepGoId,
      email,
      phone,
      emailHash: email ? hmac(`email:${email}`) : null,
      phoneHash: phone ? hmac(`phone:${phone}`) : null
    };
  }).filter((row) => row.externalSweepGoId);
}

function resolveApiMatch(csvRow, emailIndex, phoneIndex) {
  const emailMatches = csvRow.emailHash ? emailIndex.get(csvRow.emailHash) ?? [] : [];
  const phoneMatches = csvRow.phoneHash ? phoneIndex.get(csvRow.phoneHash) ?? [] : [];
  const uniqueEmail = emailMatches.length === 1 ? emailMatches[0] : undefined;
  const uniquePhone = phoneMatches.length === 1 ? phoneMatches[0] : undefined;

  if (emailMatches.length > 1 || phoneMatches.length > 1) {
    return { type: "ambiguous" };
  }
  if (uniqueEmail && uniquePhone && uniqueEmail.externalSweepGoId !== uniquePhone.externalSweepGoId) {
    return { type: "ambiguous" };
  }
  if (uniqueEmail) {
    return { type: "email", apiClient: uniqueEmail };
  }
  if (uniquePhone) {
    return { type: "phone", apiClient: uniquePhone };
  }
  return { type: "none" };
}

async function snapshot(client) {
  const result = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM customers)::int AS customers_total,
       (SELECT COUNT(*) FROM contacts)::int AS contacts_total,
       (SELECT COUNT(*) FROM customer_services)::int AS services_total,
       (SELECT COUNT(*) FROM customer_sources)::int AS customer_sources_total,
       (SELECT COUNT(*) FROM cancellations)::int AS cancellations_total,
       (SELECT COUNT(*) FROM customers WHERE first_recurring_date IS NOT NULL)::int AS first_recurring_rows,
       (SELECT COUNT(*) FROM customers WHERE first_recurring_date BETWEEN '2026-06-01'::date AND '2026-06-30'::date)::int AS june_new_recurring,
       (SELECT COUNT(*) FROM (SELECT external_sweepgo_id FROM customers WHERE external_sweepgo_id IS NOT NULL GROUP BY external_sweepgo_id HAVING COUNT(*) > 1) duplicates)::int AS duplicate_customer_external_ids,
       (SELECT COUNT(*) FROM (SELECT external_sweepgo_id FROM contacts WHERE external_sweepgo_id IS NOT NULL GROUP BY external_sweepgo_id HAVING COUNT(*) > 1) duplicates)::int AS duplicate_contact_external_ids`
  );
  const row = result.rows[0] ?? {};
  return {
    customersTotal: Number(row.customers_total ?? 0),
    contactsTotal: Number(row.contacts_total ?? 0),
    servicesTotal: Number(row.services_total ?? 0),
    customerSourcesTotal: Number(row.customer_sources_total ?? 0),
    cancellationsTotal: Number(row.cancellations_total ?? 0),
    firstRecurringRows: Number(row.first_recurring_rows ?? 0),
    juneNewRecurring: Number(row.june_new_recurring ?? 0),
    duplicateCustomerExternalIds: Number(row.duplicate_customer_external_ids ?? 0),
    duplicateContactExternalIds: Number(row.duplicate_contact_external_ids ?? 0)
  };
}

async function existingCustomers(client) {
  const result = await client.query(
    `SELECT external_sweepgo_id,
            first_recurring_date
     FROM customers
     WHERE external_sweepgo_id IS NOT NULL`
  );
  return new Map(result.rows.map((row) => [
    stringValue(row.external_sweepgo_id),
    { firstRecurringDate: row.first_recurring_date }
  ]));
}

async function upsertJuneCustomer(client, match, firstRecurringDate) {
  const contactResult = await client.query(
    `INSERT INTO contacts (external_sweepgo_id, primary_email, primary_phone, metadata)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (external_sweepgo_id)
     DO UPDATE SET primary_email = COALESCE(NULLIF(contacts.primary_email, ''), EXCLUDED.primary_email),
                   primary_phone = COALESCE(NULLIF(contacts.primary_phone, ''), EXCLUDED.primary_phone),
                   metadata = contacts.metadata || EXCLUDED.metadata,
                   updated_at = NOW()
     RETURNING id`,
    [
      match.externalSweepGoId,
      match.email || null,
      match.phone || null,
      JSON.stringify({
        june2026BackfillContactSource: "sweepandgo_active_api",
        june2026BackfilledAt: new Date().toISOString()
      })
    ]
  );

  const customerResult = await client.query(
    `INSERT INTO customers (contact_id, external_sweepgo_id, status, source, first_recurring_date, metadata)
     VALUES ($1, $2, 'active', 'unknown', $3::date, $4::jsonb)
     ON CONFLICT (external_sweepgo_id)
     DO UPDATE SET first_recurring_date = COALESCE(customers.first_recurring_date, EXCLUDED.first_recurring_date),
                   status = CASE WHEN customers.status = 'unknown' THEN EXCLUDED.status ELSE customers.status END,
                   metadata = customers.metadata || EXCLUDED.metadata,
                   updated_at = NOW()
     RETURNING (xmax = 0) AS inserted`,
    [
      contactResult.rows[0].id,
      match.externalSweepGoId,
      firstRecurringDate,
      JSON.stringify({
        firstRecurringDateBackfillSource: "sweepandgo_active_clients_csv_api_bridge",
        firstRecurringDateBackfilledAt: new Date().toISOString(),
        sourceDeferred: true,
        mrrDeferred: true,
        cancellationsUnchanged: true
      })
    ]
  );

  return {
    contactId: contactResult.rows[0].id,
    customerInserted: customerResult.rows[0]?.inserted === true
  };
}

async function main() {
  const rows = parsePayload();
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const apiRows = await loadApiClients(config);
  const emailIndex = indexByHash(apiRows, "emailHash");
  const phoneIndex = indexByHash(apiRows, "phoneHash");
  const pool = await createPool(config.databaseUrl);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const before = await snapshot(client);
    const beforeCustomers = await existingCustomers(client);
    const alreadyPlanned = new Set();
    const result = {
      juneRowsEvaluated: 0,
      uniqueApiMatches: 0,
      skippedManualReview: 0,
      skippedAlreadyInBiWithFirstRecurringDate: 0,
      skippedExistingBiMissingDate: 0,
      rowsCreatedOrUpdated: 0,
      contactsCreatedOrUpdated: 0,
      customersCreated: 0,
      firstRecurringDatesSet: 0
    };

    for (const row of rows) {
      const createdAt = stringValue(row.createdAt);
      if (!isJune2026(createdAt)) {
        continue;
      }
      result.juneRowsEvaluated += 1;
      const match = resolveApiMatch(row, emailIndex, phoneIndex);
      if (match.type === "ambiguous" || match.type === "none" || !match.apiClient) {
        result.skippedManualReview += 1;
        continue;
      }
      result.uniqueApiMatches += 1;

      const existing = beforeCustomers.get(match.apiClient.externalSweepGoId);
      if (existing?.firstRecurringDate) {
        result.skippedAlreadyInBiWithFirstRecurringDate += 1;
        continue;
      }
      if (existing && !existing.firstRecurringDate) {
        result.skippedExistingBiMissingDate += 1;
        continue;
      }
      if (alreadyPlanned.has(match.apiClient.externalSweepGoId)) {
        result.skippedManualReview += 1;
        continue;
      }
      alreadyPlanned.add(match.apiClient.externalSweepGoId);

      const update = await upsertJuneCustomer(client, match.apiClient, createdAt);
      result.rowsCreatedOrUpdated += 1;
      result.contactsCreatedOrUpdated += 1;
      if (update.customerInserted) {
        result.customersCreated += 1;
      }
      result.firstRecurringDatesSet += 1;
    }

    const after = await snapshot(client);
    await client.query("COMMIT");
    process.stdout.write(`${JSON.stringify({
      ...result,
      before,
      after,
      countChanges: {
        customers: after.customersTotal - before.customersTotal,
        contacts: after.contactsTotal - before.contactsTotal,
        services: after.servicesTotal - before.servicesTotal,
        customerSources: after.customerSourcesTotal - before.customerSourcesTotal,
        cancellations: after.cancellationsTotal - before.cancellationsTotal,
        firstRecurringRows: after.firstRecurringRows - before.firstRecurringRows,
        juneNewRecurring: after.juneNewRecurring - before.juneNewRecurring,
        duplicateCustomerExternalIds: after.duplicateCustomerExternalIds - before.duplicateCustomerExternalIds,
        duplicateContactExternalIds: after.duplicateContactExternalIds - before.duplicateContactExternalIds
      }
    }, null, 2)}\n`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
