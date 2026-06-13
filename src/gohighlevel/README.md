# GoHighLevel Module

Safe Phase 3 foundation for read-only GoHighLevel lead and opportunity discovery.

Confirmed so far:

- Primary lead source: GoHighLevel.
- Target pipeline name: `Fresh Leads to Onboarding`.
- Expected lead stages: `Facebook New Lead`, `Website Quote Lead`.
- Exact location, pipeline, and stage IDs are not discovered yet.

Commands:

- `npm run discover:gohighlevel:pipelines`
- `npm run discover:gohighlevel:opportunities -- --limit=25`

Both commands require Railway-only credentials:

- `GHL_PRIVATE_INTEGRATION_TOKEN`
- `GHL_LOCATION_ID`

Do not add live credentials here. Stage and pipeline IDs belong in Railway variables after discovery.
