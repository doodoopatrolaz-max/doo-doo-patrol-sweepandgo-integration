# Google Ads Field Map

Phase 6 status: read-only foundation.

Google Ads is the source of truth for Google advertising spend and Google-reported ad performance. GoHighLevel remains the source of truth for Website quote leads. Google Ads conversion metrics are stored separately and must not be counted as GHL Website leads unless a later reporting step intentionally reconciles them.

## Read-Only Boundary

Allowed:

- Refresh OAuth access tokens using the stored refresh token.
- Run Google Ads API search/read requests.
- Read account metadata needed for reporting.
- Read campaign-level daily performance.
- Upsert reporting rows into the local BI database.

Not allowed in this phase:

- Campaign, ad, ad group, keyword, audience, asset, budget, bidding, conversion, billing, account setting, recommendation, or offline conversion write calls.
- Historical backfill.
- Gmail, Meta Ads, or GoHighLevel auth changes.

## Auth Plan

Recommended setup:

- Google Ads developer token from the Google Ads API Center.
- OAuth client credentials from a Google Cloud project with the Google Ads API enabled.
- OAuth refresh token for a dedicated reporting/admin Google user that has access to the Doo Doo Patrol Google Ads account.
- Scope: `https://www.googleapis.com/auth/adwords`.
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` only if access goes through a manager account.
- Store all real credentials only in Railway variables.

Token behavior:

- The app stores no Google Ads secrets in source code.
- The app uses the refresh token to request a short-lived OAuth access token.
- Access tokens are kept only in process memory.
- Logs must report variable presence and aggregate results only.

## Railway Variables

Required before live reads:

- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CUSTOMER_ID`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`

Optional or defaulted:

- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
- `GOOGLE_ADS_MANAGER_CUSTOMER_ID` as legacy alias for login customer ID
- `GOOGLE_ADS_API_VERSION`, default `v24`
- `GOOGLE_ADS_API_BASE_URL`, default `https://googleads.googleapis.com`
- `GOOGLE_ADS_OAUTH_TOKEN_URL`, default `https://oauth2.googleapis.com/token`

## Account Fields

| BI use | Google Ads field | Notes |
| --- | --- | --- |
| External account ID | `customer.id` | Stored without hyphens. Do not print the full value in logs unless explicitly approved for troubleshooting. |
| Account name | `customer.descriptive_name` | Stored in `ad_accounts.name`; do not print if it could expose private account naming. |
| Currency | `customer.currency_code` | Stored with reporting rows. |
| Time zone | `customer.time_zone` | Used for daily date boundaries. |

## Campaign Daily Performance Fields

| BI use | Google Ads field | Storage |
| --- | --- | --- |
| Report date | `segments.date` | `daily_ad_performance.report_date` |
| Campaign ID | `campaign.id` | `ad_campaigns.external_campaign_id`, `daily_ad_performance.external_campaign_id` |
| Campaign name | `campaign.name` | Stored, but not printed in aggregate reporting unless needed. |
| Campaign status | `campaign.status` | `ad_campaigns.status`, `daily_ad_performance.status` |
| Channel type | `campaign.advertising_channel_type` | `advertising_channel_type` |
| Spend | `metrics.cost_micros` | Converted to decimal dollars in `spend_amount`; original micros stored in `cost_micros`. |
| Impressions | `metrics.impressions` | `impressions` |
| Clicks | `metrics.clicks` | `clicks` |
| Google conversions | `metrics.conversions` | `conversions` and `conversions_decimal`; kept separate from GHL leads. |
| All conversions | `metrics.all_conversions` | `all_conversions` |
| Conversion value | `metrics.conversions_value` | `conversion_value` |
| CTR | `metrics.ctr` | `ctr` |
| Average CPC | `metrics.average_cpc` | Converted from micros to dollars in `average_cpc`. |
| Cost per conversion | `metrics.cost_per_conversion` | Converted from micros to dollars in `cost_per_conversion`. |
| Phone calls | `metrics.phone_calls` | `phone_calls` if available. |
| Search impression share | `metrics.search_impression_share` | `search_impression_share` if available. |

## Idempotency

Daily Google Ads rows are upserted by:

```text
platform = google_ads
report_date
external_account_id
external_campaign_id
external_adset_id = ''
external_ad_id = ''
```

Campaign-level sync is the first supported level. Ad group, ad, keyword, conversion action, and search term reporting are deferred until the campaign-level daily sync is verified.

## Commands

```bash
npm run discover:google:account
npm run discover:google:performance -- --date=YYYY-MM-DD --max-pages=1
npm run sync:google:daily -- --date=YYYY-MM-DD --max-pages=1
npm run sync:google:backfill
```

Commands skip safely with a missing-credentials status until the required Railway variables are configured.

## Unknowns To Confirm Before Live Sync

- Exact Google Ads account ID for Doo Doo Patrol.
- Whether access is direct account access or manager-account access.
- Whether the reporting OAuth user has read-only Google Ads access.
- Whether `metrics.phone_calls` and `metrics.search_impression_share` are available for the selected campaign mix and date range.
- Whether account timezone should be Phoenix or another configured Google Ads timezone.
