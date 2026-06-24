export type SweepAndGoSubscriptionMrrItem = {
  name?: string;
  amount: number;
  status: "active";
  interval: "monthly";
  sourcePath: string;
};

export type SweepAndGoSubscriptionMrrReview =
  | "missing_amount"
  | "missing_status"
  | "ambiguous_interval"
  | "non_monthly_interval"
  | "inactive_subscription";

export type SweepAndGoSubscriptionMrrResult = {
  monthlyRecurringRevenue?: number;
  activeSubscriptions: SweepAndGoSubscriptionMrrItem[];
  canceledSubscriptionsIgnored: number;
  pausedSubscriptionsIgnored: number;
  inactiveSubscriptionsIgnored: number;
  nonMonthlySubscriptions: number;
  ambiguousIntervalSubscriptions: number;
  missingAmountSubscriptions: number;
  reviewReasons: SweepAndGoSubscriptionMrrReview[];
  fieldPaths: {
    subscriptionContainerPaths: string[];
    statusPaths: string[];
    amountPaths: string[];
    intervalPaths: string[];
  };
};

type CandidateSubscription = {
  value: Record<string, unknown>;
  path: string;
};

const INVOICE_OR_PAYMENT_PATH = /invoice|payment|transaction|charge|credit_card|card/i;
const SUBSCRIPTION_PATH = /subscription|billing/i;

export function calculateDirectActiveSubscriptionMrr(input: unknown): SweepAndGoSubscriptionMrrResult {
  const candidates = findSubscriptionCandidates(input);
  const result: SweepAndGoSubscriptionMrrResult = {
    activeSubscriptions: [],
    canceledSubscriptionsIgnored: 0,
    pausedSubscriptionsIgnored: 0,
    inactiveSubscriptionsIgnored: 0,
    nonMonthlySubscriptions: 0,
    ambiguousIntervalSubscriptions: 0,
    missingAmountSubscriptions: 0,
    reviewReasons: [],
    fieldPaths: {
      subscriptionContainerPaths: unique(candidates.map((candidate) => parentPath(candidate.path))),
      statusPaths: [],
      amountPaths: [],
      intervalPaths: []
    }
  };

  for (const candidate of candidates) {
    const status = subscriptionStatus(candidate.value);
    if (!status.value) {
      pushUnique(result.reviewReasons, "missing_status");
      continue;
    }
    result.fieldPaths.statusPaths.push(`${candidate.path}.${status.path}`);
    if (status.value === "canceled" || status.value === "cancelled") {
      result.canceledSubscriptionsIgnored += 1;
      result.inactiveSubscriptionsIgnored += 1;
      continue;
    }
    if (status.value === "paused") {
      result.pausedSubscriptionsIgnored += 1;
      result.inactiveSubscriptionsIgnored += 1;
      continue;
    }
    if (status.value !== "active") {
      result.inactiveSubscriptionsIgnored += 1;
      continue;
    }

    const amount = subscriptionAmount(candidate.value);
    if (amount.value === undefined) {
      result.missingAmountSubscriptions += 1;
      pushUnique(result.reviewReasons, "missing_amount");
      continue;
    }
    result.fieldPaths.amountPaths.push(`${candidate.path}.${amount.path}`);

    const interval = subscriptionInterval(candidate.value);
    if (!interval.value) {
      result.ambiguousIntervalSubscriptions += 1;
      pushUnique(result.reviewReasons, "ambiguous_interval");
      continue;
    }
    result.fieldPaths.intervalPaths.push(`${candidate.path}.${interval.path}`);
    if (interval.value !== "monthly") {
      result.nonMonthlySubscriptions += 1;
      pushUnique(result.reviewReasons, "non_monthly_interval");
      continue;
    }

    result.activeSubscriptions.push({
      name: subscriptionName(candidate.value),
      amount: amount.value,
      status: "active",
      interval: "monthly",
      sourcePath: candidate.path
    });
  }

  result.fieldPaths.subscriptionContainerPaths = unique(result.fieldPaths.subscriptionContainerPaths);
  result.fieldPaths.statusPaths = unique(result.fieldPaths.statusPaths);
  result.fieldPaths.amountPaths = unique(result.fieldPaths.amountPaths);
  result.fieldPaths.intervalPaths = unique(result.fieldPaths.intervalPaths);

  if (result.activeSubscriptions.length) {
    result.monthlyRecurringRevenue = roundMoney(result.activeSubscriptions.reduce((total, item) => total + item.amount, 0));
  }

  return result;
}

function findSubscriptionCandidates(input: unknown): CandidateSubscription[] {
  const candidates: CandidateSubscription[] = [];
  walk(input, "$", candidates);
  return candidates;
}

function walk(value: unknown, path: string, candidates: CandidateSubscription[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, candidates));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  if (looksLikeSubscriptionRecord(value, path)) {
    candidates.push({ value, path });
  }

  for (const [key, child] of Object.entries(value)) {
    walk(child, `${path}.${key}`, candidates);
  }
}

function looksLikeSubscriptionRecord(value: Record<string, unknown>, path: string): boolean {
  if (INVOICE_OR_PAYMENT_PATH.test(path)) {
    return false;
  }
  if (!SUBSCRIPTION_PATH.test(path)) {
    return false;
  }
  const keys = new Set(Object.keys(value).map((key) => key.toLowerCase()));
  const hasStatus = ["status", "subscription_status", "state", "active", "is_active"].some((key) => keys.has(key));
  const hasAmount = ["amount", "price", "monthly_amount", "monthly_price", "subscription_amount", "total"].some((key) => keys.has(key));
  const hasInterval = ["billing_interval", "billinginterval", "interval", "billing_frequency", "frequency"].some((key) => keys.has(key));
  const hasName = ["name", "subscription_name", "plan_name", "service_name"].some((key) => keys.has(key));
  return hasStatus && (hasAmount || hasName || hasInterval);
}

function subscriptionStatus(value: Record<string, unknown>): { value?: "active" | "canceled" | "cancelled" | "paused" | "inactive"; path?: string } {
  for (const path of ["status", "subscription_status", "state"]) {
    const normalized = normalizeStatus(value[path]);
    if (normalized) {
      return { value: normalized, path };
    }
  }
  if (value.active === true || value.is_active === true) {
    return { value: "active", path: value.active === true ? "active" : "is_active" };
  }
  return {};
}

function normalizeStatus(value: unknown): "active" | "canceled" | "cancelled" | "paused" | "inactive" | undefined {
  const text = stringValue(value)?.toLowerCase();
  if (!text) {
    return undefined;
  }
  if (text === "active") {
    return "active";
  }
  if (text === "canceled" || text === "cancelled") {
    return text;
  }
  if (text === "paused" || text === "pause") {
    return "paused";
  }
  if (["inactive", "deleted", "ended", "expired"].includes(text)) {
    return "inactive";
  }
  return undefined;
}

function subscriptionAmount(value: Record<string, unknown>): { value?: number; path?: string } {
  for (const path of ["amount", "monthly_amount", "monthly_price", "subscription_amount", "price", "total"]) {
    const amount = moneyValue(value[path]);
    if (amount !== undefined) {
      return { value: amount, path };
    }
  }
  return {};
}

function subscriptionInterval(value: Record<string, unknown>): { value?: "monthly" | "non_monthly"; path?: string } {
  for (const path of ["billing_interval", "billingInterval", "interval", "billing_frequency", "frequency"]) {
    const interval = normalizeInterval(value[path]);
    if (interval) {
      return { value: interval, path };
    }
  }
  return {};
}

function normalizeInterval(value: unknown): "monthly" | "non_monthly" | undefined {
  const text = stringValue(value)?.toLowerCase();
  if (!text) {
    return undefined;
  }
  if (text === "monthly" || text === "month" || text === "1 month" || text.includes("monthly")) {
    return "monthly";
  }
  return "non_monthly";
}

function subscriptionName(value: Record<string, unknown>): string | undefined {
  for (const path of ["name", "subscription_name", "plan_name", "service_name"]) {
    const text = stringValue(value[path]);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function moneyValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return roundMoney(value);
  }
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
    if (match) {
      return roundMoney(Number(match[1]));
    }
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parentPath(path: string): string {
  return path.replace(/\[\d+\]$/, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function pushUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
