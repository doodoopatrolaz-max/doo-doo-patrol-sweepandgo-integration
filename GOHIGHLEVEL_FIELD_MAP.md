# GoHighLevel Field Map

Phase 3 status: live read-only authentication and discovery started. Pipeline discovery succeeded. Limited opportunity discovery read one record and reported aggregate counts only.

Official documentation used:

- Developer portal: https://marketplace.gohighlevel.com/docs/
- Authorization and Private Integrations: https://marketplace.gohighlevel.com/docs/Authorization/authorization_doc and https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken
- Pipelines: `GET /opportunities/pipelines`
- Opportunities search: `POST /opportunities/search`
- Contacts search: `POST /contacts/search`
- Webhooks: `ContactCreate`, `ContactUpdate`, `ContactTagUpdate`, `OpportunityCreate`, `OpportunityStageUpdate`, `OpportunityStatusUpdate`, `OpportunityUpdate`, `OpportunityDelete`

## Business Value

GoHighLevel is the primary source for incoming leads. The reporting system should count Facebook and website leads by the date an opportunity first enters the exact configured lead stage in the `Fresh Leads to Onboarding` pipeline.

The expected primary stages are:

- `Facebook New Lead`
- `Website Quote Lead`

Pipeline discovery confirmed the exact pipeline display name is `Fresh Leads To Onboarding`.

## Authentication Recommendation

Recommended method: HighLevel Private Integration token.

Reason: HighLevel documentation says Private Integration tokens are appropriate for internal data synchronization, custom reporting dashboards, and one sub-account at a time. This matches the Doo Doo Patrol reporting system.

Use a sub-account-level Private Integration if HighLevel allows the required read-only scopes there. Use agency-level only if the UI requires it to access the Doo Doo Patrol sub-account context.

Required Railway variables:

- `GHL_PRIVATE_INTEGRATION_TOKEN`
- `GHL_LOCATION_ID`
- `GHL_API_BASE_URL`
- `GHL_API_VERSION`
- `GHL_PIPELINE_ID`
- `GHL_FACEBOOK_STAGE_ID`
- `GHL_WEBSITE_STAGE_ID`
- `GOHIGHLEVEL_WEBHOOK_SECRET`

Do not store the token in GitHub, source files, README examples, local committed files, or logs.

## Discovery Results

Authentication:

- Required GHL variables present: yes.
- Read-only location request succeeded: yes.
- Token/location matched the expected Doo Doo Patrol sub-account: yes.
- Pipeline request succeeded: yes.

Pipeline:

- Total pipelines found: 2.
- Exact pipeline found: yes.
- Exact pipeline name: `Fresh Leads To Onboarding`.
- Pipeline ID present: yes.
- Full pipeline ID intentionally not written to this document.

Stages in order:

1. `Facebook New Lead`
2. `Website Quote Lead`
3. `Manual Follow Up`
4. `Thinking About It-Working`
5. `Facebook Intro Text No Response yet`
6. `Website Lead No Response Follow Up`
7. `No Longer Interested- No Follow Up`
8. `Out of service area for now- No Follow Up`
9. `FELL INTO LONG TERM FOLLOW`
10. `RE-ENGAGE WITH HAYLEE`

Primary lead stages:

- Facebook stage found: yes, `Facebook New Lead`.
- Website stage found: yes, `Website Quote Lead`.
- Duplicate stage names: none found.
- Similar follow-up stage names found:
  - `Facebook Intro Text No Response yet`
  - `Website Lead No Response Follow Up`

Limited opportunity discovery:

- Page size: 1.
- Opportunities read: 1.
- Open opportunities: 1.
- Won opportunities: 0.
- Lost opportunities: 0.
- Opportunities with source value: 0.
- Opportunities without source value: 1.
- Contacts associated: 1.
- Records skipped: 0.
- Errors: 0 after using the supported location-only search body.
- The response included a total count field.

Limited import and migration:

- Migration `004_add_gohighlevel_stage_history.sql` applied to Railway Postgres: yes.
- Migration `004` recorded in `schema_migrations`: yes.
- Limited import page size: 25.
- Target-pipeline opportunities imported: 16.
- Provisional Facebook lead classifications: 4.
- Provisional website lead classifications: 2.
- Later-stage opportunities left with unknown original source: 10.
- Stage-history records inserted: 6.
- Second identical import created no duplicate contacts, opportunities, or stage-history records.
- Reconciliation issues now include aggregate GHL historical-date/source limitations.

## Proposed Read-Only Scopes

Scope labels must be confirmed in the HighLevel Private Integration UI because the public docs describe selecting scopes but do not list every exact UI label on the pages reviewed.

Select the smallest available read-only scopes for:

- Locations or sub-account context: read location/sub-account metadata.
- Contacts: read/search contacts.
- Opportunities: read/search opportunities.
- Pipelines: read opportunities pipelines and stages.
- Tags: read tags if the UI separates tags from contacts and tags are needed for source reconciliation.
- Webhooks: enable receiving the contact/opportunity events listed below if HighLevel requires an app/OAuth context for webhooks.

Do not select write, delete, payment, conversation, message, user management, workflow management, or payment scopes for this phase.

## Field Map

| Business field | Official endpoint or webhook | JSON field path | Sanitized example | Direct or calculated | Confidence | Unanswered questions |
|---|---|---|---|---|---|---|
| GHL location ID | Private Integration context, webhook payloads, API requests | `locationId` | `loc_SANITIZED` | Direct | High for webhooks, medium for API context | Confirm exact Doo Doo Patrol location ID. |
| Contact ID | Contact webhooks, contacts search | `id` / `contactId` | `ct_SANITIZED` | Direct | High | Confirm contacts search response wrapper. |
| Opportunity ID | Opportunity webhooks, opportunities search | `opportunities[].id` | `opp_SANITIZED` | Direct | High | Verified in limited search. |
| Pipeline ID | Pipelines API, opportunity payloads | `pipelines[].id`, `opportunities[].pipelineId` | `pipe_SANITIZED` | Direct | High | Verified present; full ID intentionally not stored here. |
| Pipeline name | Pipelines API | `pipelines[].name` | `Fresh Leads To Onboarding` | Direct | High | Verified exact capitalization. |
| Pipeline stage ID | Pipelines API, opportunity payloads | `pipelines[].stages[].id`, `opportunities[].pipelineStageId` | `stage_SANITIZED` | Direct | High | Verified present; full IDs intentionally not stored here. |
| Pipeline stage name | Pipelines API | `pipelines[].stages[].name` | `Facebook New Lead` | Direct | High | Verified exact stage names and no duplicates. |
| Stage order | Pipelines API | `pipelines[].stages[]` array order / stage `position` | `0` | Direct or array-order fallback | High | Discovery output showed zero-based order values. |
| Opportunity created date | Opportunities search | `opportunities[].createdAt` | `2026-01-01T00:00:00.000Z` | Direct | High | Verified in limited search. |
| Opportunity updated date | Opportunities search | `opportunities[].updatedAt` | `2026-01-02T00:00:00.000Z` | Direct | High | Verified in limited search. |
| Opportunity status | Opportunities search | `opportunities[].status` | `open` | Direct | High | Limited page showed an open opportunity. |
| Opportunity source | Opportunities search | `opportunities[].source` | `null` | Direct | High | Verified field exists; first limited record had no source value. |
| Assigned user | Opportunities search | `opportunities[].assignedTo` | `user_SANITIZED` or `null` | Direct | High | Verified field exists. |
| Contact created date | Contact webhooks/search | `dateAdded` / `createdAt` | `2026-01-01T00:00:00.000Z` | Direct | Medium | Confirm search payload field name. |
| Contact name | Contact webhooks/search | `name`, `firstName`, `lastName` | `Name removed` | Direct | High | Store only if required for matching review; avoid logs. |
| Contact email | Contact webhooks/search | `email` | `email_removed@example.invalid` | Direct, normalized for matching | High | Do not log. |
| Contact phone | Contact webhooks/search | `phone` | `0000000000` | Direct, normalized for matching | High | Do not log. |
| Tags | Opportunities search relation/contact payload | `opportunities[].relations[].tags`, `opportunities[].contact.tags` | `["tag_SANITIZED"]` | Direct | High | Verified present in limited response. |
| Custom fields | Opportunities search | `opportunities[].customFields[]` | `[]` | Direct | High | Verified field exists; first limited record had empty array. |
| Campaign ID if available | Attribution data | Unknown | `campaign_SANITIZED` | Direct if present | Low | Not seen in limited page. |
| Attribution source if available | Opportunities search attribution data | `opportunities[].attributions[].utmSessionSource`, `opportunities[].attributions[].medium` | `source_removed` | Direct/calculated | Medium | Verified attribution array exists. |
| First stage entered date | Opportunities search current-stage timestamp or webhooks going forward | `opportunities[].lastStageChangeAt` | `2026-01-01T00:00:00.000Z` | Direct for latest stage change only | Medium | Not reliable for original first stage across existing history. |
| Current stage | Pipelines + opportunity payload | `pipelineStageId` joined to stage map | `Facebook New Lead` | Calculated | High after discovery | Requires pipeline map. |
| Previous stage | Stage history table | Prior `opportunity_stage_history.stage_id` | `stage_SANITIZED` | Calculated | Medium going forward | Webhook payload reviewed does not include previous stage. |
| Won date | Opportunity status/history | Unknown | `2026-01-05T00:00:00.000Z` | Calculated | Low | Need confirm status timestamps or webhook timing. |
| Lost date | Opportunity status/history | Unknown | `2026-01-05T00:00:00.000Z` | Calculated | Low | Need confirm status timestamps or webhook timing. |
| Abandoned date | Opportunity status/history | Unknown | `2026-01-05T00:00:00.000Z` | Calculated | Low | Need confirm account status semantics. |

## Lead Counting Rules

- Count a Facebook lead when an opportunity first enters the exact configured Facebook stage ID.
- Count a website lead when an opportunity first enters the exact configured website stage ID.
- Do not count the same opportunity more than once for the same original source.
- If an opportunity changes between Facebook and website lead stages, preserve the original lead source and write a reconciliation issue.
- Do not use current stage alone for historical reporting unless HighLevel provides reliable historical stage data.
- Until historical stage data is confirmed, current-stage API discovery is only useful for setup checks and current-state sanity checks.

## Contact Matching Rules

Match GHL leads to Sweep&Go customers in this order:

1. Explicit external ID if one is discovered in GHL custom fields.
2. Normalized email.
3. Normalized phone.
4. Review-only fallback using additional context.

Never automatically merge based only on customer name. Preserve GHL contact IDs and Sweep&Go client IDs separately.

## Webhook Plan

Recommended endpoint path:

- `/webhooks/gohighlevel/{GOHIGHLEVEL_WEBHOOK_SECRET}`

Use the existing webhook intake and deduplication path. Store every incoming GoHighLevel webhook first in `integration_events` and expose it through `unified_webhook_events`; keep `webhook_events` reserved for existing Sweep&Go webhook compatibility.

| Event | Why needed | Expected key fields | Deduplication key |
|---|---|---|---|
| `ContactCreate` | New contact source and matching context | `type`, `locationId`, `id`, `source`, `dateAdded`, `email`, `phone`, `tags`, `customFields` | `provider:type:id:dateAdded` or payload fingerprint |
| `ContactUpdate` | Source/custom field/tag changes | Same contact fields | `provider:type:id:dateAdded/updated` or payload fingerprint |
| `ContactTagUpdate` | Tag-based source reconciliation | `type`, `locationId`, `id`, `tags` | `provider:type:id:tags/date` or payload fingerprint |
| `OpportunityCreate` | Initial opportunity source and stage | `type`, `locationId`, `id`, `contactId`, `pipelineId`, `pipelineStageId`, `source`, `status`, `dateAdded` | `provider:type:id:stage:status:dateAdded` |
| `OpportunityStageUpdate` | First-stage-entry tracking going forward | `type`, `locationId`, `id`, `contactId`, `pipelineId`, `pipelineStageId`, `status`, `dateAdded` | `provider:type:id:stage:dateAdded` |
| `OpportunityStatusUpdate` | Won/lost/abandoned timing going forward | `type`, `id`, `pipelineId`, `pipelineStageId`, `status`, `dateAdded` | `provider:type:id:status:dateAdded` |
| `OpportunityUpdate` | General opportunity reconciliation | `type`, `id`, `pipelineId`, `pipelineStageId`, `source`, `status` | `provider:type:id:stage:status:date` |
| `OpportunityDelete` | Deletion/tombstone reconciliation | `type`, `id`, `pipelineId`, `pipelineStageId`, `status` | `provider:type:id:delete:date` |

Signature/auth validation:

- Current local architecture supports a provider-specific secret in the path.
- Confirm whether HighLevel signs webhook payloads or provides a webhook secret header before activation.
- If HighLevel provides signatures, add signature validation before enabling live webhooks.

Retry/order concerns:

- Webhooks can arrive out of order. Stage history processing must use event timestamps where available and preserve original lead source.
- Duplicate deliveries must be idempotent through event fingerprinting.
- If a stage change arrives before an opportunity create event, store the event and upsert from available IDs.

## Historical Reporting Limitation

The reviewed official webhook docs expose current `pipelineStageId`, `status`, and `dateAdded` in opportunity webhook payloads. They do not show previous stage or full stage history fields.

Limited opportunity discovery found `lastStageChangeAt`, but not full stage history or previous stage history. This is not enough to reconstruct original first-stage-entry dates for all existing opportunities.

Accurate first-entry tracking should begin when the HighLevel opportunity-stage webhook integration is activated. Do not invent historical lead dates from current stage, `updatedAt`, or `lastStageChangeAt`.
