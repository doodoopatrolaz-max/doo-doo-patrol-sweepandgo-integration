# Doo Doo Patrol Business Intelligence and Integration System

Permanent reporting and integration system for Doo Doo Patrol.

This repository is being expanded from a Sweep&Go-first integration into the long-term BI system that will combine:

- Sweep&Go
- GoHighLevel
- Gmail
- Meta Ads
- Google Ads

The goal is accurate daily, weekly, monthly, and custom-date reporting for lead flow, ad spend, customer growth, cancellations, monthly recurring revenue, and source attribution.

## Phase One Status

Completed in this phase:

- Inspected and preserved the existing Sweep&Go webhook, onboarding intake, reporting email, MCP, Docker, Railway, and test code.
- Added the initial BI database design in `prisma/schema.prisma`.
- Added planning docs:
  - `IMPLEMENTATION_PLAN.md`
  - `DATA_SOURCE_MAP.md`
  - `ENVIRONMENT_VARIABLES.md`
  - `SWEEPANDGO_FIELD_MAP.md`
- Added placeholder module folders for GoHighLevel, Gmail, Meta Ads, Google Ads, authentication, reconciliation, and reporting.
- Added disabled placeholder webhook endpoints for future providers:
  - `POST /webhooks/gohighlevel/{GOHIGHLEVEL_WEBHOOK_SECRET}`
  - `POST /webhooks/gmail/{GMAIL_WEBHOOK_SECRET}`
  - `POST /webhooks/meta-ads/{META_ADS_WEBHOOK_SECRET}`
  - `POST /webhooks/google-ads/{GOOGLE_ADS_WEBHOOK_SECRET}`
- Kept the existing Sweep&Go endpoint:
  - `POST /webhooks/sweepandgo/{WEBHOOK_PATH_SECRET}`
- Kept the health endpoint:
  - `GET /health`

Future provider webhook endpoints stay disabled until their secrets are configured. No live accounts are connected in phase one.

## Existing Work To Preserve

This repo already contained valuable working Sweep&Go integration work before the BI expansion:

- Read-only Sweep&Go API client in `src/sweepandgo/client.ts`
- Webhook receiver and deduplication logic in `src/http/app.ts` and `src/webhooks/*`
- PostgreSQL webhook storage migrations in `migrations/`
- Onboarding intake capture in `src/onboarding/*`
- Daily internal route dashboard report in `src/reports/*`
- Read-only MCP tools in `src/mcp/server.ts`
- Docker and Railway deployment files
- Automated tests for webhook intake, duplicate protection, onboarding intake, fingerprinting, and route dashboard reporting

Do not delete or replace this working Sweep&Go integration code. Expand around it and migrate carefully.

## Source Of Truth Rules

- GoHighLevel is the primary source for new leads.
- GoHighLevel pipeline and stage names must be stored in configuration.
- Sweep&Go is the primary source for active customers, recurring service information, customer status, service details, and customer acquisition source when available.
- Gmail onboarding emails may help reconcile new customers, but Gmail should not be the only source of truth when Sweep&Go has the same information.
- Meta Ads is the source of truth for Facebook and Instagram ad spend and performance.
- Google Ads is the source of truth for Google ad spend and performance.
- New customer source values normalize to `facebook`, `website`, `other`, or `unknown`.

## Security Rules

- Never commit credentials, passwords, API keys, access tokens, webhook secrets, or refresh tokens.
- `.env` is ignored by Git.
- `.env.example` contains placeholders only.
- Real secrets belong in Railway variables or local `.env`.
- Do not print secrets in logs.
- Use read-only permissions whenever possible for advertising and reporting integrations.

## Current Technical Note

The current runnable service still uses Node's native HTTP server to preserve the existing Sweep&Go webhook behavior. Express, Zod, Prisma, Vitest, ESLint, and Prettier are listed in `package.json` for the target architecture, but dependency installation was not available in this shell during phase one. See `IMPLEMENTATION_PLAN.md` for the migration order.

## Sweep&Go Reporting Sync

Phase 2 adds read-only Sweep&Go reporting sync commands:

```bash
npm run sync:sweepandgo:historical
npm run sync:sweepandgo:daily
```

Both commands read from Sweep&Go and upsert into the BI tables by provider record IDs. They do not create, edit, or delete Sweep&Go customers, subscriptions, invoices, or payments.

The field discovery notes live in `SWEEPANDGO_FIELD_MAP.md`. Important current boundary: Sweep&Go payments are not treated as monthly recurring revenue. MRR remains unknown until a reliable recurring subscription amount field or endpoint is confirmed.

## GoHighLevel Lead Discovery

Phase 3 adds a read-only GoHighLevel foundation. It does not connect Gmail, Meta Ads, or Google Ads, and it does not modify live GHL contacts, opportunities, pipelines, workflows, tags, automations, or stages.

Documentation and unanswered field questions live in `GOHIGHLEVEL_FIELD_MAP.md`.

Read-only discovery commands:

```bash
npm run discover:gohighlevel:pipelines
npm run discover:gohighlevel:opportunities -- --limit=25
```

Production-safe smoke test:

```bash
npm run smoke:production
```

The discovery commands stop before any live API call unless `GHL_PRIVATE_INTEGRATION_TOKEN` and `GHL_LOCATION_ID` are configured in the environment. Do not put the HighLevel token in `.env.example`, source code, README examples, GitHub, logs, or chat.

## GoHighLevel Webhook Intake

Phase 4 prepares live GoHighLevel webhook intake without connecting Gmail, Meta Ads, or Google Ads.

The enabled endpoint format is:

```text
POST /webhooks/gohighlevel/{GOHIGHLEVEL_WEBHOOK_SECRET}
```

GoHighLevel webhook events are saved in `integration_events` before processing. Duplicate deliveries are ignored by event fingerprint. Processing currently supports sanitized opportunity stage, opportunity status, and opportunity create-style payloads using stable GoHighLevel opportunity and contact IDs.

Lead source rules:

- Only opportunities in the configured `GHL_PIPELINE_ID` are classified.
- `GHL_FACEBOOK_STAGE_ID` becomes original source `facebook`.
- `GHL_WEBSITE_STAGE_ID` becomes original source `website`.
- Later follow-up stages do not create new leads.
- Status changes preserve status only and do not create leads.
- Conflicting Facebook/website original-stage evidence creates a reconciliation issue.
- Customer names, email addresses, phone numbers, addresses, and message bodies must not be printed in logs.

Run the synthetic verification only with Railway variables injected:

```bash
npm run test:gohighlevel:webhook
```

The synthetic test uses fake IDs only and reports aggregate counts. It does not call the HighLevel API.

HighLevel activation is not complete until the selected HighLevel webhook method is confirmed in the UI. Official HighLevel Marketplace documentation confirms webhook URL configuration and workflow triggers such as `Pipeline Stage Changed` and `Opportunity Status Changed`; the reviewed official docs did not confirm a standard signing header or timestamp replay-validation mechanism for standard CRM/workflow webhook deliveries.

---

# Preserved Sweep&Go Integration Notes

Production-ready Sweep&Go integration for Doo Doo Patrol.

This app provides:

- Public Sweep&Go webhook receiver
- Secure PostgreSQL storage for received webhook events
- Primary onboarding intake from `client:client_onboarding_recurring`
- Read-only Codex MCP tools for Sweep&Go lookups and local webhook review
- Daily internal route dashboard report by tech
- Railway-ready deployment
- Tests for webhook intake, duplicate protection, and health checks

Sweep&Go docs used for this build:

- [Sweep&Go Open API docs](https://openapi.sweepandgo.com/docs/)
- [Sweep&Go API base URL](https://openapi.sweepandgo.com/)

## Automation Boundaries

This project intentionally does not create clients, update customers, change subscriptions, create coupons, process payments, send customer messages, or modify customer-facing onboarding data.

For onboarding, the app can capture Sweep&Go onboarding triggers, enrich from Sweep&Go read-only details when possible, store verified and missing details, and expose the intake record for agent review. Customer-facing onboarding email still requires Bryan or Jen to reply `APPROVED`. SMS is never sent automatically.

The only non-customer-data action exposed through MCP is `retry_sweepandgo_webhook`, because Sweep&Go documents it as a webhook retry action for previously triggered webhooks.

Sweep&Go webhook signature verification is not included because the public Sweep&Go documentation reviewed for this build does not document a webhook signing header or verification process.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

3. Set `WEBHOOK_PATH_SECRET` in `.env` to a long random value.

4. Start PostgreSQL locally or use a hosted PostgreSQL URL.

5. Run the database migration:

   ```bash
   npm run migrate
   ```

6. Start the app:

   ```bash
   npm run dev
   ```

7. Check local health:

   ```bash
   curl http://localhost:3000/health
   ```

8. Test a local webhook:

   ```bash
   curl -X POST http://localhost:3000/webhooks/sweepandgo/YOUR_WEBHOOK_PATH_SECRET \
     -H "Content-Type: application/json" \
     -d '{"event_id":"test_1","event_type":"job:completed","message":"local test"}'
   ```

## Environment Variables

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | Railway provides it | The app binds to `0.0.0.0` and listens on this port. |
| `DATABASE_URL` | Yes | PostgreSQL connection string. Railway PostgreSQL provides this. |
| `WEBHOOK_PATH_SECRET` | Yes | Long random value used in the webhook URL path. Never commit it. |
| `SWEEPGO_BASE_URL` | Yes | Defaults to `https://openapi.sweepandgo.com`. |
| `SWEEPGO_API_TOKEN` | Later | Leave blank for the first deployment. Add it only after Sweep&Go generates the token. |
| `DAILY_DASHBOARD_ENABLED` | No | Set to `true` to send the daily route dashboard from the running service. |
| `DAILY_DASHBOARD_RECIPIENT` | No | Defaults to `bryan@doodoopatrol.com`. Use commas for multiple internal recipients. |
| `DAILY_DASHBOARD_FROM` | Yes for email | Sender email address for the dashboard report. Can also use `SMTP_FROM`. |
| `DAILY_DASHBOARD_TIME_ZONE` | No | Defaults to `America/Phoenix`. |
| `SMTP_HOST` | Yes for email | SMTP server host, for example Google Workspace SMTP relay or Gmail SMTP. |
| `SMTP_PORT` | No | Defaults to `587`. |
| `SMTP_SECURE` | No | Set to `true` for implicit TLS ports such as `465`; leave `false` for port `587` STARTTLS. |
| `SMTP_USER` | Depends on relay | SMTP login username when required. |
| `SMTP_PASSWORD` | Depends on relay | SMTP password or Google Workspace app password when required. |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | Phase 3 | HighLevel Private Integration token. Store only in Railway. |
| `GHL_LOCATION_ID` | Phase 3 | Doo Doo Patrol HighLevel sub-account/location ID. |
| `GHL_API_BASE_URL` | No | Defaults to `https://services.leadconnectorhq.com`. |
| `GHL_API_VERSION` | No | Defaults to `2021-07-28`. |
| `GHL_PIPELINE_ID` | After discovery | Exact `Fresh Leads to Onboarding` pipeline ID. |
| `GHL_PIPELINE_NAME` | No | Defaults to `Fresh Leads to Onboarding`. |
| `GHL_FACEBOOK_STAGE_ID` | After discovery | Exact Facebook lead stage ID. |
| `GHL_FACEBOOK_STAGE_NAME` | No | Defaults to `Facebook New Lead`. |
| `GHL_WEBSITE_STAGE_ID` | After discovery | Exact website quote stage ID. |
| `GHL_WEBSITE_STAGE_NAME` | No | Defaults to `Website Quote Lead`. |
| `GOHIGHLEVEL_WEBHOOK_SECRET` | Later | Enables the future GHL webhook endpoint. Leave blank until planned. |

## Webhook Receiver

Endpoint:

```text
POST /webhooks/sweepandgo/{WEBHOOK_PATH_SECRET}
```

Behavior:

- Accepts JSON payloads.
- Preserves the complete original payload in PostgreSQL.
- Stores event type, received time, status, payload, error details, and fingerprint.
- Returns HTTP 200 quickly when the path secret is valid.
- Uses a unique event fingerprint to prevent duplicate processing.
- Keeps processing separate from the webhook response.
- Does not log full webhook payloads.
- Redacts likely tokens, payment links, and credit-card-related values from logs and stored error details.

Health endpoint:

```text
GET /health
```

The health response shows service status and whether the database/API token are configured, but does not expose secret values.

## Database

Production uses PostgreSQL.

Migration:

```text
migrations/001_create_webhook_events.sql
```

Table:

```text
webhook_events
onboarding_intakes
```

Columns:

- `id`
- `sweepandgo_event_id`
- `event_type`
- `received_at`
- `processing_status`
- `payload`
- `error_details`
- `event_fingerprint`
- `created_at`
- `updated_at`

Onboarding intake records include:

- `webhook_event_id`
- `event_type`
- `customer_email`
- `customer_name`
- `client_identifier`
- `service_type`
- `status`
- `sources_checked`
- `verified_details`
- `missing_details`
- `calculation_notes`
- `payload`
- `sweepandgo_details`

## MCP Server

Build first:

```bash
npm run build
```

Run over stdio:

```bash
npm run mcp
```

Tools:

- `sweepandgo_health_check`
- `get_active_clients`
- `get_inactive_clients`
- `get_active_clients_without_subscription`
- `search_client_by_email`
- `get_client_details_and_payments`
- `get_leads`
- `get_out_of_area_leads`
- `get_dispatch_jobs`
- `get_daily_dashboard_report`
- `count_dogs`
- `count_happy_clients`
- `count_active_clients`
- `count_completed_jobs`
- `list_active_staff`
- `list_received_webhooks`
- `get_received_webhook_details`
- `list_onboarding_intakes`
- `get_onboarding_intake_details`
- `retry_sweepandgo_webhook`

## Daily Route Dashboard

The app can email Bryan an internal route dashboard every Monday through Friday at 5:00 PM Phoenix time.

The report includes:

- Total jobs
- Physical stops
- Miles
- Stops per hour
- Drive gap percent
- Skipped jobs
- Route exceptions
- Tech-by-tech highlights

Metric definitions:

- `jobs`: every dispatch-board job returned by Sweep&Go for the report date.
- `physical stops`: unique non-skipped service locations for each tech.
- `miles`: route/job mileage when Sweep&Go includes mileage fields.
- `stops/hour`: physical stops divided by route hours. The report uses route span first, then clock/job span when route span is not present.
- `drive gap %`: drive minutes divided by route minutes when both values are present.
- `skipped jobs`: jobs with skipped, cancelled, no-service, or not-serviced status/reason fields.
- `route exceptions`: unassigned jobs, skipped jobs, missing mileage/time, low stops/hour, high drive gap, late jobs, and off-schedule jobs.

Run a one-off report:

```bash
npm run report:daily
```

Run a one-off report for a specific date:

```bash
npm run report:daily -- --date=2026-06-12
```

Preview the exact email payload without sending:

```bash
npm run report:daily:preview
```

To enable the built-in weekday scheduler on Railway, set:

```text
DAILY_DASHBOARD_ENABLED=true
DAILY_DASHBOARD_RECIPIENT=bryan@doodoopatrol.com
DAILY_DASHBOARD_FROM=reports@doodoopatrol.com
DAILY_DASHBOARD_TIME_ZONE=America/Phoenix
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user-if-required
SMTP_PASSWORD=your-smtp-password-or-app-password-if-required
```

Do not commit SMTP credentials or paste them into chat. Store them in Railway variables.

The scheduler only sends internal reports. It does not send customer-facing messages or modify Sweep&Go data.

The paginated tools accept:

- `page`
- `allPages`
- `maxPages`

Example Codex MCP config:

```json
{
  "mcpServers": {
    "sweepandgo": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/absolute/path/to/Sweep&Go Integration/src/mcp/server.ts"
      ],
      "env": {
        "DATABASE_URL": "postgres://placeholder-user:placeholder-password-host:5432/placeholder-database",
        "WEBHOOK_PATH_SECRET": "your-secret",
        "SWEEPGO_BASE_URL": "https://openapi.sweepandgo.com",
        "SWEEPGO_API_TOKEN": "replace-with-sweepandgo-api-token"
      }
    }
  }
}
```

Do not paste the Sweep&Go API token into chat, source code, GitHub, or this README.

## Tests

Run:

```bash
npm test
```

Check TypeScript:

```bash
npm run build
```

## Railway Deployment

### 1. Push The Project To GitHub

From this project folder:

```bash
git init
git add .
git commit -m "Build Sweep&Go onboarding integration"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

If this repo already has Git set up, use:

```bash
git status
git add .
git commit -m "Build Sweep&Go onboarding integration"
git push
```

### 2. Create The Railway Service

1. Go to [Railway](https://railway.app/).
2. Create a new project.
3. Choose `Deploy from GitHub repo`.
4. Select this repo.
5. Railway will use the included `Dockerfile` and `railway.json`.

### 3. Add PostgreSQL

1. In the Railway project, click `New`.
2. Select `Database`.
3. Choose `PostgreSQL`.
4. Railway will create a PostgreSQL service and provide `DATABASE_URL`.

### 4. Add Required Environment Variables

In the Railway web service, add:

```text
WEBHOOK_PATH_SECRET=your-long-random-secret
SWEEPGO_BASE_URL=https://openapi.sweepandgo.com
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Leave this blank or unset for the first deployment:

```text
SWEEPGO_API_TOKEN=
```

Generate a strong `WEBHOOK_PATH_SECRET` with:

```bash
openssl rand -hex 32
```

### 5. Deploy The Application

1. Railway should deploy automatically after the GitHub repo is connected.
2. Open the web service deployment logs.
3. Confirm the service starts without errors.
4. Run the migration after the database is attached:

   ```bash
   npm run migrate
   ```

Railway can run this from the service shell. If you prefer fully automatic migrations later, add a release command in a future phase.

### 6. Find The Public Railway Domain

1. Open your Railway web service.
2. Go to `Settings`.
3. Open `Networking`.
4. Click `Generate Domain` if Railway has not created one yet.
5. Copy the domain, for example:

   ```text
   your-app-name.up.railway.app
   ```

### 7. Construct The Final Sweep&Go Webhook URL

Use this exact format:

```text
https://YOUR_RAILWAY_DOMAIN/webhooks/sweepandgo/YOUR_WEBHOOK_PATH_SECRET
```

Example:

```text
https://your-app-name.up.railway.app/webhooks/sweepandgo/abc123
```

## First Deployment Workflow Without The Sweep&Go Token

Because Sweep&Go requires the public webhook URL before creating the API token:

1. Deploy this app to Railway without `SWEEPGO_API_TOKEN`.
2. Generate or copy your Railway public domain.
3. Build the final webhook URL:

   ```text
   https://YOUR_RAILWAY_DOMAIN/webhooks/sweepandgo/YOUR_WEBHOOK_PATH_SECRET
   ```

4. Paste that URL into Sweep&Go when generating the API token.
5. Select the webhook event boxes.
6. Generate the token in Sweep&Go.
7. Add the token securely to Railway as `SWEEPGO_API_TOKEN`.
8. Redeploy the Railway service.
9. Test `GET /health`.
10. Use the Sweep&Go Test Webhooks button.
11. Confirm the test event appears in PostgreSQL or through the `list_received_webhooks` MCP tool.

## Primary Onboarding Trigger

Use Sweep&Go webhooks as the low-usage primary onboarding trigger. This avoids running a Codex/Gmail polling monitor every few minutes.

Primary event:

- `client:client_onboarding_recurring`

Supporting events:

- `client:client_onboarding_onetime`
- `client:subscription_created`

Audit-only event:

- `notification:client_not_assigned`

When `client:client_onboarding_recurring` arrives, this app:

1. Stores the original webhook payload.
2. Creates an `onboarding_intakes` record.
3. Extracts any customer email, customer name, client identifier, phone, service address, status, and service type from the webhook payload.
4. If a Sweep&Go client identifier is present, calls `get_client_details_and_payments`.
5. If only an email is present, calls `search_client_by_email`, then `get_client_details_and_payments` when a client identifier is found.
6. Stores verified details, missing details, sources checked, and billing calculation notes.
7. Leaves GHL and Gmail enrichment for the onboarding agent review step, because those connectors are not part of the Railway webhook app.

Customer-facing messages are not sent by this webhook app. The next agent step should use the intake record, Sweep&Go details, GHL, and Gmail to prepare the internal approval email for Jen/Bryan.

## Recommended Sweep&Go Webhook Boxes

Select the events that help Doo Doo Patrol track leads, client lifecycle, dispatch activity, retention, and failed payments.

Minimum onboarding set:

- `client:client_onboarding_recurring`
- `client:client_onboarding_onetime`
- `client:subscription_created`
- `notification:client_not_assigned`

Broader recommended set:

- `free:quote`
- `lead:out_of_service_area`
- `lead:in_service_area`
- `lead:delete`
- `client:changed_status`
- `client:changed_info`
- `client:changed_address`
- `client:subscription_canceled`
- `client:subscription_paused`
- `client:subscription_unpaused`
- `client:subscription_cancel_requested`
- `client:notification_settings_changed`
- `client:additional_contact_changed`
- `client:client_payment_declined`
- `client:client_payment_accepted`
- `client:reviews_automation`
- `client:areas_to_clean_changed`
- `notification:on_the_way_notification`
- `notification:off_schedule_notification`
- `notification:completed_job_notification`
- `notification:skipped_job_notification`
- `notification:client_not_assigned`
- `staff:staff_clock_in`
- `staff:staff_forgot_to_clock_out`
- `staff:shift_break_started`
- `staff:shift_break_info`
- `job:started`
- `job:completed`
- `payroll:shift_info`
- `payroll:tip_info`
- `dog:birthday`

Do not select `client:credit_card_link_created` unless you have a clear operational reason. The receiver will preserve the full payload if Sweep&Go sends it, and that event is explicitly described by Sweep&Go as a private credit card link event.

## After The Token Is Generated

Add the token in Railway only:

```text
SWEEPGO_API_TOKEN=your-generated-token
```

Do not paste it into:

- Chat
- Source code
- GitHub
- README files
- Screenshots

Redeploy:

1. Open the Railway web service.
2. Go to `Variables`.
3. Add or update `SWEEPGO_API_TOKEN`.
4. Railway will redeploy automatically, or you can click `Redeploy`.
5. Confirm `/health` shows:

   ```json
   {
     "sweepandgoApiConfigured": true
   }
   ```

6. Test the API connection with the MCP tool:

   ```text
   sweepandgo_health_check
   ```

7. Then test an authenticated read-only tool:

   ```text
   count_active_clients
   ```

## Using The Sweep&Go Test Webhooks Button

1. Open the Sweep&Go API token or webhook settings area.
2. Confirm the webhook URL is:

   ```text
   https://YOUR_RAILWAY_DOMAIN/webhooks/sweepandgo/YOUR_WEBHOOK_PATH_SECRET
   ```

3. Click the Sweep&Go Test Webhooks button.
4. Railway should return HTTP 200 from this app.
5. Check Railway logs for a stored webhook message.
6. Check the database or run the MCP tool:

   ```text
   list_received_webhooks
   ```

7. If the same test is sent twice, this app should return HTTP 200 both times and mark the second copy as a duplicate.

## Operational Notes

- Keep customer-facing automations approval-first in later phases.
- Add customer changes only after we have real webhook examples and clear rollback rules.
- Add alerting in phase two for webhook processing failures, token failures, and database errors.
- Consider expanding dashboard coverage later for daily lead count, failed payments, inactive clients, and cancellation signals.
# doo-doo-patrol-sweepandgo-integration
# doo-doo-patrol-sweepandgo-integration
