# Doo Doo Patrol Sweep&Go Integration

Phase one production-ready Sweep&Go integration for Doo Doo Patrol.

This app provides:

- Public Sweep&Go webhook receiver
- Secure PostgreSQL storage for received webhook events
- Read-only Codex MCP tools for Sweep&Go lookups and local webhook review
- Railway-ready deployment
- Tests for webhook intake, duplicate protection, and health checks

Sweep&Go docs used for this build:

- [Sweep&Go Open API docs](https://openapi.sweepandgo.com/docs/)
- [Sweep&Go API base URL](https://openapi.sweepandgo.com/)

## Phase One Boundaries

This project intentionally does not create clients, update customers, change subscriptions, create coupons, process payments, send customer messages, or modify onboarding data.

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
- `count_dogs`
- `count_happy_clients`
- `count_active_clients`
- `count_completed_jobs`
- `list_active_staff`
- `list_received_webhooks`
- `get_received_webhook_details`
- `retry_sweepandgo_webhook`

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
        "DATABASE_URL": "postgres://...",
        "WEBHOOK_PATH_SECRET": "your-secret",
        "SWEEPGO_BASE_URL": "https://openapi.sweepandgo.com",
        "SWEEPGO_API_TOKEN": "set-this-outside-chat"
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
git commit -m "Build phase one Sweep&Go integration"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

If this repo already has Git set up, use:

```bash
git status
git add .
git commit -m "Build phase one Sweep&Go integration"
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

## Recommended Sweep&Go Webhook Boxes

For phase one, select the events that help Doo Doo Patrol track leads, client lifecycle, dispatch activity, retention, and failed payments.

Recommended:

- `free:quote`
- `lead:out_of_service_area`
- `lead:in_service_area`
- `lead:delete`
- `client:changed_status`
- `client:changed_info`
- `client:changed_address`
- `client:client_onboarding_recurring`
- `client:client_onboarding_onetime`
- `client:subscription_created`
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

Do not select `client:credit_card_link_created` in phase one unless you have a clear operational reason. The receiver will preserve the full payload if Sweep&Go sends it, and that event is explicitly described by Sweep&Go as a private credit card link event.

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
- Consider a small dashboard later for daily lead count, completed jobs, failed payments, inactive clients, and cancellation signals.
