# Google Ads Module

Read-only foundation for Google Ads spend and campaign performance reporting.

Boundary:

- Google Ads is the source of truth for Google advertising spend and Google-reported performance.
- This module only uses OAuth token refresh and Google Ads search/read requests.
- Do not add mutate, upload, budget, bidding, keyword, ad, audience, billing, recommendation, or conversion write calls here.
- Google conversions stay separate from GoHighLevel Website leads until reporting intentionally combines them.
- Historical backfill remains disabled until one-day campaign-level sync is verified in production.

Required Railway variables for live reads:

- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CUSTOMER_ID`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`

Optional:

- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` when access goes through a manager account.
- `GOOGLE_ADS_API_VERSION`, default `v24`.
- `GOOGLE_ADS_API_BASE_URL`, default `https://googleads.googleapis.com`.
- `GOOGLE_ADS_OAUTH_TOKEN_URL`, default `https://oauth2.googleapis.com/token`.
