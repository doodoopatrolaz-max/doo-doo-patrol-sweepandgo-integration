import { loadConfig } from "../src/config.ts";
import { GoHighLevelClient } from "../src/gohighlevel/client.ts";
import { mapGoHighLevelOpportunity } from "../src/gohighlevel/mapper.ts";
import { loadGoHighLevelStageConfig } from "../src/gohighlevel/stageConfig.ts";

const config = loadConfig();
const missing = [];
if (!config.goHighLevelPrivateIntegrationToken) missing.push("GHL_PRIVATE_INTEGRATION_TOKEN");
if (!config.goHighLevelLocationId) missing.push("GHL_LOCATION_ID");
if (missing.length) {
  console.error(JSON.stringify({ error: `Missing required HighLevel discovery environment variables: ${missing.join(", ")}` }, null, 2));
  process.exit(1);
}

const limit = maxLimitFromArgs(process.argv.slice(2), 25);
const client = GoHighLevelClient.fromConfig(config);
const response = await client.searchOpportunities({
  locationId: config.goHighLevelLocationId,
  limit,
  page: 1
});
const opportunities = extractRows(response);
const stageConfig = loadGoHighLevelStageConfig();
const mapped = opportunities.map((row) => mapGoHighLevelOpportunity(row, stageConfig));
const summary = {
  opportunitiesRead: opportunities.length,
  opportunitiesInConfiguredPipeline: config.goHighLevelPipelineId
    ? opportunities.filter((item) => item.pipelineId === config.goHighLevelPipelineId).length
    : undefined,
  opportunitiesInFacebookNewLead: mapped.filter((item) => item.stageName === stageConfig.facebookNewLeadStageName || item.stageId === stageConfig.facebookNewLeadStageId).length,
  opportunitiesInWebsiteQuoteLead: mapped.filter((item) => item.stageName === stageConfig.websiteQuoteLeadStageName || item.stageId === stageConfig.websiteQuoteLeadStageId).length,
  openOpportunities: mapped.filter((item) => lower(item.status) === "open").length,
  wonOpportunities: mapped.filter((item) => lower(item.status) === "won").length,
  lostOpportunities: mapped.filter((item) => lower(item.status) === "lost").length,
  opportunitiesWithSourceValue: mapped.filter((item) => Boolean(item.sourceRaw)).length,
  opportunitiesWithoutSourceValue: mapped.filter((item) => !item.sourceRaw).length,
  contactsSuccessfullyAssociated: mapped.filter((item) => Boolean(item.externalContactId)).length,
  recordsMissingOpportunityId: mapped.filter((item) => !item.externalOpportunityId).length,
  recordsSkipped: mapped.filter((item) => !item.externalOpportunityId).length,
  errors: 0,
  historicalStageSource: "current_stage_only_until_webhooks_or_history_are_confirmed"
};
console.log(JSON.stringify(summary, null, 2));

function extractRows(value) {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.opportunities)) return value.opportunities.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.data)) return value.data.filter(isRecord);
  return [];
}

function maxLimitFromArgs(args, fallback) {
  const value = args.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error("--limit must be a number between 1 and 100");
  }
  return Math.floor(parsed);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}
