# Gmail Module

Gmail is used only as supporting source-evidence reconciliation when Sweep&Go or GoHighLevel does not already provide the same field directly.

## Sweep&Go New-Client Source Evidence

Future Sweep&Go new-client account emails can provide owner-trusted source evidence such as:

- Clean Up Frequency
- How you heard about us
- How you heard about us details

The BI-safe parser is implemented in `newClientSourceEmail.ts`. It extracts only the needed label/value fields and does not require storing the full raw email body.

Matched evidence is stored in `sweepandgo_new_client_email_sources` with:

- `email_source = sweepandgo_new_client_email`
- `source_confidence = owner_email_evidence`
- `clean_up_frequency`
- `how_heard_about_us`
- `how_heard_about_us_details`
- matched onboarding intake or customer ID when safe

## Automation

This repository has the parser, matcher, source-evidence tables, dashboard read path, optional Gmail read-only API client, webhook-triggered lookup, and fallback sync command.

Webhook-triggered pattern:

1. Sweep&Go webhook intake stores and processes the BI event normally.
2. For `client:client_onboarding_recurring` and `client:client_onboarding_onetime`, the app tries a read-only Gmail lookup after the webhook response has already been accepted for asynchronous processing.
3. The Gmail search is limited to Sweep&Go new-client account emails around the Phoenix business date of the webhook.
4. Parsed email evidence is matched using email/date, phone/date, stable Sweep&Go ID when available, then name/address/date.
5. Email bodies are not stored. Only parsed source evidence, source bucket, match status, and sanitized lookup status are stored.
6. Gmail lookup errors are non-fatal and do not fail the Sweep&Go webhook.
7. If no email is found yet, `sweepandgo_new_client_source_lookup_attempts` records a pending lookup state for review/fallback.

Required Railway variables for automatic Gmail source lookup:

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_USER_EMAIL`
- `GMAIL_API_SCOPE`
- `GMAIL_API_BASE_URL`
- `GMAIL_OAUTH_TOKEN_URL`

If these variables are missing, the feature remains safely disabled and the health/smoke checks expose only boolean configuration status.

Recommended fallback schedule after Gmail credentials are verified:

- Command: `npm run sync:gmail:new-client-sources -- --since-days=3`
- Schedule: every 30 minutes, or hourly if Gmail quota/noise becomes a concern.

Manual fallback command:

`npm run sync:gmail:new-client-sources -- --since-days=3`

## Boundary

- Gmail is not the source of truth when the same information is available directly from Sweep&Go or GoHighLevel.
- Do not store full raw email bodies unless a future review explicitly approves it.
- Do not log customer names, emails, phone numbers, addresses, message bodies, tokens, or raw payloads.
