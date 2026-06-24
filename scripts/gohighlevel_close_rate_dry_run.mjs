import { loadConfig } from "../src/config.ts";
import {
  createConversionMatchDryRun,
  isExcludedActiveClientStage,
  isRecurringActiveClientStage,
  normalizeEmail,
  normalizePhone
} from "../src/gohighlevel/conversionMatcher.ts";
import { PostgresClient } from "./postgres_tool.mjs";

const FRESH_PIPELINE_NAME = "Fresh Leads To Onboarding";
const ACTIVE_PIPELINE_NAME = "Sweep N Go Active Clients";
const JUNE_START = "2026-06-01";
const JUNE_END = "2026-06-30";

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

async function loadBiLeads(db, range) {
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
       AND o.original_lead_date::date BETWEEN '${range.start}'::date AND '${range.end}'::date
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

async function loadSpend(db, range) {
  const rows = await queryRows(
    db,
    `SELECT platform,
            COUNT(DISTINCT report_date)::int AS days,
            SUM(spend_amount)::float AS spend
     FROM daily_ad_performance
     WHERE report_date BETWEEN '${range.start}'::date AND '${range.end}'::date
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
  const fresh = pipelines.find((pipeline) => sameName(pipeline.name, FRESH_PIPELINE_NAME));
  const active = pipelines.find((pipeline) => sameName(pipeline.name, ACTIVE_PIPELINE_NAME));
  return { fresh, active };
}

function summarizeStages(pipeline) {
  return (Array.isArray(pipeline?.stages) ? pipeline.stages : [])
    .filter(isRecord)
    .map((stage, index) => ({
      name: stringValue(stage.name) ?? "unknown",
      order: typeof stage.position === "number" ? stage.position : index,
      idPresent: Boolean(stringValue(stage.id)),
      recurringConversionStage: isRecurringActiveClientStage(stringValue(stage.name)),
      excludedFromRecurringConversions: isExcludedActiveClientStage(stringValue(stage.name))
    }))
    .sort((left, right) => left.order - right.order);
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
    phone: contactPhone,
    fieldAvailability: {
      contactId: Boolean(contactId),
      opportunityId: Boolean(stringValue(row.id ?? row.opportunityId)),
      source: Boolean(stringValue(row.source)),
      createdDate: Boolean(stringValue(row.dateAdded ?? row.createdAt)),
      updatedDate: Boolean(stringValue(row.dateUpdated ?? row.updatedAt)),
      email: Boolean(contactEmail),
      phone: Boolean(contactPhone),
      tags: Array.isArray(row.tags),
      customFields: Array.isArray(row.customFields)
    }
  };
}

function firstRecord(values) {
  return values.find(isRecord);
}

function summarizeFieldAvailability(activeOpps) {
  return activeOpps.reduce((acc, item) => {
    for (const [key, present] of Object.entries(item.fieldAvailability ?? {})) {
      acc[key] = (acc[key] ?? 0) + (present ? 1 : 0);
    }
    return acc;
  }, {});
}

function monthToDateRange(now = new Date()) {
  const phoenixDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  return {
    start: `${phoenixDate.slice(0, 7)}-01`,
    end: phoenixDate
  };
}

async function runRange({ db, activeOpps, range, label }) {
  const [leads, spendRows] = await Promise.all([
    loadBiLeads(db, range),
    loadSpend(db, range)
  ]);
  const dryRun = createConversionMatchDryRun({
    leads,
    activeOpportunities: activeOpps,
    spendRows,
    rangeStart: range.start,
    rangeEnd: range.end
  });

  return {
    label,
    range,
    leadCounts: dryRun.leadCounts,
    activeOpportunityCounts: dryRun.activeOpportunityCounts,
    conversionCounts: {
      matchesByContactId: dryRun.matchCounts.byContactId,
      matchesBySameOpportunityId: dryRun.matchCounts.bySameOpportunityId,
      matchesByEmail: dryRun.matchCounts.byEmail,
      matchesByPhone: dryRun.matchCounts.byPhone,
      facebookConversions: dryRun.matchCounts.facebookConversions,
      websiteConversions: dryRun.matchCounts.websiteConversions,
      unknownSourceConversions: dryRun.matchCounts.unknownSourceConversions,
      manualReviewCount: dryRun.matchCounts.manualReviewCount,
      duplicateOrAmbiguousCount: dryRun.matchCounts.duplicateOrAmbiguousCount,
      unmatchedRecurringEligible: dryRun.matchCounts.unmatchedRecurringEligible,
      dateRuleRejected: dryRun.matchCounts.dateRuleRejected
    },
    closeRates: dryRun.closeRates,
    costPerNewCustomerStatus: dryRun.spendCoverage.costPerNewCustomerStatus,
    spendCoverage: dryRun.spendCoverage,
    stableMatchesAvailableForFutureApply: dryRun.matches.length,
    dataWarnings: dryRun.dataWarnings
  };
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
    const { fresh, active } = summarizePipelines(pipelines);
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

    const activeRows = active?.id ? await searchOpportunities(config, active.id) : [];
    const activeOpps = activeRows.map((row) => mapOpportunity(row, stageNameById, pipelineNameById));
    const ranges = [
      await runRange({ db, activeOpps, range: { start: JUNE_START, end: JUNE_END }, label: "june_2026" }),
      await runRange({ db, activeOpps, range: monthToDateRange(), label: "current_month_to_date" })
    ];

    process.stdout.write(`${JSON.stringify({
      pipelines: {
        freshLeadsToOnboardingFound: Boolean(fresh),
        freshLeadsToOnboardingPipelineIdPresent: Boolean(fresh?.id),
        sweepNGoActiveClientsFound: Boolean(active),
        sweepNGoActiveClientsPipelineIdPresent: Boolean(active?.id),
        sweepNGoActiveClientStages: summarizeStages(active)
      },
      activeOpportunityFieldAvailability: {
        activeOpportunitiesRead: activeOpps.length,
        countsWithField: summarizeFieldAvailability(activeOpps)
      },
      matchingRules: {
        priority: ["same_ghl_contact_id", "same_ghl_opportunity_id", "unique_normalized_email", "unique_normalized_phone"],
        nameOnlyMatchingAllowed: false,
        recurringStagesOnly: true,
        writesExternalSystems: false,
        writesDatabase: false
      },
      ranges
    }, null, 2)}\n`);
  } finally {
    await db.end();
  }
}

await main();
