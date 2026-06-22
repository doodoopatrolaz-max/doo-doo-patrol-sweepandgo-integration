# Doo Doo Patrol BI and Integration System Implementation Plan

## Current Repository Inventory

This repository already contains a working Sweep&Go-focused TypeScript service. Preserve these pieces:

- `src/sweepandgo/client.ts`: read-only Sweep&Go API client and documented retry-webhook action.
- `src/http/app.ts`: current health endpoint and webhook receiver.
- `src/webhooks/*`: webhook fingerprinting, idempotent storage, in-memory and PostgreSQL stores, async processing.
- `src/onboarding/*`: onboarding intake processing for Sweep&Go onboarding events.
- `src/reports/*`: internal daily route dashboard report and email sender.
- `src/mcp/server.ts`: read-only MCP tools for Sweep&Go and stored webhook/onboarding review.
- `migrations/001_create_webhook_events.sql` and `migrations/002_create_onboarding_intakes.sql`: existing PostgreSQL tables for the current Sweep&Go app.
- Existing tests under `tests/`, especially webhook duplicate protection and onboarding intake tests.

No working Sweep&Go integration code should be deleted or replaced during the BI expansion.

## Problems Found

- The app currently uses Node's native HTTP server instead of Express. Express is now listed as a dependency for the target architecture, but the runtime has not been migrated yet because preserving the existing webhook code is safer for phase one.
- The current runtime stores received Sweep&Go webhooks in `webhook_events`; the long-term BI schema introduces the required `integration_events` table. A future migration should move runtime webhook storage to `integration_events` while keeping a compatibility path for existing webhook records.
- There is no package manager available on this shell path, so dependencies could not be installed or refreshed during this pass.
- Existing README content is Sweep&Go-specific and long. It should remain as operational history, but the top-level README now needs to point clearly to the permanent BI direction.

## Target Folder Structure

```text
.
├── prisma/
│   └── schema.prisma
├── migrations/
├── src/
│   ├── authentication/
│   ├── config.ts
│   ├── db/
│   ├── email/
│   ├── gmail/
│   ├── gohighlevel/
│   ├── googleAds/
│   ├── http/
│   ├── mcp/
│   ├── metaAds/
│   ├── onboarding/
│   ├── reconciliation/
│   ├── reporting/
│   ├── reports/
│   ├── sweepandgo/
│   └── webhooks/
├── tests/
├── DATA_SOURCE_MAP.md
├── ENVIRONMENT_VARIABLES.md
├── IMPLEMENTATION_PLAN.md
└── README.md
```

`src/reports` is preserved for the existing daily route dashboard. New business metric logic should live under `src/reporting` unless and until those folders are consolidated.

## Phase 1 Completed In This Pass

- Inspect existing repository.
- Preserve existing Sweep&Go app boundaries.
- Add placeholder module folders for GoHighLevel, Gmail, Meta Ads, Google Ads, authentication, reconciliation, and reporting.
- Add placeholder webhook endpoints for future providers without enabling them by default.
- Keep `/health`.
- Add initial Prisma schema for the long-term database.
- Add `.env.example` placeholders for future providers.
- Add documentation for source-of-truth rules and environment variables.
- Add tests for health, webhook idempotency, and disabled placeholder webhooks.

## Phase 2: Runtime Database Alignment

- Create `SWEEPANDGO_FIELD_MAP.md` from official docs, existing code, sanitized live shapes, and available webhook history.
- Add SQL migration `003_create_bi_reporting_tables.sql` for `integration_events` and the BI reporting tables.
- Keep `webhook_events` as the active intake table and add `unified_webhook_events` as the compatibility read path.
- Add read-only Sweep&Go historical and daily sync commands.
- Upsert customers, services, customer sources, leads, and sync runs by provider record IDs.
- Keep MRR, cancellation reason, account balance, and customer created date marked unavailable until Sweep&Go exposes reliable fields.

## Phase 3: GoHighLevel Lead and Opportunity Sync

- Confirm the exact GoHighLevel location, pipeline ID, stage IDs, webhook support, and API permissions.
- Store pipeline and stage names in configuration.
- Sync leads and opportunities into `leads` and `opportunities`.
- Normalize source values to `facebook`, `website`, `other`, or `unknown`.
- Add tests for duplicate opportunity updates and stage name configuration.

## Phase 4: Sweep&Go Customer Sync

- Confirm exact Sweep&Go fields for active status, recurring service, one-time service, pricing, source, and cancellation reason.
- Sync customers, services, sources, and cancellations.
- Treat Sweep&Go as the source of truth for active customers, recurring service, status, and service details.
- Reconcile GoHighLevel new customers against Sweep&Go active recurring customers.

## Phase 5: Ad Platform Spend

- Add read-only Meta Ads reporting sync after confirming account IDs, attribution windows, and metrics.
- Add read-only Google Ads reporting sync after confirming customer IDs and manager-account structure.
- Store daily spend and performance in `daily_ad_performance`.
- Keep ad spend source of truth in the ad platforms, not CRM tags.
- Run campaign-level Google Ads daily sync first with `--max-pages=1` before any historical backfill.
- Keep Google Ads conversions separate from GoHighLevel Website leads until reporting intentionally combines them.

## Phase 6: Reporting and Reconciliation

- Generate daily business metrics from source tables.
- Add weekly, monthly, and custom-date report builders.
- Add reconciliation issue creation for missing source, mismatched customer status, duplicate leads, and unlinked ad spend.
- Add Railway scheduled jobs once sync jobs are stable.

## Phase 7: Production Hardening

- Migrate the HTTP runtime to Express and Zod validation after dependencies are installed.
- Add structured error notifications for failed syncs.
- Add log redaction tests.
- Add Railway deployment checks and database migration runbook.
- Add dashboards only after data quality is proven.
