import { loadConfig } from "../src/config.ts";
import { createPool } from "../src/db/pool.ts";

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main() {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = await createPool(config.databaseUrl);
  try {
    const result = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM contacts)::int AS contacts_total,
         (SELECT COUNT(*) FROM customers)::int AS customers_total,
         (SELECT COUNT(*) FROM customer_services)::int AS services_total,
         (SELECT COUNT(*) FROM customers WHERE external_sweepgo_id IS NOT NULL)::int AS sweepgo_customers,
         (SELECT COUNT(*)
            FROM customers cu
            JOIN contacts c ON c.id = cu.contact_id
           WHERE cu.external_sweepgo_id IS NOT NULL)::int AS sweepgo_customer_contacts,
         (SELECT COUNT(*)
            FROM customers cu
            JOIN contacts c ON c.id = cu.contact_id
           WHERE cu.external_sweepgo_id IS NOT NULL
             AND NULLIF(c.primary_email, '') IS NOT NULL)::int AS sweepgo_contacts_with_email,
         (SELECT COUNT(*)
            FROM customers cu
            JOIN contacts c ON c.id = cu.contact_id
           WHERE cu.external_sweepgo_id IS NOT NULL
             AND NULLIF(c.primary_phone, '') IS NOT NULL)::int AS sweepgo_contacts_with_phone,
         (SELECT COUNT(*)
            FROM (
              SELECT LOWER(c.primary_email)
              FROM customers cu
              JOIN contacts c ON c.id = cu.contact_id
              WHERE cu.external_sweepgo_id IS NOT NULL
                AND NULLIF(c.primary_email, '') IS NOT NULL
              GROUP BY LOWER(c.primary_email)
              HAVING COUNT(*) > 1
            ) duplicate_email_groups)::int AS duplicate_email_groups,
         (SELECT COUNT(*)
            FROM (
              SELECT c.primary_phone
              FROM customers cu
              JOIN contacts c ON c.id = cu.contact_id
              WHERE cu.external_sweepgo_id IS NOT NULL
                AND NULLIF(c.primary_phone, '') IS NOT NULL
              GROUP BY c.primary_phone
              HAVING COUNT(*) > 1
            ) duplicate_phone_groups)::int AS duplicate_phone_groups,
         (SELECT COUNT(*)
            FROM sync_runs
           WHERE provider = 'sweepandgo'
             AND sync_type = 'sweepandgo_contact_enrichment')::int AS enrichment_sync_runs`
    );

    const row = result.rows[0] ?? {};
    process.stdout.write(
      `${JSON.stringify({
        contactsTotal: integer(row.contacts_total),
        customersTotal: integer(row.customers_total),
        servicesTotal: integer(row.services_total),
        sweepAndGoCustomers: integer(row.sweepgo_customers),
        sweepAndGoCustomerContacts: integer(row.sweepgo_customer_contacts),
        sweepAndGoContactsWithEmail: integer(row.sweepgo_contacts_with_email),
        sweepAndGoContactsWithPhone: integer(row.sweepgo_contacts_with_phone),
        duplicateEmailGroups: integer(row.duplicate_email_groups),
        duplicatePhoneGroups: integer(row.duplicate_phone_groups),
        enrichmentSyncRuns: integer(row.enrichment_sync_runs)
      }, null, 2)}\n`
    );
  } finally {
    await pool.end();
  }
}

await main();
