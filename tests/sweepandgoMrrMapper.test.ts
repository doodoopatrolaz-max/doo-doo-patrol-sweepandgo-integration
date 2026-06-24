import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateDirectActiveSubscriptionMrr } from "../src/sweepandgo/mrrMapper.ts";

describe("Sweep&Go direct active subscription MRR mapper", () => {
  it("calculates one active monthly subscription", () => {
    const result = calculateDirectActiveSubscriptionMrr({
      billing: { subscriptions: [{ status: "ACTIVE", amount: "$79.00 monthly", billing_interval: "Monthly" }] }
    });

    assert.equal(result.monthlyRecurringRevenue, 79);
    assert.equal(result.activeSubscriptions.length, 1);
  });

  it("adds multiple active monthly subscriptions", () => {
    const result = calculateDirectActiveSubscriptionMrr({
      billing: {
        subscriptions: [
          { status: "ACTIVE", amount: "$20.00 monthly", billing_interval: "Monthly" },
          { status: "ACTIVE", amount: "$79.00 monthly", billing_interval: "Monthly" }
        ]
      }
    });

    assert.equal(result.monthlyRecurringRevenue, 99);
    assert.equal(result.activeSubscriptions.length, 2);
  });

  it("adds active base plan plus active spray add-on", () => {
    const result = calculateDirectActiveSubscriptionMrr({
      billing: {
        subscriptions: [
          { name: "Regular Plan", status: "ACTIVE", amount: "$79.00 monthly", billing_interval: "Monthly" },
          { name: "Fresh Poo", status: "ACTIVE", amount: "$20.00 monthly", billing_interval: "Monthly" }
        ]
      }
    });

    assert.equal(result.monthlyRecurringRevenue, 99);
  });

  it("ignores canceled subscriptions", () => {
    const result = calculateDirectActiveSubscriptionMrr({
      billing: {
        subscriptions: [
          { status: "ACTIVE", amount: "$79.00 monthly", billing_interval: "Monthly" },
          { status: "CANCELED", amount: "$20.00 monthly", billing_interval: "Monthly" }
        ]
      }
    });

    assert.equal(result.monthlyRecurringRevenue, 79);
    assert.equal(result.canceledSubscriptionsIgnored, 1);
  });

  it("ignores paused subscriptions", () => {
    const result = calculateDirectActiveSubscriptionMrr({
      billing: {
        subscriptions: [
          { status: "ACTIVE", amount: "$79.00 monthly", billing_interval: "Monthly" },
          { status: "PAUSED", amount: "$20.00 monthly", billing_interval: "Monthly" }
        ]
      }
    });

    assert.equal(result.monthlyRecurringRevenue, 79);
    assert.equal(result.pausedSubscriptionsIgnored, 1);
  });

  it("flags non-monthly intervals for review", () => {
    const result = calculateDirectActiveSubscriptionMrr({
      billing: { subscriptions: [{ status: "ACTIVE", amount: "$79.00", billing_interval: "Weekly" }] }
    });

    assert.equal(result.monthlyRecurringRevenue, undefined);
    assert.equal(result.nonMonthlySubscriptions, 1);
    assert(result.reviewReasons.includes("non_monthly_interval"));
  });

  it("ignores one-time invoices and payments", () => {
    const result = calculateDirectActiveSubscriptionMrr({
      billing: {
        subscriptions: [{ status: "ACTIVE", amount: "$79.00", billing_interval: "Monthly" }],
        invoices: [{ status: "ACTIVE", amount: "$300.00", billing_interval: "Monthly" }],
        payments: [{ status: "ACTIVE", amount: "$300.00", billing_interval: "Monthly" }]
      }
    });

    assert.equal(result.monthlyRecurringRevenue, 79);
    assert.equal(result.activeSubscriptions.length, 1);
  });

  it("flags active subscriptions missing amount", () => {
    const result = calculateDirectActiveSubscriptionMrr({
      billing: { subscriptions: [{ status: "ACTIVE", billing_interval: "Monthly" }] }
    });

    assert.equal(result.monthlyRecurringRevenue, undefined);
    assert.equal(result.missingAmountSubscriptions, 1);
    assert(result.reviewReasons.includes("missing_amount"));
  });
});
