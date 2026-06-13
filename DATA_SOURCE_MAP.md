# Data Source Map

## Source Of Truth Rules

| Data | Primary Source | Secondary/Reconciliation Source | Notes |
| --- | --- | --- | --- |
| New leads | GoHighLevel | Gmail onboarding emails, Sweep&Go leads when available | Use the `Fresh Leads to Onboarding` pipeline. |
| Facebook leads | GoHighLevel | Meta Ads lead/performance data | Stage name: `Facebook New Lead`. Store in configuration. |
| Website quote leads | GoHighLevel | Website form source if later connected | Stage name: `Website Quote Lead`. Store in configuration. |
| Other leads | GoHighLevel | Manual review | Normalize source to `other` when it is known but not Facebook or website. |
| Active customers | Sweep&Go | Reconciliation against GoHighLevel | Sweep&Go is primary for active customer count. |
| Recurring service details | Sweep&Go | Onboarding emails only when Sweep&Go data is missing | Do not use Gmail as the only source when Sweep&Go has the data. |
| Customer status | Sweep&Go | GoHighLevel for workflow context | Sweep&Go status wins for reporting. |
| Customer acquisition source | Sweep&Go when available | GoHighLevel lead/opportunity source, onboarding emails | Normalize to `facebook`, `website`, `other`, or `unknown`. |
| One-time cleanups | Sweep&Go | GoHighLevel if the customer never converted | Confirm exact Sweep&Go fields before implementing. |
| Cancellations | Sweep&Go | Gmail or GoHighLevel cancellation workflows | Store raw and normalized cancellation reason. |
| Facebook/Instagram ad spend | Meta Ads | None | Meta Ads is the source of truth. Use read-only access. |
| Google ad spend | Google Ads | None | Google Ads is the source of truth. Use read-only access. |
| Daily business metrics | Reporting database | Rebuilt from source tables | Store computed metrics for fast reporting and auditability. |

## Confirmed Configuration Values

| Setting | Value | Status |
| --- | --- | --- |
| GoHighLevel pipeline name | `Fresh Leads to Onboarding` | Provided by Bryan |
| Facebook lead stage name | `Facebook New Lead` | Provided by Bryan |
| Website quote stage name | `Website Quote Lead` | Provided by Bryan |
| New customer source values | `facebook`, `website`, `other`, `unknown` | Provided by Bryan |

## Unknowns To Confirm Before Live Integrations

| Provider | Needs Confirmation |
| --- | --- |
| Sweep&Go | Exact API fields for recurring customer status, MRR, cancellation reason, one-time cleanup identification, and customer acquisition source. |
| GoHighLevel | Location ID, pipeline ID, stage IDs, webhook payload shape, opportunity update semantics, and safest read-only/API scopes available. |
| Gmail | Whether onboarding emails will be read by API polling, push notification, or manual reconciliation; exact subject/from patterns. |
| Meta Ads | Ad account ID, reporting timezone, attribution window, campaign naming rules, lead form mapping, and required read-only permissions. |
| Google Ads | Customer ID, manager account relationship, reporting timezone, conversion definitions, and required read-only permissions. |

## Reporting Metrics

| Metric | Calculation Direction |
| --- | --- |
| Facebook ad spend | Sum Meta Ads daily spend for Facebook/Instagram campaigns in date range. |
| Google ad spend | Sum Google Ads daily spend in date range. |
| Facebook leads | Count GoHighLevel leads/opportunities in configured Facebook stage/source. |
| Website quote leads | Count GoHighLevel leads/opportunities in configured website quote stage/source. |
| Other leads | Count GoHighLevel leads not normalized as Facebook or website. |
| New recurring customers | Count Sweep&Go customers whose recurring service starts in date range. |
| New recurring customer source | Use Sweep&Go source when available; otherwise reconcile to GoHighLevel; otherwise `unknown`. |
| One-time cleanups | Count Sweep&Go one-time services in date range after exact fields are confirmed. |
| Cancellations | Count Sweep&Go cancellations in date range. |
| Cancellation reasons | Store raw reason and later normalize into reporting buckets. |
| Current recurring customer count | Count active Sweep&Go recurring customers as of report date. |
| Monthly recurring revenue | Sum active recurring customer recurring revenue from Sweep&Go-confirmed pricing. |
| Revenue added | Sum recurring revenue added by new recurring customers in date range. |
| Net recurring customer growth | New recurring customers minus cancellations in date range. |
