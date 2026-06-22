import { loadConfig } from "../src/config.ts";
import { GoogleAdsClient } from "../src/googleAds/client.ts";
import { mapGoogleAdsCampaignRow } from "../src/googleAds/mapper.ts";

const args = parseArgs(process.argv.slice(2));
const config = loadConfig();

if (!hasRequiredGoogleAdsVariables(config)) {
  console.log(JSON.stringify({
    status: "skipped_missing_credentials",
    requiredVariables: requiredGoogleAdsVariables()
  }, null, 2));
  process.exit(0);
}

const date = args.date ?? yesterdayIsoDate();
const client = GoogleAdsClient.fromConfig(config);
const rows = await client.getCampaignPerformance({
  date,
  maxPages: Number(args["max-pages"] ?? 1),
  pageSize: Number(args.limit ?? 10)
});
const mapped = rows.map((row) => mapGoogleAdsCampaignRow(row));

console.log(JSON.stringify({
  status: "ok",
  date,
  level: "campaign",
  rowsRead: rows.length,
  campaignsSeen: new Set(mapped.map((row) => row.externalCampaignId)).size,
  campaignRowsWithSpend: mapped.filter((row) => Number(row.spendAmount) > 0).length,
  totalSpend: mapped.reduce((sum, row) => sum + Number(row.spendAmount), 0).toFixed(2),
  totalImpressions: mapped.reduce((sum, row) => sum + row.impressions, 0),
  totalClicks: mapped.reduce((sum, row) => sum + row.clicks, 0),
  totalGoogleConversions: mapped.reduce((sum, row) => sum + Number(row.conversionsDecimal), 0).toFixed(6),
  unavailableFields: []
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

function yesterdayIsoDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function hasRequiredGoogleAdsVariables(appConfig) {
  return Boolean(
    appConfig.googleAdsDeveloperToken &&
    appConfig.googleAdsCustomerId &&
    appConfig.googleAdsClientId &&
    appConfig.googleAdsClientSecret &&
    appConfig.googleAdsRefreshToken
  );
}

function requiredGoogleAdsVariables() {
  return [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CUSTOMER_ID",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN"
  ];
}
