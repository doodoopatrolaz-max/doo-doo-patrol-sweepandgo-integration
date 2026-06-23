# Sweep&Go Webhook Processing Map

Phase 8 adds live BI processing for selected Sweep&Go webhook events. Raw webhook storage in `webhook_events` remains the first step and is not replaced.

This document uses sanitized shape findings only. It does not include real customer names, emails, phone numbers, addresses, payloads, IDs, tokens, or private values.

## Shared Shape

Recent live Sweep&Go webhooks use:

- Top-level `type` for event type.
- Top-level `created` for event timestamp.
- Nested `data` object for event details.
- `data.client` as the stable Sweep&Go client ID when present.
- `data.tracking_field` as possible source evidence when present.

## Event Map

| Event type | Stable client ID | Subscription ID | Status | Service/frequency | Date/timestamp | Customer update | Service update | Cancellation update | `first_recurring_date` | Source | MRR | Confidence | Deferred |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `client:client_onboarding_recurring` | `data.client` | Not present | `data.status`, `data.state` | Not present | `created` | Yes | Create/update generic recurring service marker | No | Yes, only if empty, using Arizona date from webhook timestamp | Yes, from `data.tracking_field` when present | No | High for new recurring signup | MRR and exact service ID |
| `client:subscription_created` | `data.client` | `data.subscription_id` | Not present | `data.subscription_name`, `data.subscription_names`, `data.billing_interval` | `created` | Yes | Yes, recurring service by subscription ID | No | Deferred unless already confirmed by onboarding event | Yes, from `data.tracking_field` if present | No | Medium for service update, low for new customer | New-customer counting unless paired with onboarding event |
| `client:subscription_canceled` | `data.client` | `data.subscription_id` | Not present | `data.subscription_name`, `data.subscription_names`, `data.billing_interval` | `created` | Yes | Mark subscription service ended | Yes, subscription-level cancellation by client/subscription/date | No | No new source evidence expected | No | Medium for subscription cancellation | Customer churn unless payload confirms whole-customer cancellation |
| `client:changed_status` | `data.client` | Not present | `data.status` | Not present | `created` | Yes, status only | No | No | No | No new source evidence expected | No | High for status | New customer and cancellation counting |
| `client:client_assigned` | `data.client` | Not present | `data.state_name` | `data.service_days[]`, `data.clean_up_frequency` | `created`, service day start dates | Acknowledge only | No for BI customer KPIs | No | No | No | No | High for assignment notification, low for KPI changes | Customer/service counting |

## Live Processing Rules

- Every incoming Sweep&Go webhook remains stored raw in `webhook_events` before BI processing.
- Duplicate webhook deliveries are ignored by existing event fingerprint logic.
- BI upserts are also idempotent by Sweep&Go client ID, service key, cancellation key, or reconciliation issue fingerprint.
- `client:client_onboarding_recurring` is the only event that currently sets `first_recurring_date`.
- `client:subscription_created` updates service records but creates a reconciliation issue when it might be a new recurring customer or a service change.
- `client:subscription_canceled` records a subscription-level cancellation but does not automatically mark the customer as churned.
- `client:changed_status` updates status only.
- `client:client_assigned` is acknowledged but does not affect customer KPIs.

## Still Deferred

- MRR, unless Sweep&Go provides a reliable recurring price or billing amount field.
- Whole-customer churn from subscription cancellation, unless the payload confirms the whole customer relationship ended.
- Backfilling old Sweep&Go webhook events.
- Treating service assignment, service day changes, or route events as new customers.
- Lead-to-customer matching and close rate.
