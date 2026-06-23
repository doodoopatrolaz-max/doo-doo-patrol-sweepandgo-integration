# Sweep&Go Reporting Sync Operations

## Current Status

Sweep&Go webhook intake is live, but webhook processing is used for onboarding intake and raw event storage. Customer reporting tables are refreshed by the read-only Sweep&Go reporting sync command.

The reporting sync command is idempotent and upserts by stable Sweep&Go external IDs:

```bash
npm run sync:sweepandgo:daily
```

For a limited verification run:

```bash
npm run sync:sweepandgo:daily -- --max-pages=1
```

Do not run the historical sync unless Bryan explicitly approves it.

## Recommended Railway Schedule

Create a separate Railway scheduled job or cron service that uses the same GitHub repository and production variables as the app service.

Recommended schedule:

```text
0 11 * * *
```

This runs at 4:00 AM Arizona time while Arizona is on UTC-7.

Recommended command:

```bash
npm run sync:sweepandgo:daily
```

Safer first week command:

```bash
npm run sync:sweepandgo:daily -- --max-pages=5
```

After the first week is stable, remove the `--max-pages=5` limit only if the API behavior and record counts look healthy.

## Railway Click Steps

1. Open Railway.
2. Open project `Doo Doo Patrol Integrations`.
3. Stay in the `production` environment.
4. Add a new service from the same GitHub repository.
5. Name it `sweepandgo-daily-reporting-sync`.
6. Configure it as a scheduled or cron service.
7. Use the cron schedule `0 11 * * *`.
8. Set the start command to `npm run sync:sweepandgo:daily -- --max-pages=5` for the first week.
9. Copy or share only the required production variables with this service:
   - `DATABASE_URL`
   - `NODE_ENV`
   - `SWEEPGO_API_TOKEN`
   - `SWEEPGO_BASE_URL`
10. Do not add webhook secrets, dashboard password, ad credentials, Gmail credentials, or unrelated integration tokens unless the scheduled job needs them later.
11. After the first scheduled run, confirm Sync Health shows a fresh Sweep&Go run and no duplicate customers, contacts, or services.

## Dashboard Warning

The KPI dashboard should show a Sync Health warning when the latest Sweep&Go customer sync is older than 24 hours. When that warning appears, run the limited verification command first, then inspect aggregate counts before enabling or changing a schedule.
