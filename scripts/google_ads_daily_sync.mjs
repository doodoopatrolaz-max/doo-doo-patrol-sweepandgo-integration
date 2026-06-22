import { loadConfig } from "../src/config.ts";
import { runGoogleAdsDailySync } from "../src/googleAds/sync.ts";

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
const result = await runGoogleAdsDailySync({
  date,
  maxPages: Number(args["max-pages"] ?? 1),
  pageSize: Number(args.limit ?? 25)
});

console.log(JSON.stringify({
  ...result,
  date,
  level: "campaign"
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
