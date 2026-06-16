# Meta Ads Field Map

Phase 5 status: read-only reporting foundation added. Live API discovery must wait until Meta credentials are configured securely in Railway.

Official Meta documentation to verify before live use:

- Marketing API overview and access: https://developers.facebook.com/docs/marketing-api/
- Marketing API Insights API: https://developers.facebook.com/docs/marketing-api/insights/
- Ads Insights reference: https://developers.facebook.com/docs/marketing-api/reference/ads-insights/
- Ad Account reference: https://developers.facebook.com/docs/marketing-api/reference/ad-account/
- Campaign reference: https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/
- System users: https://developers.facebook.com/docs/business-manager/system-users/

## Authentication Recommendation

Recommended production method: Meta Business system user token with read-only ad account access.

Reason: this app runs scheduled server-side reporting on Railway for one company. A system user token is more stable for server-to-server jobs than a personal user token, as long as it is created in the Doo Doo Patrol Business Manager, assigned only the needed ad account, and stored only in Railway.

A user access token can be used temporarily for discovery, but it should not be the long-term production method because user tokens are tied to a person and may expire or break when that user changes permissions.

Minimum access:

- Meta app with Marketing API access.
- Doo Doo Patrol ad account assigned to the app/system user.
- Read-only ad account role where possible.
- Permission scope expected for reporting: `ads_read`.
- Do not grant ad management, billing, business management, catalog, page posting, messaging, pixel/event write, or campaign modification permissions for this phase unless Meta requires a broader app-review path and Bryan approves it.

Token handling:

- Store tokens only as Railway variables.
- Do not paste tokens into Codex chat.
- Do not commit tokens to GitHub or `.env.example`.
- Rotate the token if it is ever exposed.
- Confirm token expiration behavior in Meta Business settings before relying on scheduled jobs.

Required Railway variables:

- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`
- `META_API_VERSION`
- `META_API_BASE_URL`

Optional variables if needed later:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_BUSINESS_ID`

## Reporting Rules

- Meta Ads Insights is the source of truth for Facebook and Instagram ad spend.
- Spend is stored as decimal dollars in `daily_ad_performance.spend_amount`.
- Use the Meta account timezone for daily date boundaries.
- Store currency code from the ad account.
- Keep Meta-reported leads separate from GoHighLevel Facebook leads.
- Do not combine Meta Ads and Google Ads until the Google Ads phase is built.
- Campaign level is the first supported sync level. Ad set/ad columns are available for future deeper reporting.

## Field Map

| Business field | Official endpoint | Exact field name | Business value | Direct or calculated | Confidence | Unanswered questions |
|---|---|---|---|---|---|---|
| Ad account ID | Ad Account | `account_id` / `id` | Joins all Meta spend to the configured ad account. | Direct | High | Confirm whether Railway value includes `act_` prefix. |
| Account timezone | Ad Account | `timezone_name` | Defines daily reporting boundaries. | Direct | High | Confirm actual account timezone during live discovery. |
| Account currency | Ad Account | `currency` | Ensures spend is interpreted as the right currency. | Direct | High | Confirm currency during live discovery. |
| Date | Ads Insights | `date_start` | Daily reporting date. | Direct | High | Use account timezone boundaries. |
| Campaign ID | Ads Insights | `campaign_id` | Idempotent campaign reporting key. | Direct | High | None. |
| Campaign name | Ads Insights | `campaign_name` | Human-readable reporting label. | Direct | High | Names can change; ID remains key. |
| Ad set ID | Ads Insights | `adset_id` | Future ad set-level reporting key. | Direct when level includes ad sets | Medium | Phase 5 sync starts at campaign level. |
| Ad set name | Ads Insights | `adset_name` | Future ad set-level label. | Direct when level includes ad sets | Medium | Phase 5 sync starts at campaign level. |
| Ad ID | Ads Insights | `ad_id` | Future ad-level reporting key. | Direct when level is ad | Medium | Phase 5 sync starts at campaign level. |
| Ad name | Ads Insights | `ad_name` | Future ad-level label. | Direct when level is ad | Medium | Phase 5 sync starts at campaign level. |
| Spend | Ads Insights | `spend` | Source of truth for Facebook/Instagram spend. | Direct | High | Stored as decimal dollars. |
| Impressions | Ads Insights | `impressions` | Reach/frequency and CPM context. | Direct | High | None. |
| Reach | Ads Insights | `reach` | Unique people reached. | Direct | High | None. |
| Frequency | Ads Insights | `frequency` | Frequency pressure indicator. | Direct | High | None. |
| Clicks | Ads Insights | `clicks` | General click volume. | Direct | High | Includes all clicks as reported by Meta. |
| Link clicks | Ads Insights `actions` | `action_type = link_click` | Website traffic indicator. | Calculated from actions | Medium | Confirm attribution settings in live response. |
| Landing page views | Ads Insights `actions` | `action_type = landing_page_view` | Better traffic-quality signal than raw clicks. | Calculated from actions | Medium | Confirm event availability. |
| Leads | Ads Insights `actions` | `action_type = lead` and related lead action types | Meta-reported lead volume. | Calculated from actions | Medium | Keep separate from GHL Facebook leads. |
| Cost per lead | Ads Insights `cost_per_action_type` | lead action type value | Meta-reported cost per lead. | Calculated from action cost array | Medium | Prefer recalculated spend/GHL leads for business CPL later. |
| CTR | Ads Insights | `ctr` | Click-through rate. | Direct | High | Meta returns percentage value. |
| CPC | Ads Insights | `cpc` | Cost per click. | Direct | High | None. |
| CPM | Ads Insights | `cpm` | Cost per thousand impressions. | Direct | High | None. |
| Objective | Ads Insights / Campaign | `objective` | Campaign goal context. | Direct | Medium | Confirm availability in Insights response. |
| Optimization goal | Ad Set | `optimization_goal` | Explains delivery optimization. | Direct when ad set data is fetched | Low for campaign-level sync | Add ad set lookup if needed. |
| Buying type | Ads Insights / Campaign | `buying_type` | Auction/reservation context. | Direct | Medium | Confirm availability in Insights response. |
| Status | Campaign | `status` | Configured campaign status. | Direct when campaign lookup is added | Low for first sync | Add campaign lookup if needed. |
| Effective status | Campaign | `effective_status` | Actual serving status. | Direct when campaign lookup is added | Low for first sync | Add campaign lookup if needed. |

## Phase 5 Commands

These commands are read only. They skip safely when required credentials are missing.

```bash
npm run discover:meta:account
npm run discover:meta:insights -- --date=YYYY-MM-DD --max-pages=1
npm run sync:meta:daily -- --date=YYYY-MM-DD --max-pages=1
npm run sync:meta:backfill
```

Do not run a historical backfill until the limited daily sync is verified.
