import { loadConfig } from "../src/config.ts";
import { PostgresClient } from "./postgres_tool.mjs";

const EXPECTED_FACEBOOK_EXCLUSIONS = 11;
const EXPECTED_WEBSITE_EXCLUSIONS = 9;
const RANGE = { start: "2026-06-01", end: "2026-06-30" };
const REASON = "controlled_test_or_setup_record";
const SOURCE = "phase_9b_denominator_reconciliation";
const METRICS = [
  "lead_denominator",
  "dashboard_leads",
  "cost_per_new_customer_denominator"
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

async function queryAll(client, sql) {
  return await client.query(sql);
}

const explicitCandidateCte = `
WITH explicit_candidates AS (
  SELECT
    o.external_opportunity_id,
    o.original_lead_source,
    (
      COALESCE(c.primary_email, $$ $$) ILIKE $$%example.%$$
      OR COALESCE(c.primary_email, $$ $$) ILIKE $$%test%$$
      OR COALESCE(c.primary_phone, $$ $$) LIKE $$%555%$$
      OR COALESCE(c.full_name, $$ $$) ILIKE $$%BI Test%$$
      OR COALESCE(c.full_name, $$ $$) ILIKE $$%Webhook Test%$$
      OR o.metadata::text ILIKE $$%BI Test%$$
      OR o.metadata::text ILIKE $$%Webhook Test%$$
      OR o.metadata::text ILIKE $$%Facebook Fresh%$$
      OR o.metadata::text ILIKE $$%Facebook Created%$$
      OR o.metadata::text ILIKE $$%Facebook HTTPS Fixed%$$
      OR o.metadata::text ILIKE $$%Facebook Custom Data%$$
      OR o.metadata::text ILIKE $$%Facebook Lead Source%$$
      OR o.metadata::text ILIKE $$%Website Lead Source%$$
      OR o.metadata::text ILIKE $$%synthetic%$$
      OR o.metadata::text ILIKE $$%phase4%$$
      OR o.metadata::text ILIKE $$%phase9%$$
      OR c.metadata::text ILIKE $$%BI Test%$$
      OR c.metadata::text ILIKE $$%Webhook Test%$$
      OR c.metadata::text ILIKE $$%synthetic%$$
      OR c.metadata::text ILIKE $$%phase4%$$
      OR c.metadata::text ILIKE $$%phase9%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%BI Test%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%Webhook Test%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%Facebook Fresh%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%Facebook Created%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%Facebook HTTPS Fixed%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%Facebook Custom Data%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%Facebook Lead Source%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%Website Lead Source%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%test@example.com%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%602-555%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%synthetic%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%phase4%$$
      OR COALESCE(ie.payload::text, $$ $$) ILIKE $$%phase9%$$
    ) AS explicit_test_marker
  FROM opportunities o
  LEFT JOIN contacts c ON c.id = o.contact_id
  LEFT JOIN integration_events ie ON ie.id::text = o.metadata->>$$webhookEventId$$
  WHERE o.provider = $$gohighlevel$$
    AND o.original_lead_source IN ($$facebook$$, $$website$$)
    AND o.original_lead_date::date BETWEEN $$${RANGE.start}$$::date AND $$${RANGE.end}$$::date
)
`;

async function currentCounts(client) {
  const rows = await queryRows(
    client,
    `SELECT
       COUNT(*) FILTER (WHERE original_lead_source = $$facebook$$)::int AS facebook,
       COUNT(*) FILTER (WHERE original_lead_source = $$website$$)::int AS website,
       COUNT(*)::int AS total
     FROM opportunities o
     WHERE o.provider = $$gohighlevel$$
       AND o.original_lead_source IN ($$facebook$$, $$website$$)
       AND o.original_lead_date::date BETWEEN $$${RANGE.start}$$::date AND $$${RANGE.end}$$::date
       AND NOT EXISTS (
         SELECT 1
         FROM reporting_exclusions re
         WHERE re.provider = $$gohighlevel$$
           AND re.entity_type = $$opportunity$$
           AND re.entity_external_id = o.external_opportunity_id
           AND re.applies_to_metric && ARRAY[$$lead_denominator$$, $$dashboard_leads$$]
       )`
  );
  return mapCountRow(rows[0]);
}

async function rawCounts(client) {
  const rows = await queryRows(
    client,
    `SELECT
       COUNT(*) FILTER (WHERE original_lead_source = $$facebook$$)::int AS facebook,
       COUNT(*) FILTER (WHERE original_lead_source = $$website$$)::int AS website,
       COUNT(*)::int AS total
     FROM opportunities
     WHERE provider = $$gohighlevel$$
       AND original_lead_source IN ($$facebook$$, $$website$$)
       AND original_lead_date::date BETWEEN $$${RANGE.start}$$::date AND $$${RANGE.end}$$::date`
  );
  return mapCountRow(rows[0]);
}

async function candidateCounts(client) {
  const rows = await queryRows(
    client,
    `${explicitCandidateCte}
     SELECT
       COUNT(*) FILTER (WHERE original_lead_source = $$facebook$$ AND explicit_test_marker)::int AS facebook,
       COUNT(*) FILTER (WHERE original_lead_source = $$website$$ AND explicit_test_marker)::int AS website,
       COUNT(*) FILTER (WHERE explicit_test_marker)::int AS total,
       COUNT(*) FILTER (WHERE explicit_test_marker AND external_opportunity_id IS NULL)::int AS missing_external_id
     FROM explicit_candidates`
  );
  return {
    ...mapCountRow(rows[0]),
    missingExternalId: integer(rows[0]?.missing_external_id)
  };
}

async function existingExclusionCount(client) {
  const rows = await queryRows(
    client,
    `SELECT COUNT(*)::int AS count
     FROM reporting_exclusions
     WHERE provider = $$gohighlevel$$
       AND entity_type = $$opportunity$$
       AND reason = $$${REASON}$$
       AND source = $$${SOURCE}$$
       AND applies_to_metric && ARRAY[$$lead_denominator$$, $$dashboard_leads$$]`
  );
  return integer(rows[0]?.count);
}

async function insertExclusions(client) {
  const rows = await queryRows(
    client,
    `${explicitCandidateCte}
     INSERT INTO reporting_exclusions (
       provider,
       entity_type,
       entity_external_id,
       reason,
       source,
       applies_to_metric,
       metadata
     )
     SELECT
       $$gohighlevel$$,
       $$opportunity$$,
       external_opportunity_id,
       $$${REASON}$$,
       $$${SOURCE}$$,
       ARRAY[${METRICS.map((metric) => `$$${metric}$$`).join(", ")}],
       jsonb_build_object(
         $$detected_by$$, $$explicit_test_marker$$,
         $$reconciliation_month$$, $$2026-06$$
       )
     FROM explicit_candidates
     WHERE explicit_test_marker
       AND external_opportunity_id IS NOT NULL
     ON CONFLICT (provider, entity_type, entity_external_id, reason, source) DO NOTHING
     RETURNING entity_type`
  );
  return rows.length;
}

function mapCountRow(row) {
  return {
    facebook: integer(row?.facebook),
    website: integer(row?.website),
    total: integer(row?.total)
  };
}

function integer(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function closeRates(input) {
  return {
    facebookCloseRate: pct(0, input.facebook),
    websiteCloseRate: pct(3, input.website),
    totalCloseRate: pct(3, input.total)
  };
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : null;
}

async function main() {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const db = new PostgresClient(parseDatabaseUrl(config.databaseUrl));
  await db.connect();
  try {
    const beforeRaw = await rawCounts(db);
    const beforeReportingEligible = await currentCounts(db);
    const candidates = await candidateCounts(db);
    const existingBefore = await existingExclusionCount(db);

    if (
      candidates.facebook !== EXPECTED_FACEBOOK_EXCLUSIONS
      || candidates.website !== EXPECTED_WEBSITE_EXCLUSIONS
      || candidates.total !== EXPECTED_FACEBOOK_EXCLUSIONS + EXPECTED_WEBSITE_EXCLUSIONS
      || candidates.missingExternalId !== 0
    ) {
      throw new Error("Reporting exclusion apply stopped because explicit candidate counts do not match approval");
    }

    await queryAll(db, "BEGIN");
    const inserted = await insertExclusions(db);
    await queryAll(db, "COMMIT");

    const existingAfter = await existingExclusionCount(db);
    const afterReportingEligible = await currentCounts(db);

    process.stdout.write(`${JSON.stringify({
      range: RANGE,
      rawDenominator: beforeRaw,
      reportingDenominatorBefore: beforeReportingEligible,
      approvedCandidateCounts: candidates,
      exclusionsBefore: existingBefore,
      exclusionsInserted: inserted,
      exclusionsSkippedAsExisting: candidates.total - inserted,
      exclusionsAfter: existingAfter,
      reportingDenominatorAfter: afterReportingEligible,
      closeRatesAfter: closeRates(afterReportingEligible),
      costPerNewCustomerStatus: "unavailable_incomplete_spend_coverage"
    }, null, 2)}\n`);
  } catch (error) {
    try {
      await queryAll(db, "ROLLBACK");
    } catch {
      // Ignore rollback when no transaction is active.
    }
    throw error;
  } finally {
    await db.end();
  }
}

await main();
