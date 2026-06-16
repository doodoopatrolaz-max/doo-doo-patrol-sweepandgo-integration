import { loadConfig } from "../src/config.ts";
import { MetaAdsClient } from "../src/metaAds/client.ts";
import { mapMetaAdsInsightsRow } from "../src/metaAds/mapper.ts";

const args = parseArgs(process.argv.slice(2));
const config = loadConfig();

if (!config.metaAccessToken || !config.metaAdAccountId) {
  console.log(JSON.stringify({
    status: "skipped_missing_credentials",
    requiredVariables: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"]
  }, null, 2));
  process.exit(0);
}

const date = args.date ?? todayIsoDate();
const client = MetaAdsClient.fromConfig(config);
const account = await client.getAdAccount();
const rows = await client.getInsights({
  since: date,
  until: date,
  level: "campaign",
  maxPages: Number(args["max-pages"] ?? 1),
  limit: Number(args.limit ?? 10)
});

const mapped = rows.map((row) => mapMetaAdsInsightsRow(row, {
  accountTimezone: typeof account.timezone_name === "string" ? account.timezone_name : undefined,
  currency: typeof account.currency === "string" ? account.currency : undefined
}));

console.log(JSON.stringify({
  status: "ok",
  date,
  level: "campaign",
  rowsRead: rows.length,
  campaignsSeen: new Set(mapped.map((row) => row.externalCampaignId)).size,
  totalSpend: mapped.reduce((sum, row) => sum + Number(row.spendAmount), 0).toFixed(2),
  totalImpressions: mapped.reduce((sum, row) => sum + row.impressions, 0),
  totalClicks: mapped.reduce((sum, row) => sum + row.clicks, 0),
  totalMetaReportedLeads: mapped.reduce((sum, row) => sum + row.leads, 0)
}, null, 2));

function parseArgs(values) {
  const output = {};
  for (const value of values) {
    const match = value.match(/^--([^=]+)=(.*)$/);
    if (match) {
      output[match[1]] = match[2];
    }
  }
  return output;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
