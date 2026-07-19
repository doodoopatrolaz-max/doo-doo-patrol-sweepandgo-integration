# KPI Dashboard V2 Owner Scoreboard

This note documents the current private dashboard top-card formulas and source boundaries.

## Top Scoreboard Order

1. Total Active Clients
2. Total Leads
3. New Recurring Customers
4. Close Rate
5. Churn Rate
6. Average Monthly Ticket
7. Lifetime Value
8. Average Revenue Per Hour
9. Net Customer Growth
10. Total Ad Spend

The second row keeps supporting ad and customer-growth metrics such as Meta Spend, Google Spend, Cost Per Lead, Cost Per New Customer, and Cancellations.

## Formulas

- Total Active Clients: latest Sweep&Go active roster snapshot when available.
- Total Leads: reporting-eligible GoHighLevel opportunities by trusted original lead source.
- New Recurring Customers: Sweep&Go BI customers with `first_recurring_date` in the selected range.
- Close Rate: stored stable `lead_customer_matches` conversions divided by reporting-eligible Facebook and Website leads.
- Churn Rate: cancellations in the selected range divided by customers active at the start of the selected range.
- Average Monthly Ticket: temporary configured constant of `$95.00`.
- Lifetime Value: Average Monthly Ticket divided by Monthly Churn Rate.
- Average Revenue Per Hour: accepted payment revenue divided by payroll shift labor hours when both are available from stored Sweep&Go webhook data.
- Net Customer Growth: new recurring customers minus cancellations.
- Total Ad Spend: Meta plus Google stored daily ad performance spend.

## Source Boundaries

- MRR is not a visible top-card KPI until direct active subscription amounts are reliably stored.
- Lifetime Value is unavailable when churn is zero or the churn denominator cannot be calculated.
- Average Revenue Per Hour is unavailable when stored accepted-payment events or payroll shift hours are missing for the selected range.
- Cost per new customer remains unavailable/incomplete when ad spend coverage is incomplete.
- Customer-level private data must not appear in dashboard responses, logs, or documentation.
