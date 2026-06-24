import crypto from "node:crypto";
import { loadConfig } from "../src/config.ts";
import { createPool } from "../src/db/pool.ts";

const HASH_KEY = "ddp-sweepandgo-local-csv-dry-run-v1";

function hmac(value) {
  return crypto.createHmac("sha256", HASH_KEY).update(value).digest("hex");
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseProposal() {
  const encoded = process.argv[2];
  if (!encoded) {
    throw new Error("A base64url-encoded backfill proposal is required");
  }
  const proposal = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  const updates = Array.isArray(proposal.updates) ? proposal.updates : [];
  return updates
    .filter((update) => typeof update.customerKey === "string" && validDate(update.firstRecurringDate))
    .map((update) => ({
      customerKey: update.customerKey,
      firstRecurringDate: update.firstRecurringDate
    }));
}

async function snapshot(pool) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM customers)::int AS customers_total,
       (SELECT COUNT(*) FROM contacts)::int AS contacts_total,
       (SELECT COUNT(*) FROM customer_services)::int AS services_total,
       (SELECT COUNT(*) FROM customer_sources)::int AS customer_sources_total,
       (SELECT COUNT(*) FROM cancellations)::int AS cancellations_total,
       (SELECT COUNT(*) FROM customers WHERE first_recurring_date IS NOT NULL)::int AS customers_with_first_recurring_date,
       (SELECT COUNT(*) FROM customers WHERE first_recurring_date BETWEEN date_trunc('month', NOW() AT TIME ZONE 'America/Phoenix')::date AND (NOW() AT TIME ZONE 'America/Phoenix')::date)::int AS month_to_date_new_recurring`
  );
  const row = result.rows[0] ?? {};
  return {
    customersTotal: integer(row.customers_total),
    contactsTotal: integer(row.contacts_total),
    servicesTotal: integer(row.services_total),
    customerSourcesTotal: integer(row.customer_sources_total),
    cancellationsTotal: integer(row.cancellations_total),
    customersWithFirstRecurringDate: integer(row.customers_with_first_recurring_date),
    monthToDateNewRecurring: integer(row.month_to_date_new_recurring)
  };
}

async function applyUpdates(pool, updates) {
  if (!updates.length) {
    return {
      rowsUpdated: 0,
      rowsSkipped: 0,
      matchedActiveBlankCustomers: 0,
      unmatchedProposalRows: 0
    };
  }

  const result = await pool.query(
    `WITH proposal AS (
       SELECT *
       FROM jsonb_to_recordset($1::jsonb) AS p(customer_key text, first_recurring_date date)
     ),
     matched AS (
       SELECT cu.id,
              p.first_recurring_date
       FROM customers cu
       JOIN proposal p ON p.customer_key = encode(hmac(cu.id::text, $2::text, 'sha256'), 'hex')
       WHERE cu.external_sweepgo_id IS NOT NULL
         AND cu.first_recurring_date IS NULL
     ),
     updated AS (
       UPDATE customers cu
       SET first_recurring_date = matched.first_recurring_date,
           updated_at = NOW(),
           metadata = cu.metadata || $3::jsonb
       FROM matched
       WHERE cu.id = matched.id
       RETURNING cu.id
     )
     SELECT
       (SELECT COUNT(*) FROM proposal)::int AS proposed_rows,
       (SELECT COUNT(*) FROM matched)::int AS matched_active_blank_customers,
       (SELECT COUNT(*) FROM updated)::int AS rows_updated`,
    [
      JSON.stringify(updates.map((update) => ({
        customer_key: update.customerKey,
        first_recurring_date: update.firstRecurringDate
      }))),
      HASH_KEY,
      JSON.stringify({
        firstRecurringDateBackfillSource: "sweepandgo_active_clients_csv",
        firstRecurringDateBackfilledAt: new Date().toISOString()
      })
    ]
  );
  const row = result.rows[0] ?? {};
  const proposedRows = integer(row.proposed_rows);
  const matchedActiveBlankCustomers = integer(row.matched_active_blank_customers);
  const rowsUpdated = integer(row.rows_updated);
  return {
    rowsUpdated,
    rowsSkipped: proposedRows - rowsUpdated,
    matchedActiveBlankCustomers,
    unmatchedProposalRows: proposedRows - matchedActiveBlankCustomers
  };
}

async function main() {
  const updates = parseProposal();
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = await createPool(config.databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await snapshot(client);
    const applyResult = await applyUpdates(client, updates);
    const after = await snapshot(client);
    await client.query("COMMIT");

    process.stdout.write(
      `${JSON.stringify({
        proposedRows: updates.length,
        rowsUpdated: applyResult.rowsUpdated,
        rowsSkipped: applyResult.rowsSkipped,
        matchedActiveBlankCustomers: applyResult.matchedActiveBlankCustomers,
        unmatchedProposalRows: applyResult.unmatchedProposalRows,
        before,
        after,
        countChanges: {
          customers: after.customersTotal - before.customersTotal,
          contacts: after.contactsTotal - before.contactsTotal,
          services: after.servicesTotal - before.servicesTotal,
          customerSources: after.customerSourcesTotal - before.customerSourcesTotal,
          cancellations: after.cancellationsTotal - before.cancellationsTotal,
          customersWithFirstRecurringDate: after.customersWithFirstRecurringDate - before.customersWithFirstRecurringDate,
          monthToDateNewRecurring: after.monthToDateNewRecurring - before.monthToDateNewRecurring
        }
      }, null, 2)}\n`
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
