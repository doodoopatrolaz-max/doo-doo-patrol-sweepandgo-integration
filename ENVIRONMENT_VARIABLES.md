# Environment Variable Checklist

Do not commit real values. Use Railway variables for production secrets.

## Required For Local App Runtime

| Variable | Purpose | Phase | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | Runtime mode | 1 | Use `development`, `test`, or `production`. |
| `PORT` | HTTP port | 1 | Railway provides this automatically. |
| `DATABASE_URL` | PostgreSQL connection string | 1 | Placeholder only in `.env.example`. |
| `WEBHOOK_PATH_SECRET` | Sweep&Go webhook path secret | 1 | Long random value. Never paste real value into docs or chat. |

## Sweep&Go

| Variable | Purpose | Phase | Notes |
| --- | --- | --- | --- |
| `SWEEPGO_BASE_URL` | Sweep&Go API base URL | 1 | Confirm from Sweep&Go before live use. |
| `SWEEPGO_API_TOKEN` | Sweep&Go API token | Later | Leave blank until the public webhook URL exists and Sweep&Go generates the token. |

## Future Webhook Placeholders

| Variable | Purpose | Phase | Notes |
| --- | --- | --- | --- |
| `GOHIGHLEVEL_WEBHOOK_SECRET` | GoHighLevel webhook path secret | 4 | Long random value stored only in Railway. Enables `/webhooks/gohighlevel/{secret}`. Do not paste into chat or docs. |
| `GMAIL_WEBHOOK_SECRET` | Gmail webhook placeholder secret | Later | Leave blank in phase one. Confirm whether Gmail uses push notifications before enabling. |
| `META_ADS_WEBHOOK_SECRET` | Meta Ads webhook placeholder secret | Later | Leave blank in phase one. |
| `GOOGLE_ADS_WEBHOOK_SECRET` | Google Ads webhook placeholder secret | Later | Leave blank in phase one. |

## GoHighLevel Reporting Configuration

| Variable | Purpose | Phase | Notes |
| --- | --- | --- | --- |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | HighLevel Private Integration token | 3 | Store only in Railway. Never commit or paste into chat. |
| `GHL_LOCATION_ID` | Doo Doo Patrol HighLevel sub-account/location ID | 3 | Required before live read-only discovery. |
| `GHL_API_BASE_URL` | HighLevel API base URL | 3 | Placeholder: `https://services.leadconnectorhq.com`. |
| `GHL_API_VERSION` | HighLevel API Version header | 3 | Placeholder: `2021-07-28`. |
| `GHL_PIPELINE_ID` | Exact discovered pipeline ID | 3 | Fill after pipeline discovery. |
| `GHL_PIPELINE_NAME` | Lead pipeline name | 3 | Current expected value: `Fresh Leads to Onboarding`. |
| `GHL_FACEBOOK_STAGE_ID` | Exact discovered Facebook lead stage ID | 3 | Fill after pipeline discovery. |
| `GHL_FACEBOOK_STAGE_NAME` | Facebook lead stage name | 3 | Current expected value: `Facebook New Lead`. |
| `GHL_WEBSITE_STAGE_ID` | Exact discovered website quote stage ID | 3 | Fill after pipeline discovery. |
| `GHL_WEBSITE_STAGE_NAME` | Website quote stage name | 3 | Current expected value: `Website Quote Lead`. |
| `GOHIGHLEVEL_LOCATION_ID` | Legacy location variable alias | Compatibility | Prefer `GHL_LOCATION_ID`. |
| `GOHIGHLEVEL_PIPELINE_NAME` | Legacy pipeline name alias | Compatibility | Prefer `GHL_PIPELINE_NAME`. |
| `GOHIGHLEVEL_STAGE_FACEBOOK_NEW_LEAD` | Legacy Facebook stage name alias | Compatibility | Prefer `GHL_FACEBOOK_STAGE_NAME`. |
| `GOHIGHLEVEL_STAGE_WEBSITE_QUOTE_LEAD` | Legacy website stage name alias | Compatibility | Prefer `GHL_WEBSITE_STAGE_NAME`. |

## GoHighLevel Webhook Security Confirmation

| Item | Status | Notes |
| --- | --- | --- |
| Secret path validation | Required | Supported by the app using `GOHIGHLEVEL_WEBHOOK_SECRET`. |
| Official signing header | Needs confirmation | Do not invent a header name. Confirm in the selected HighLevel webhook or workflow UI before live activation. |
| Replay timestamp header | Needs confirmation | Add timestamp tolerance only if HighLevel documents or exposes a timestamp header for this webhook source. |
| Custom outbound header | Optional if UI supports it | If HighLevel workflow webhook action supports custom headers, use it for traceability only unless official signing is available. |

## Ads Reporting Placeholders

| Variable | Purpose | Phase | Notes |
| --- | --- | --- | --- |
| `META_ACCESS_TOKEN` | Meta Marketing API access token | 5 | Store only in Railway. Prefer a Meta Business system user token with read-only ad account access. Never commit or paste into chat. |
| `META_AD_ACCOUNT_ID` | Meta Ads account ID | 5 | Use the Doo Doo Patrol ad account ID. The app accepts with or without the `act_` prefix. |
| `META_API_VERSION` | Meta Graph API version | 5 | Confirm current supported Marketing API version in official Meta docs before live use. Placeholder: `v23.0`. |
| `META_API_BASE_URL` | Meta Graph API base URL | 5 | Placeholder: `https://graph.facebook.com`. |
| `META_APP_ID` | Meta app ID | Optional | Needed only if token management later requires app metadata. Do not store secrets in docs. |
| `META_APP_SECRET` | Meta app secret | Optional secret | Store only in Railway if needed later. Not required for the Phase 5 read-only foundation. |
| `META_BUSINESS_ID` | Meta Business ID | Optional | Useful for system-user setup notes; not required by current read-only sync. |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API developer token | 6 | Store only in Railway. Required for Google Ads API calls. Do not paste into docs, logs, GitHub, or chat. |
| `GOOGLE_ADS_CUSTOMER_ID` | Google Ads customer ID | 6 | The operating Google Ads customer account to report on. Use with or without hyphens; the app normalizes before API calls. |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Optional manager customer ID | 6 | Required only when OAuth access goes through a manager account. Use without exposing the value in logs. |
| `GOOGLE_ADS_MANAGER_CUSTOMER_ID` | Legacy alias for optional manager customer ID | 6 | Supported as a fallback alias, but prefer `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. |
| `GOOGLE_ADS_CLIENT_ID` | OAuth client ID | 6 | Store only in Railway. Required to refresh access tokens. |
| `GOOGLE_ADS_CLIENT_SECRET` | OAuth client secret | 6 secret | Store only in Railway. Never commit. |
| `GOOGLE_ADS_REFRESH_TOKEN` | OAuth refresh token | 6 secret | Store only in Railway. Used to obtain short-lived access tokens; never commit or print. |
| `GOOGLE_ADS_API_VERSION` | Google Ads API version | 6 | Current placeholder: `v24`. Confirm against official Google Ads API release notes before live activation. |
| `GOOGLE_ADS_API_BASE_URL` | Google Ads API base URL | 6 | Placeholder: `https://googleads.googleapis.com`. |
| `GOOGLE_ADS_OAUTH_TOKEN_URL` | Google OAuth token endpoint | 6 | Placeholder: `https://oauth2.googleapis.com/token`. |

## Gmail Reconciliation

| Variable | Purpose | Phase | Notes |
| --- | --- | --- | --- |
| `GMAIL_ONBOARDING_TO_ADDRESS` | Internal onboarding email address | Later | Provided business address should be set only in local/Railway env, not `.env.example`. |

## Daily Dashboard Email

| Variable | Purpose | Phase | Notes |
| --- | --- | --- | --- |
| `DAILY_DASHBOARD_ENABLED` | Enables scheduled internal dashboard email | Existing | Default `false`. |
| `DAILY_DASHBOARD_RECIPIENT` | Internal report recipient | Existing | Use internal address in real env only. |
| `DAILY_DASHBOARD_FROM` | Sender address | Existing | Required only when sending email. |
| `DAILY_DASHBOARD_TIME_ZONE` | Report timezone | Existing | Default is `America/Phoenix`. |
| `SMTP_HOST` | SMTP host | Existing | Required only for email sending. |
| `SMTP_PORT` | SMTP port | Existing | Default `587`. |
| `SMTP_SECURE` | SMTP TLS mode | Existing | `true` only for implicit TLS ports. |
| `SMTP_USER` | SMTP user | Existing | Secret when populated. |
| `SMTP_PASSWORD` | SMTP password | Existing | Secret. Never commit. |
