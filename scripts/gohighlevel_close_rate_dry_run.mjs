import { loadConfig } from "../src/config.ts";
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
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`HighLevel read request failed with HTTP ${response.status}`);
  }
  return parsed;
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
       o.pipeline_id,
       o.stage_id,
       o.original_lead_source,
       o.original_lead_date::text,
       c.primary_email,
       c.primary_phone
     FROM opportunities o
     LEFT JOIN contacts c ON c.id = o.contact_id
     WHERE o.provider = 'gohighlevel'
       AND o.original_lead_source IN ('facebook', 'website')
       AND o.original_lead_date BETWEEN '${JUNE_START}'::date AND ('${JUNE_END}'::date + INTERVAL '1 day')
     ORDER BY o.original_lead_date ASC`
  );
  return rows.map((row) => ({
    biOpportunityId: row.bi_opportunity_id,
    externalOpportunityId: stringValue(row.external_opportunity_id),
    contactExternalId: stringValue(row.contact_external_id),
    pipelineId: stringValue(row.pipeline_id),
    stageId: stringValue(row.stage_id),
    originalLeadSource: stringValue(row.original_lead_source),
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
            MIN(report_date)::text AS first_date,
            MAX(report_date)::text AS last_date,
            SUM(spend_amount)::float AS spend
     FROM daily_ad_performance
     WHERE report_date BETWEEN '${JUNE_START}'::date AND '${JUNE_END}'::date
       AND platform IN ('meta', 'google', 'google_ads')
     GROUP BY platform
     ORDER BY platform`
  );
  return rows.map((row) => ({
    platform: String(row.platform),
    days: integer(row.days),
    firstDate: row.first_date ? String(row.first_date).slice(0, 10) : null,
    lastDate: row.last_date ? String(row.last_date).slice(0, 10) : null,
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
      order: typeof stage.position === "number" ? stage.position : index + 1,
      idPresent: Boolean(stringValue(stage.id))
    }))
    .sort((left, right) => left.order - right.order);
}

function mapOpportunity(row, stageNameById, pipelineNameById) {
  const contact = firstRecord([row.contact, row.contactInfo, row.contactDetails]);
  const contactEmail = normalizeEmail(
    row.email ?? row.contactEmail ?? row.contact_email ?? contact?.email
  );
  const contactPhone = normalizePhone(
    row.phone ?? row.contactPhone ?? row.contact_phone ?? contact?.phone
  );
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
    sourceRaw: stringValue(row.source),
    status: stringValue(row.status),
    createdAt: stringValue(row.dateAdded ?? row.createdAt),
    updatedAt: stringValue(row.dateUpdated ?? row.updatedAt),
    email: contactEmail,
    phone: contactPhone,
    hasTags: Array.isArray(row.tags) && row.tags.length > 0,
    customFieldCount: Array.isArray(row.customFields) ? row.customFields.length : 0,
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

function indexUnique(items, key) {
  const map = new Map();
  const ambiguous = new Set();
  for (const item of items) {
    const value = item[key];
    if (!value) continue;
    if (map.has(value)) {
      ambiguous.add(value);
    } else {
      map.set(value, item);
    }
  }
  for (const value of ambiguous) {
    map.delete(value);
  }
  return { map, ambiguous };
}

function matchConversions(leads, activeOpps) {
  const byOpportunity = indexUnique(leads, "externalOpportunityId");
  const byContact = indexUnique(leads, "contactExternalId");
  const byEmail = indexUnique(leads, "email");
  const byPhone = indexUnique(leads, "phone");
  const matchedLeadIds = new Set();
  const matchedActiveIds = new Set();
  const result = {
    matchedByContactId: 0,
    matchedBySameOpportunityId: 0,
    matchedByEmail: 0,
    matchedByPhone: 0,
    facebookConversions: 0,
    websiteConversions: 0,
    unknownSourceConversions: 0,
    manualReviewCount: 0,
    duplicateOrAmbiguousMatchCount: 0,
    activeWithoutLeadMatch: 0,
    conversionDateUnavailable: 0,
    dateRuleRejected: 0,
    matches: []
  };

  for (const active of activeOpps) {
    const ambiguous = [
      byOpportunity.ambiguous.has(active.externalOpportunityId),
      byContact.ambiguous.has(active.contactExternalId),
      byEmail.ambiguous.has(active.email),
      byPhone.ambiguous.has(active.phone)
    ].some(Boolean);
    if (ambiguous) {
      result.duplicateOrAmbiguousMatchCount += 1;
      result.manualReviewCount += 1;
      continue;
    }

    const match = active.contactExternalId && byContact.map.get(active.contactExternalId)
      ? { lead: byContact.map.get(active.contactExternalId), method: "contact_id" }
      : active.externalOpportunityId && byOpportunity.map.get(active.externalOpportunityId)
        ? { lead: byOpportunity.map.get(active.externalOpportunityId), method: "same_opportunity_id" }
        : active.email && byEmail.map.get(active.email)
          ? { lead: byEmail.map.get(active.email), method: "email" }
          : active.phone && byPhone.map.get(active.phone)
            ? { lead: byPhone.map.get(active.phone), method: "phone" }
            : undefined;

    if (!match) {
      result.activeWithoutLeadMatch += 1;
      continue;
    }
    if (matchedLeadIds.has(match.lead.biOpportunityId) || matchedActiveIds.has(active.externalOpportunityId)) {
      result.duplicateOrAmbiguousMatchCount += 1;
      result.manualReviewCount += 1;
      continue;
    }

    const conversionDate = active.updatedAt ?? active.createdAt;
    if (!conversionDate) {
      result.conversionDateUnavailable += 1;
    } else if (match.lead.originalLeadDate && new Date(conversionDate) < new Date(match.lead.originalLeadDate)) {
      result.dateRuleRejected += 1;
      result.manualReviewCount += 1;
      continue;
    }

    matchedLeadIds.add(match.lead.biOpportunityId);
    matchedActiveIds.add(active.externalOpportunityId);
    if (match.method === "contact_id") result.matchedByContactId += 1;
    if (match.method === "same_opportunity_id") result.matchedBySameOpportunityId += 1;
    if (match.method === "email") result.matchedByEmail += 1;
    if (match.method === "phone") result.matchedByPhone += 1;
    if (match.lead.originalLeadSource === "facebook") result.facebookConversions += 1;
    else if (match.lead.originalLeadSource === "website") result.websiteConversions += 1;
    else result.unknownSourceConversions += 1;
    result.matches.push({
      source: match.lead.originalLeadSource,
      method: match.method
    });
  }

  return result;
}

function spendSummary(spendRows, facebookConversions, websiteConversions) {
  const meta = spendRows.filter((row) => row.platform === "meta");
  const google = spendRows.filter((row) => row.platform === "google" || row.platform === "google_ads");
  const metaSpend = money(meta.reduce((total, row) => total + row.spend, 0));
  const googleSpend = money(google.reduce((total, row) => total + row.spend, 0));
  const metaDays = meta.reduce((total, row) => total + row.days, 0);
  const googleDays = google.reduce((total, row) => total + row.days, 0);
  return {
    meta: {
      daysWithSpendRows: metaDays,
      spend: metaSpend,
      coverageSafe: metaDays >= 25,
      costPerFacebookConvertedCustomer: metaDays >= 25 && facebookConversions > 0
        ? money(metaSpend / facebookConversions)
        : null
    },
    google: {
      daysWithSpendRows: googleDays,
      spend: googleSpend,
      coverageSafe: googleDays >= 25,
      costPerWebsiteConvertedCustomer: googleDays >= 25 && websiteConversions > 0
        ? money(googleSpend / websiteConversions)
        : null
    },
    blendedCostPerConvertedCustomer: metaDays >= 25 && googleDays >= 25 && facebookConversions + websiteConversions > 0
      ? money((metaSpend + googleSpend) / (facebookConversions + websiteConversions))
      : null
  };
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : null;
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

function normalizeEmail(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

function normalizePhone(value) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits || undefined;
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
    const [pipelines, leads, spendRows] = await Promise.all([
      getPipelines(config),
      loadBiLeads(db),
      loadSpend(db)
    ]);
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
    const matches = matchConversions(leads, activeOpps);
    const facebookLeads = leads.filter((lead) => lead.originalLeadSource === "facebook").length;
    const websiteLeads = leads.filter((lead) => lead.originalLeadSource === "website").length;
    const totalLeads = facebookLeads + websiteLeads;
    const spend = spendSummary(spendRows, matches.facebookConversions, matches.websiteConversions);
    const dataWarnings = [];
    if (!active) dataWarnings.push("Sweep N Go Active Clients pipeline was not found.");
    if (matches.conversionDateUnavailable) dataWarnings.push("Some active-client opportunities do not expose a conversion-stage date; updated/created date was unavailable.");
    if (!spend.meta.coverageSafe) dataWarnings.push("Meta spend coverage is partial for June, so Facebook cost per converted customer is unavailable.");
    if (!spend.google.coverageSafe) dataWarnings.push("Google spend coverage is unavailable or partial for June, so Website cost per converted customer is unavailable.");
    if (matches.activeWithoutLeadMatch) dataWarnings.push("Some active-client opportunities did not match a June Facebook/Website lead by stable allowed identifiers.");
    if (matches.duplicateOrAmbiguousMatchCount) dataWarnings.push("Some matches were ambiguous or duplicate and require manual review.");

    const activeFieldAvailability = activeOpps.reduce((acc, item) => {
      for (const [key, present] of Object.entries(item.fieldAvailability)) {
        acc[key] = (acc[key] ?? 0) + (present ? 1 : 0);
      }
      return acc;
    }, {});

    process.stdout.write(`${JSON.stringify({
      range: { start: JUNE_START, end: JUNE_END },
      pipelines: {
        freshLeadsToOnboardingFound: Boolean(fresh),
        freshLeadsToOnboardingPipelineIdPresent: Boolean(fresh?.id),
        sweepNGoActiveClientsFound: Boolean(active),
        sweepNGoActiveClientsPipelineIdPresent: Boolean(active?.id),
        sweepNGoActiveClientStages: summarizeStages(active)
      },
      activeOpportunityFieldAvailability: {
        activeOpportunitiesRead: activeOpps.length,
        countsWithField: activeFieldAvailability
      },
      connectionAssessment: {
        ghlContactIdAvailableOnActiveOpportunities: activeOpps.some((item) => item.contactExternalId),
        sameOpportunityIdMatchingPossible: activeOpps.some((item) => item.externalOpportunityId),
        emailMatchingPossible: activeOpps.some((item) => item.email) && leads.some((item) => item.email),
        phoneMatchingPossible: activeOpps.some((item) => item.phone) && leads.some((item) => item.phone),
        contactIdAppearsStableEnoughForDryRun: matches.matchedByContactId > 0
      },
      leadCounts: {
        facebookLeadsInJune: facebookLeads,
        websiteLeadsInJune: websiteLeads,
        totalLeadsInJune: totalLeads
      },
      conversionCounts: {
        activeClientPipelineOpportunitiesFound: activeOpps.length,
        convertedCustomersMatchedByGhlContactId: matches.matchedByContactId,
        convertedCustomersMatchedBySameOpportunityId: matches.matchedBySameOpportunityId,
        convertedCustomersMatchedByEmail: matches.matchedByEmail,
        convertedCustomersMatchedByPhone: matches.matchedByPhone,
        facebookConversions: matches.facebookConversions,
        websiteConversions: matches.websiteConversions,
        unknownSourceConversions: matches.unknownSourceConversions,
        manualReviewCount: matches.manualReviewCount,
        duplicateOrAmbiguousMatchCount: matches.duplicateOrAmbiguousMatchCount,
        activeWithoutJuneLeadMatch: matches.activeWithoutLeadMatch,
        dateRuleRejected: matches.dateRuleRejected
      },
      closeRates: {
        facebookCloseRatePercent: pct(matches.facebookConversions, facebookLeads),
        websiteCloseRatePercent: pct(matches.websiteConversions, websiteLeads),
        totalCloseRatePercent: pct(matches.facebookConversions + matches.websiteConversions, totalLeads)
      },
      spend,
      dataWarnings
    }, null, 2)}\n`);
  } finally {
    await db.end();
  }
}

await main();
