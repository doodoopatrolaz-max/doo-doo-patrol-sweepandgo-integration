import { loadConfig } from "../src/config.ts";
import {
  createConversionMatchDryRun,
  normalizeEmail,
  normalizePhone
} from "../src/gohighlevel/conversionMatcher.ts";
import { PostgresClient } from "./postgres_tool.mjs";

const ACTIVE_PIPELINE_NAME = "Sweep N Go Active Clients";
const RANGE = { start: "2026-06-01", end: "2026-06-30" };

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

async function ghlRequest(config, path, init = {}) {
  const response = await fetch(`${config.goHighLevelApiBaseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.goHighLevelPrivateIntegrationToken}`,
      "Content-Type": "application/json",
      Version: config.goHighLevelApiVersion
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  if (!response.ok) {
    throw new Error(`HighLevel read request failed with HTTP ${response.status}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function getPipelines(config) {
  const response = await ghlRequest(config, `/opportunities/pipelines?locationId=${encodeURIComponent(config.goHighLevelLocationId)}`);
  if (Array.isArray(response)) return response.filter(isRecord);
  if (Array.isArray(response.pipelines)) return response.pipelines.filter(isRecord);
  if (Array.isArray(response.data)) return response.data.filter(isRecord);
  return [];
}

async function searchOpportunities(config, pipelineId) {
  try {
    return await searchOpportunitiesWithBody(config, {
      locationId: config.goHighLevelLocationId,
      pipelineId
    });
  } catch (error) {
    if (!String(error?.message ?? "").includes("HTTP 422")) {
      throw error;
    }
  }

  const rows = await searchOpportunitiesWithBody(config, {
    locationId: config.goHighLevelLocationId
  });
  return rows.filter((row) => stringValue(row.pipelineId ?? row.pipeline_id) === pipelineId);
}

async function searchOpportunitiesWithBody(config, baseBody) {
  const all = [];
  const maxPages = 12;
  const limit = 100;
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await ghlRequest(config, "/opportunities/search", {
      method: "POST",
      body: {
        ...baseBody,
        limit,
        page
      }
    });
    const rows = extractRows(response);
    all.push(...rows);
    if (rows.length < limit) {
      break;
    }
  }
  return all;
}

function extractRows(value) {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.opportunities)) return value.opportunities.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.data)) return value.data.filter(isRecord);
  return [];
}

async function loadBiLeads(db) {
  const rows = await queryRows(
    db,
    `SELECT
       o.id::text AS bi_opportunity_id,
       o.external_opportunity_id,
       o.contact_external_id,
       o.original_lead_source,
       o.original_lead_date::text,
       c.primary_email,
       c.primary_phone
     FROM opportunities o
     LEFT JOIN contacts c ON c.id = o.contact_id
     WHERE o.provider = 'gohighlevel'
       AND o.original_lead_source IN ('facebook', 'website')
       AND o.original_lead_date::date BETWEEN '${RANGE.start}'::date AND '${RANGE.end}'::date
     ORDER BY o.original_lead_date ASC`
  );
  return rows.map((row) => ({
    biOpportunityId: stringValue(row.bi_opportunity_id),
    externalOpportunityId: stringValue(row.external_opportunity_id),
    contactExternalId: stringValue(row.contact_external_id),
    originalLeadSource: stringValue(row.original_lead_source) ?? "unknown",
    originalLeadDate: stringValue(row.original_lead_date),
    email: normalizeEmail(row.primary_email),
    phone: normalizePhone(row.primary_phone)
  }));
}

async function loadSpend(db) {
  const rows = await queryRows(
    db,
    `SELECT platform,
            COUNT(DISTINCT report_date)::int AS days,
            SUM(spend_amount)::float AS spend
     FROM daily_ad_performance
     WHERE report_date BETWEEN '${RANGE.start}'::date AND '${RANGE.end}'::date
       AND platform IN ('meta', 'google', 'google_ads')
     GROUP BY platform
     ORDER BY platform`
  );
  return rows.map((row) => ({
    platform: String(row.platform),
    days: integer(row.days),
    spend: money(Number(row.spend ?? 0))
  }));
}

function summarizePipelines(pipelines) {
  const active = pipelines.find((pipeline) => sameName(pipeline.name, ACTIVE_PIPELINE_NAME));
  return { active };
}

function mapOpportunity(row, stageNameById, pipelineNameById) {
  const contact = firstRecord([row.contact, row.contactInfo, row.contactDetails]);
  const contactEmail = normalizeEmail(row.email ?? row.contactEmail ?? row.contact_email ?? contact?.email);
  const contactPhone = normalizePhone(row.phone ?? row.contactPhone ?? row.contact_phone ?? contact?.phone);
  const contactId = stringValue(row.contactId ?? row.contact_id ?? contact?.id);
  const stageId = stringValue(row.pipelineStageId ?? row.stageId ?? row.pipeline_stage_id);
  const pipelineId = stringValue(row.pipelineId ?? row.pipeline_id);
  return {
    externalOpportunityId: stringValue(row.id ?? row.opportunityId),
    contactExternalId: contactId,
    pipelineId,
    pipelineName: stringValue(row.pipelineName) ?? (pipelineId ? pipelineNameById[pipelineId] : undefined),
    stageId,
    stageName: stringValue(row.pipelineStageName ?? row.stageName) ?? (stageId ? stageNameById[stageId] : undefined),
    createdAt: stringValue(row.dateAdded ?? row.createdAt),
    updatedAt: stringValue(row.dateUpdated ?? row.updatedAt),
    email: contactEmail,
    phone: contactPhone
  };
}

async function applyMatches(db, matches) {
  const before = await matchCounts(db);
  const insertable = matches.filter((match) => (
    match.lead.biOpportunityId
    && match.lead.externalOpportunityId
    && match.activeOpportunity.externalOpportunityId
    && (match.lead.originalLeadSource === "facebook" || match.lead.originalLeadSource === "website")
    && match.lead.originalLeadDate
  ));

  let insertedRows = [];
  if (insertable.length > 0) {
    const values = insertable.map((match) => {
      const leadDate = match.lead.originalLeadDate?.slice(0, 10);
      const contactId = match.lead.contactExternalId ?? match.activeOpportunity.contactExternalId;
      return `(
        ${sqlValue(match.lead.biOpportunityId)}::uuid,
        ${sqlValue(match.lead.externalOpportunityId)},
        ${sqlValue(match.activeOpportunity.externalOpportunityId)},
        ${sqlNullable(contactId)},
        ${sqlValue(match.lead.originalLeadSource)},
        ${sqlValue(leadDate)}::date,
        ${sqlNullable(match.conversionDate)}::timestamptz,
        ${sqlValue(match.matchMethod)},
        1.00,
        'matched'
      )`;
    }).join(",");

    insertedRows = await queryRows(
      db,
      `INSERT INTO lead_customer_matches (
         bi_lead_opportunity_id,
         ghl_lead_opportunity_id,
         ghl_active_opportunity_id,
         ghl_contact_id,
         lead_source,
         lead_date,
         conversion_date,
         match_method,
         confidence,
         status
       )
       VALUES ${values}
       ON CONFLICT (ghl_lead_opportunity_id, ghl_active_opportunity_id) DO NOTHING
       RETURNING lead_source, match_method`
    );
  }

  const after = await matchCounts(db);
  const skippedAsExisting = insertable.length - insertedRows.length;
  return {
    before,
    attemptedStableMatches: insertable.length,
    inserted: insertedRows.length,
    skippedAsExisting,
    after,
    insertedBySource: countBy(insertedRows, "lead_source"),
    insertedByMethod: countBy(insertedRows, "match_method")
  };
}

async function matchCounts(db) {
  const rows = await queryRows(
    db,
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'matched')::int AS matched_total,
       COUNT(*) FILTER (WHERE status = 'matched' AND lead_source = 'facebook')::int AS facebook_matched,
       COUNT(*) FILTER (WHERE status = 'matched' AND lead_source = 'website')::int AS website_matched,
       COUNT(*) FILTER (WHERE status = 'review')::int AS review_total,
       (
         SELECT COUNT(*)::int
         FROM (
           SELECT ghl_lead_opportunity_id, COUNT(*)
           FROM lead_customer_matches
           WHERE status = 'matched'
           GROUP BY ghl_lead_opportunity_id
           HAVING COUNT(*) > 1
         ) duplicates
       ) AS duplicate_lead_matches,
       (
         SELECT COUNT(*)::int
         FROM (
           SELECT ghl_active_opportunity_id, COUNT(*)
           FROM lead_customer_matches
           WHERE status = 'matched'
           GROUP BY ghl_active_opportunity_id
           HAVING COUNT(*) > 1
         ) duplicates
       ) AS duplicate_active_matches
     FROM lead_customer_matches`
  );
  const row = rows[0] ?? {};
  return {
    total: integer(row.total),
    matchedTotal: integer(row.matched_total),
    facebookMatched: integer(row.facebook_matched),
    websiteMatched: integer(row.website_matched),
    reviewTotal: integer(row.review_total),
    duplicateLeadMatches: integer(row.duplicate_lead_matches),
    duplicateActiveMatches: integer(row.duplicate_active_matches)
  };
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = stringValue(row[key]) ?? "unknown";
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function firstRecord(values) {
  return values.find(isRecord);
}

function sameName(left, right) {
  return normalizeName(left) === normalizeName(right);
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function stringValue(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function integer(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return Math.round(value * 100) / 100;
}

function sqlNullable(value) {
  return value ? sqlValue(value) : "NULL";
}

function sqlValue(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  const config = loadConfig();
  const missing = [];
  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.goHighLevelPrivateIntegrationToken) missing.push("GHL_PRIVATE_INTEGRATION_TOKEN");
  if (!config.goHighLevelLocationId) missing.push("GHL_LOCATION_ID");
  if (missing.length) {
    throw new Error(`Missing required variables: ${missing.join(", ")}`);
  }

  const db = new PostgresClient(parseDatabaseUrl(config.databaseUrl));
  await db.connect();
  try {
    const pipelines = await getPipelines(config);
    const { active } = summarizePipelines(pipelines);
    if (!active?.id) {
      throw new Error("Sweep N Go Active Clients pipeline was not found");
    }

    const stageNameById = {};
    const pipelineNameById = {};
    for (const pipeline of pipelines) {
      const pipelineId = stringValue(pipeline.id);
      if (pipelineId) pipelineNameById[pipelineId] = stringValue(pipeline.name);
      for (const stage of Array.isArray(pipeline.stages) ? pipeline.stages : []) {
        const stageId = stringValue(stage.id);
        if (stageId) stageNameById[stageId] = stringValue(stage.name);
      }
    }

    const [activeRows, leads, spendRows] = await Promise.all([
      searchOpportunities(config, active.id),
      loadBiLeads(db),
      loadSpend(db)
    ]);
    const activeOpps = activeRows.map((row) => mapOpportunity(row, stageNameById, pipelineNameById));
    const dryRun = createConversionMatchDryRun({
      leads,
      activeOpportunities: activeOpps,
      spendRows,
      rangeStart: RANGE.start,
      rangeEnd: RANGE.end
    });

    if (dryRun.matchCounts.manualReviewCount > 0 || dryRun.matchCounts.duplicateOrAmbiguousCount > 0) {
      throw new Error("Approved apply stopped because current dry run found review or ambiguous matches");
    }
    if (dryRun.matches.length !== 3) {
      throw new Error(`Approved apply expected exactly 3 stable matches, found ${dryRun.matches.length}`);
    }

    await db.query("BEGIN");
    const result = await applyMatches(db, dryRun.matches);
    await db.query("COMMIT");

    process.stdout.write(`${JSON.stringify({
      range: RANGE,
      dryRunCounts: {
        facebookLeads: dryRun.leadCounts.facebookLeads,
        websiteLeads: dryRun.leadCounts.websiteLeads,
        totalLeads: dryRun.leadCounts.totalLeads,
        recurringActiveClientOpportunitiesEligible: dryRun.activeOpportunityCounts.recurringEligible,
        stableMatches: dryRun.matches.length,
        manualReviewCount: dryRun.matchCounts.manualReviewCount,
        duplicateOrAmbiguousCount: dryRun.matchCounts.duplicateOrAmbiguousCount,
        facebookConversions: dryRun.matchCounts.facebookConversions,
        websiteConversions: dryRun.matchCounts.websiteConversions
      },
      applyResult: result,
      costPerNewCustomerStatus: dryRun.spendCoverage.costPerNewCustomerStatus,
      dataWarnings: dryRun.dataWarnings
    }, null, 2)}\n`);
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // No active transaction or connection already closed.
    }
    throw error;
  } finally {
    await db.end();
  }
}

await main();
