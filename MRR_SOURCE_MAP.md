# MRR Source Map

## Phase 9A Discovery Status

Last updated: 2026-06-24

Monthly recurring revenue must come from direct active subscription billing amounts when available. Do not calculate MRR first from dog count, plan-name guessing, pricing rules, payment history, or one-time invoices.

## Sweep&Go Webhook Source: `client:subscription_created`

Stored production `webhook_events` were inspected with aggregate, redacted analysis only.

| Field | Observed path | Present in stored `client:subscription_created` events | Confidence | Notes |
| --- | --- | ---: | --- | --- |
| Client ID | `$.data.client` | Yes | High | Stable enough to associate a webhook with a BI customer. |
| Subscription ID | `$.data.subscription_id` | Yes | High | Stable enough for a future subscription ledger key. |
| Subscription name | `$.data.subscription_name`, `$.data.subscription_names` | Yes | High | Useful for display/review, not enough by itself for direct MRR. |
| Status | Not present | No | Medium | Event semantics indicate a subscription was created, but no explicit active status field was observed. |
| Amount | Not present | No | Low | Cannot calculate direct MRR from stored subscription-created webhooks. |
| Billing interval | `$.data.billing_interval` | Yes | High | Interval is present, but amount is missing. |
| Billing option | Not present | No | Low | Not available in stored webhook payloads. |
| Event timestamp | `$.created`, `received_at` | Yes | High | Suitable for event timing; not a billing amount source. |
| Created date | `$.created` | Yes | Medium | Event created timestamp exists; subscription table created date is not separately confirmed. |
| Canceled indicator | Not present on created events | No | N/A | Cancellation state should come from cancellation events. |
| Paused indicator | Not present on created events | No | N/A | Pause state should come from pause/unpause events. |

## Related Sweep&Go Webhooks

| Event | Client ID | Subscription ID | Name | Amount | Interval | Status/change signal | MRR use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `client:subscription_created` | Yes | Yes | Yes | No | Yes | Event semantics only | Can create a ledger shell, but cannot set MRR. |
| `client:subscription_canceled` | Yes | Yes | Yes | No | Yes | Cancellation event; some include `$.data.termination_reason` | Can mark a known ledger subscription inactive by ID, once ledger exists. |
| `client:subscription_paused` | Yes | Yes | Yes | No | Yes | Pause event | Can mark a known ledger subscription paused by ID, once ledger exists. |
| `client:subscription_unpaused` | Yes | Yes | Yes | No | Yes | Unpause event | Can mark a known ledger subscription active by ID, once ledger exists. |
| `client:client_onboarding_recurring` | Yes | No | No | No | No | Client status/state only | Good for first recurring date/customer creation, not MRR. |

## Current Conclusion

Stored Sweep&Go subscription webhooks are not sufficient to calculate direct MRR because the subscription amount is absent.

They are useful for a future subscription ledger only after a direct subscription amount source is confirmed. The ledger can use `client ID + subscription ID` as a stable key and can use canceled/paused/unpaused webhooks to maintain active state.

## Safe MRR Rules

1. Count only subscriptions with a stable client ID, stable subscription ID, direct amount, monthly interval, and active/billable state.
2. Ignore canceled subscriptions.
3. Ignore paused subscriptions unless Sweep&Go confirms they remain billable.
4. Ignore one-time invoices and payment history.
5. Do not subtract or deactivate a subscription unless cancellation/pause events include the same stable subscription ID.
6. Do not treat `subscription_names` or plan names as direct MRR.
7. If amount is missing, leave MRR unavailable and create a review item rather than guessing.

## Recommended Next Source To Confirm

Ask Sweep&Go support for the API endpoint or export behind the customer Billing -> Subscriptions table, specifically fields for:

- client ID
- subscription ID
- subscription name
- subscription status
- amount
- billing option
- billing interval
- created date
- canceled/paused state

If that source is unavailable, the fallback choices are:

- use a private billing subscriptions export if Sweep&Go can provide one;
- use plan-name logic only as a clearly labeled estimate;
- keep MRR unavailable until direct billing data is available.
