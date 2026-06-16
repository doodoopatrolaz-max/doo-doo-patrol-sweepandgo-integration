import { loadConfig } from "../src/config.ts";
import { MetaAdsClient } from "../src/metaAds/client.ts";

const config = loadConfig();

if (!config.metaAccessToken || !config.metaAdAccountId) {
  console.log(JSON.stringify({
    status: "skipped_missing_credentials",
    requiredVariables: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"]
  }, null, 2));
  process.exit(0);
}

const client = MetaAdsClient.fromConfig(config);
const account = await client.getAdAccount();

console.log(JSON.stringify({
  status: "ok",
  accountIdPresent: Boolean(account.account_id || account.id),
  namePresent: Boolean(account.name),
  currencyPresent: Boolean(account.currency),
  timezonePresent: Boolean(account.timezone_name || account.timezone_id)
}, null, 2));
