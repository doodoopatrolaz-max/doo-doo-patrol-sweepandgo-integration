# Meta Ads Module

Read-only foundation for Facebook and Instagram ad spend and performance sync.

Boundary:

- Meta Ads will be the source of truth for Facebook and Instagram advertising spend and performance.
- Use read-only permissions when this module is implemented.
- Do not modify Meta campaigns, ad sets, ads, budgets, audiences, pixels, billing, events, or account settings.
- Current sync level is campaign-level daily Insights.
- Ad set/ad fields are present in the database for future deeper reporting.
- Live API calls require `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID` in Railway.
