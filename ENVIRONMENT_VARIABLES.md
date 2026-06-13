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
| `GOHIGHLEVEL_WEBHOOK_SECRET` | GoHighLevel webhook placeholder secret | Later | Leave blank in phase one. |
| `GMAIL_WEBHOOK_SECRET` | Gmail webhook placeholder secret | Later | Leave blank in phase one. Confirm whether Gmail uses push notifications before enabling. |
| `META_ADS_WEBHOOK_SECRET` | Meta Ads webhook placeholder secret | Later | Leave blank in phase one. |
| `GOOGLE_ADS_WEBHOOK_SECRET` | Google Ads webhook placeholder secret | Later | Leave blank in phase one. |

## GoHighLevel Reporting Configuration

| Variable | Purpose | Phase | Notes |
| --- | --- | --- | --- |
| `GOHIGHLEVEL_LOCATION_ID` | GoHighLevel location/account identifier | Later | Confirm before use. |
| `GOHIGHLEVEL_PIPELINE_NAME` | Lead pipeline name | 1 | Current value: `Fresh Leads to Onboarding`. |
| `GOHIGHLEVEL_STAGE_FACEBOOK_NEW_LEAD` | Facebook lead stage name | 1 | Current value: `Facebook New Lead`. |
| `GOHIGHLEVEL_STAGE_WEBSITE_QUOTE_LEAD` | Website quote stage name | 1 | Current value: `Website Quote Lead`. |

## Ads Reporting Placeholders

| Variable | Purpose | Phase | Notes |
| --- | --- | --- | --- |
| `META_ADS_ACCOUNT_ID` | Meta Ads account ID | Later | Confirm before use. |
| `GOOGLE_ADS_CUSTOMER_ID` | Google Ads customer ID | Later | Confirm before use. |
| `GOOGLE_ADS_MANAGER_CUSTOMER_ID` | Optional manager customer ID | Later | Confirm account structure before use. |

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
