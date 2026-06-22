import { loadConfig } from "../src/config.ts";
import { GoogleAdsClient } from "../src/googleAds/client.ts";

const config = loadConfig();

if (!hasRequiredGoogleAdsVariables(config)) {
  console.log(JSON.stringify({
    status: "skipped_missing_credentials",
    requiredVariables: requiredGoogleAdsVariables()
  }, null, 2));
  process.exit(0);
}

const client = GoogleAdsClient.fromConfig(config);
const account = await client.discoverAccount();

console.log(JSON.stringify({
  status: "ok",
  accountIdPresent: account.idPresent,
  accountNamePresent: account.descriptiveNamePresent,
  currency: account.currencyCode ?? null,
  timeZone: account.timeZone ?? null,
  loginCustomerIdConfigured: Boolean(config.googleAdsLoginCustomerId)
}, null, 2));

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
