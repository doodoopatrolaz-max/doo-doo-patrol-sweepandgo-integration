# GoHighLevel Lead Pipeline Cutover

Status: active lead reporting has moved to the new GoHighLevel pipeline.

## Active Reporting Pipeline

- Pipeline: `New Lead to Onboarding`
- Facebook lead stage: `Facebook New Lead`
- Website lead stage: `Website Quote Lead`

Railway variables that define the active pipeline and stages:

- `GHL_PIPELINE_NAME`
- `GHL_PIPELINE_ID`
- `GHL_FACEBOOK_STAGE_ID`
- `GHL_WEBSITE_STAGE_ID`

The ID values are intentionally not stored in source control or documentation.

## Legacy Pipeline

The prior reporting pipeline was:

- Pipeline: `Fresh Leads To Onboarding`
- Facebook lead stage: `Facebook New Lead`
- Website lead stage: `Website Quote Lead`

Historical BI lead records, reporting exclusions, and stored lead-to-customer
matches remain intact. Do not delete or rewrite historical lead data during this
cutover.

## Operational Rule

Future GoHighLevel workflow webhooks should send `opportunity_created` events
from the active pipeline with trusted Custom Data:

- `event_type = opportunity_created`
- `opportunity_id`
- `contact_id`
- `lead_source = facebook` or `website`

If reliable internal stage IDs are included, the configured Railway stage IDs
are the strongest source classification signal. If stage IDs are absent, trusted
workflow `lead_source` remains the launch-safe fallback.
