# Sweep&Go Field Map

Discovery date: 2026-06-13

Sources inspected:

- Existing `src/sweepandgo/client.ts`
- Existing webhook receiver and onboarding intake code
- Existing report code
- Existing migrations
- Official Sweep&Go Open API documentation
- Read-only live Sweep&Go shape checks for first-page client lists, leads, webhook history, and one redacted client-details shape

No private customer names, addresses, phone numbers, emails, gate codes, payment credentials, or API credentials are included here.

## API Discovery

| Need | Official Endpoint | Method | Auth | Pagination / Filters | Notes |
| --- | --- | --- | --- | --- | --- |
| Customer list: active | `/api/v1/clients/active` | GET | Bearer token | `page`; response includes `paginate.total`, `count`, `per_page`, `current_page`, `total_pages` | Documented and observed. |
| Customer list: active without active subscription | `/api/v1/clients/active_no_subscription` | GET | Bearer token | `page`; same pagination shape | Important for not over-counting recurring customers. |
| Customer list: inactive | `/api/v1/clients/inactive` | GET | Bearer token | `page`; same pagination shape | Used for inactive/canceled pool, but cancellation reason/date are not shown in list shape. |
| Customer details and payments | `/api/v2/clients/client_details` | POST | Bearer token | Body: `{ "client": "..." }`; observed response is an array | Provides client detail fields and `payments[]`. Does not prove MRR. |
| Client email search | `/api/v2/clients/client_search` | POST | Bearer token | Body includes `email`, optional status/latest | Existing onboarding enrichment uses it. |
| Leads | `/api/v1/leads/list` | GET | Bearer token | `page`; same pagination shape | Provides lead fields and optional `tracking_field`. |
| Out-of-area leads | `/api/v1/leads/out_of_service` | GET | Bearer token | `page`; same pagination shape | Separate lead list for out-of-area leads. |
| Jobs | `/api/v1/dispatch_board/jobs_for_date` | GET | Bearer token | `date=YYYY-MM-DD`; no pagination documented for this endpoint | Documents job status and job types. |
| Completed jobs report | `/api/v2/report/completed_jobs_report` | GET | Bearer token | `date=YYYY-MM-DD` or `date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`; no pagination observed | Railway-safe read-only source for completed job status, type, price, duration, assigned staff, and service date. |
| Time & Mileage Report | Not found in published Open API docs or tested token endpoints | N/A | N/A | Screen exists in Sweep&Go UI at Staff > Time & Mileage Report; endpoint not confirmed | Tested likely `/api/v1` and `/api/v2` staff/report/payroll time-mileage paths and received 404. Use CSV/browser export or `payroll:shift_info` webhook if it becomes available. |
| Previously triggered webhooks | `/api/v1/webhooks/list` | GET | Bearer token | `page`; same pagination shape | Provides `id`, `type`, `webhooks_url`, `data`, `created_at`. |
| All possible webhooks | `/api/v1/webhooks/index` | GET | Documentation shows authorization failure example; auth behavior should be confirmed | Not documented with pagination | Use docs and token metadata response as current event catalog. |
| Retry one webhook | `/api/v1/webhooks/retry` | PUT | Bearer token | Body: `{ "id": "..." }` | Write-like retry action. Not used by reporting sync. |

Rate limits: not found in the official documentation during this pass.

## Business Field Map

| Business value | Endpoint or webhook | Exact JSON field path | Sanitized example | Direct or calculated | Confidence | Unanswered question |
| --- | --- | --- | --- | --- | --- | --- |
| Active recurring customer | `/api/v1/clients/active` plus subscription fields | `data[].status`, `data[].subscription_names`, `data[].one_time_client`, `data[].cleanup_frequency` | `status: "active"`, `subscription_names: "[REDACTED_PLAN]"`, `one_time_client: false`, `cleanup_frequency: "once_a_week"` | Calculated: active status plus active subscription indicator, not every active client | Medium | Need confirmation that non-empty `subscription_names` is the correct recurring subscription signal for all cases. |
| Inactive or canceled customer | `/api/v1/clients/inactive` | `data[].status` | `status: "inactive"` | Direct inactive status | Medium | The docs/list shape do not distinguish inactive vs canceled or provide cancellation date/reason. |
| Active subscription | `/api/v1/clients/active`; `/api/v1/clients/active_no_subscription` | `data[].subscription_names` and list membership | `subscription_names: "[REDACTED_PLAN]"` | Calculated | Medium | Need official confirmation or payload sample for paused/replaced subscriptions. |
| Paused subscription | Webhook event catalog | `client:subscription_paused`; `client:subscription_unpaused` | Event names only | Direct event, not list field | Low | Need actual paused/unpaused webhook payload shape and current paused-state field. |
| Subscription start date | Webhook event catalog | `client:subscription_created.created_at` in webhook history row, or webhook payload date if present | `created_at: "[REDACTED_TIMESTAMP]"` | Calculated from webhook timing unless payload supplies a date | Low | Need actual `client:subscription_created` payload. |
| Subscription cancellation date | Webhook event catalog | `client:subscription_canceled.created_at` in webhook history row, or webhook payload date if present | `created_at: "[REDACTED_TIMESTAMP]"` | Calculated from webhook timing unless payload supplies a date | Low | Need actual cancellation webhook payload. |
| Cancellation reason | Not found in documented read endpoints or observed shapes | Unknown | N/A | Unavailable | Low | Need actual `client:subscription_canceled` or `client:subscription_cancel_requested` payload to see whether reason is included. |
| Recurring service frequency | Client list/details and dispatch jobs | `data[].cleanup_frequency`; dispatch `data[].clean_up_frequency` | `cleanup_frequency: "once_a_week"` | Direct | High | Need mapping table for all frequency abbreviations seen in live data. |
| Recurring subscription amount | Not found in client list/details docs or observed details shape | Unknown | N/A | Unavailable | Low | Need a documented subscription pricing endpoint, invoice item payload, or actual subscription webhook payload. |
| Monthly recurring revenue | Not directly supplied in observed Sweep&Go client shapes | Unknown | N/A | Calculated only if recurring amount and billing frequency are later confirmed | Low | Need recurring subscription amount source. Do not calculate from payments alone. |
| Customer acquisition source | Client list/details and onboarding payload docs | `data[].tracking_field`; onboarding input `how_heard_about_us`, `how_heard_answer`, `tracking_field` | `utm_source=facebook`; `how_heard_answer: "Facebook"` | Direct when explicit field exists; otherwise unknown | Medium | Active client rows often have `tracking_field: null`; need actual source payload coverage. |
| Onboarding source | Onboarding API docs and onboarding webhooks | `how_heard_about_us`, `how_heard_answer`, `tracking_field`; webhook payload may include same fields | `how_heard_about_us: "social_media"`, `how_heard_answer: "Facebook"` | Direct when present | Medium | Need actual onboarding webhook payloads for Doo Doo Patrol. |
| One time cleanup | Dispatch jobs and client list | Dispatch `data[].type = "one_time"`; client `data[].one_time_client`; onboarding `clean_up_frequency = "one_time"` | `type: "one_time"` | Direct for jobs; calculated for customer classification | Medium | Need product/service payload to distinguish standalone cleanup from nonrecurring invoice items. |
| Initial cleanup | Dispatch jobs and onboarding docs | Dispatch `data[].type = "initial"`; onboarding `initial_cleanup_required` | `type: "initial"`, `initial_cleanup_required: 1` | Direct | High for jobs/onboarding | Need invoice/subscription payload to tie initial cleanup to recurring customer revenue. |
| Completed job service revenue | `/api/v2/report/completed_jobs_report` | `job_list[].price`, `job_list[].duration`, `job_list[].status_name`, `job_list[].type`, `job_list[].pricing_plan_name`, `job_list[].service_plan_name`, `job_list[].date` | `price: "[REDACTED_AMOUNT]"`, `duration: "00:30"`, `status_name: "completed"` | Direct for allocated job revenue and recorded service duration | High | Does not include drive time or breaks; skipped/missed/incomplete/canceled rows are excluded from revenue/hour KPI. |
| Additional service | Onboarding docs and dispatch jobs | `cross_sells`, `cross_sells_names`, dispatch `count_cross_sells` | `cross_sells_names: "[REDACTED_CROSS_SELLS]"` | Direct when present | Medium | Need actual cross-sell/service item names and IDs for sanitizing/deodorizing. |
| Route time and mileage | Staff > Time & Mileage Report UI; future CSV/export/webhook source | Staff/name, time, personal mileage, company mileage, total mileage | `name: "[STAFF_NAME]"`, `time: "5:29"`, `company_mileage: 49`, `total_mileage: 49` | Direct when Time & Mileage rows are available; currently unavailable through confirmed Open API endpoint | Medium for UI fields, low for API access | Need an authenticated CSV/export source, published endpoint, or enabled `payroll:shift_info` webhook records. Daily dashboard matches by staff name and uses total mileage first, company mileage as fallback. Jen is excluded from production efficiency. |
| Dog count | Onboarding API docs | `number_of_dogs`; possibly dog arrays `dog_name[]` | `number_of_dogs: 2` | Direct in onboarding payload | Medium | Client list/details observed shape did not include dog count. Need actual onboarding webhook or another read endpoint. |
| Customer created date | Not found in client list/details docs or observed shapes | Unknown | N/A | Unavailable | Low | Need a documented field or webhook event to determine original creation date. |
| Customer onboarding date | Webhook history and onboarding webhooks | `created_at` on `client:client_onboarding_recurring` or `client:client_onboarding_onetime` history rows | `created_at: "[REDACTED_TIMESTAMP]"` | Calculated from webhook timing unless payload supplies a date | Medium | Need retained webhook history for each customer and actual onboarding payload shape. |
| Customer reactivation or return | Possible from inactive-to-active status changes | `client:changed_status` webhook plus historical previous inactive record | Event name only | Calculated | Low | Need actual changed-status payload showing old/new status, or compare recurring sync snapshots over time. |
| Current account balance | Not found in docs or observed client details shape | Unknown | N/A | Unavailable | Low | Need a balance/invoices endpoint or actual payload proving balance field. |

## Webhook Discovery

Currently handled by the application:

- Receiver accepts any event posted to `POST /webhooks/sweepandgo/{WEBHOOK_PATH_SECRET}`.
- Onboarding processor specifically acts on:
  - `client:client_onboarding_recurring`
  - `client:client_onboarding_onetime`
  - `client:subscription_created`
- Everything else is stored and marked processed or ignored by the processor.

Recent read-only webhook history shape showed:

- `id`
- `type`
- `webhooks_url`
- `data`
- `created_at`

Recent first pages included `client:areas_to_clean_changed` and `client:changed_address`. This is a small recent sample, not the full enabled-event list.

Official relevant event catalog includes:

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
- `client:invoice_finalized`
- `client:client_no_assigned`
- `client:client_assigned`
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
- `job:started`
- `job:completed`
- `organization:client_onboarding_form_changed`
- `organization:cross_sells_changed`
- `payroll:shift_info`
- `payroll:tip_info`
- `dog:birthday`
- `client:credit_card_link_created`

Do not enable `client:credit_card_link_created` for reporting unless there is a clear operational need, because it is a private credit-card-link event.

## Recommended Additional Events For BI

Do not change live webhook configuration yet. Recommended additions to review in Sweep&Go:

| Reporting need | Event(s) |
| --- | --- |
| New recurring customer | `client:client_onboarding_recurring`, `client:subscription_created` |
| One time customer | `client:client_onboarding_onetime`, `job:completed` |
| Customer cancellation | `client:subscription_cancel_requested`, `client:subscription_canceled`, `client:changed_status` |
| Customer pause | `client:subscription_paused`, `client:subscription_unpaused` |
| Customer reactivation | `client:changed_status`, `client:subscription_created`, `client:subscription_unpaused` |
| Subscription change | `client:subscription_created`, `client:subscription_canceled`, `client:changed_info`, `client:areas_to_clean_changed` |
| New invoice | `client:invoice_finalized` |
| Payment | `client:client_payment_accepted`, `client:client_payment_declined`, `payroll:tip_info` only for tip context |
| Customer source update | `client:changed_info`, `client:client_onboarding_recurring`, `client:client_onboarding_onetime` |

## Reporting Rules Implemented

- Do not count every client record as recurring.
- Active recurring currently requires active status plus an observed subscription signal.
- Active clients without subscriptions are kept separate.
- Paused customers are not inferred from ordinary active/inactive rows; they require pause/unpause event data or a future explicit status field.
- Returning customers require historical status/sync comparison and must not be automatically counted as brand-new customers.
- MRR is not calculated from completed payments.
- Average Revenue Per Hour may use `client:client_payment_accepted` accepted-payment amounts and `payroll:shift_info` labor duration only when those events are stored for the selected range.
- Average Monthly Ticket is currently a temporary dashboard constant of `$95.00`, not a Sweep&Go-derived subscription amount.
- One-time cleanup is identified from explicit `one_time_client`, `cleanup_frequency = "one_time"`, or dispatch job `type = "one_time"` only.
- Source normalization uses explicit source fields only and preserves raw source values separately.

## Compatibility Strategy

The existing app stores incoming Sweep&Go webhooks in `webhook_events`. Phase 2 adds `integration_events` for the long-term BI system, but does not replace the working webhook receiver yet.

Safe strategy:

1. Keep `webhook_events` as the active intake table for the current receiver.
2. Add `integration_events` for new provider-normalized ingestion.
3. Add `unified_webhook_events` view so reports/reconciliation can read old and new webhook records together.
4. In a later migration, dual-write Sweep&Go webhooks to `integration_events`.
5. After dual-write is verified, move the receiver store from `webhook_events` to `integration_events`.
6. Never delete existing `webhook_events` records during the migration.
