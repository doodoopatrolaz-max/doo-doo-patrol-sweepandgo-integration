export type LeadSource = "facebook" | "website";

export type LeadCandidate = {
  biOpportunityId?: string;
  externalOpportunityId?: string;
  contactExternalId?: string;
  originalLeadSource: LeadSource | "other" | "unknown";
  originalLeadDate?: string;
  email?: string;
  phone?: string;
};

export type ActiveClientOpportunityCandidate = {
  externalOpportunityId?: string;
  contactExternalId?: string;
  stageName?: string;
  createdAt?: string;
  updatedAt?: string;
  email?: string;
  phone?: string;
};

export type SpendCoverageRow = {
  platform: string;
  days: number;
  spend: number;
};

export type ConversionMatch = {
  lead: LeadCandidate;
  activeOpportunity: ActiveClientOpportunityCandidate;
  matchMethod: "contact_id" | "same_opportunity_id" | "email" | "phone";
  conversionDate?: string;
};

export type ConversionMatchDryRunResult = {
  leadCounts: {
    facebookLeads: number;
    websiteLeads: number;
    totalLeads: number;
  };
  activeOpportunityCounts: {
    checked: number;
    recurringEligible: number;
    oneTimePausedCanceledExcluded: number;
    unknownStageExcluded: number;
  };
  matchCounts: {
    byContactId: number;
    bySameOpportunityId: number;
    byEmail: number;
    byPhone: number;
    facebookConversions: number;
    websiteConversions: number;
    unknownSourceConversions: number;
    manualReviewCount: number;
    duplicateOrAmbiguousCount: number;
    unmatchedRecurringEligible: number;
    dateRuleRejected: number;
  };
  closeRates: {
    facebookCloseRatePercent: number | null;
    websiteCloseRatePercent: number | null;
    totalCloseRatePercent: number | null;
  };
  spendCoverage: {
    meta: PlatformSpendCoverage;
    google: PlatformSpendCoverage;
    costPerNewCustomerStatus: "available" | "unavailable_incomplete_spend_coverage";
  };
  matches: ConversionMatch[];
  dataWarnings: string[];
};

type PlatformSpendCoverage = {
  daysWithSpendRows: number;
  spend: number;
  coverageSafe: boolean;
  costPerConvertedCustomer: number | null;
};

type IndexedLeads = {
  byOpportunity: UniqueIndex<LeadCandidate>;
  byContact: UniqueIndex<LeadCandidate>;
  byEmail: UniqueIndex<LeadCandidate>;
  byPhone: UniqueIndex<LeadCandidate>;
};

type UniqueIndex<T> = {
  map: Map<string, T>;
  ambiguous: Set<string>;
};

const RECURRING_ACTIVE_STAGE_NAMES = new Set([
  "weekly reoccurring customers",
  "2x weekly reoccurring customers",
  "3x weekly reoccurring customers",
  "bi-weekly reoccurring customers",
  "monthly reoccurring customers"
]);

const EXCLUDED_ACTIVE_STAGE_NAMES = new Set([
  "one time clean up",
  "paused service",
  "cancelation",
  "cancellation"
]);

export function createConversionMatchDryRun(input: {
  leads: LeadCandidate[];
  activeOpportunities: ActiveClientOpportunityCandidate[];
  spendRows?: SpendCoverageRow[];
  rangeStart: string;
  rangeEnd: string;
}): ConversionMatchDryRunResult {
  const rangeDays = inclusiveDateCount(input.rangeStart, input.rangeEnd);
  const leads = input.leads.filter(isCountableLead);
  const eligibleLeads = leads.filter((lead) => isInsideRange(lead.originalLeadDate, input.rangeStart, input.rangeEnd));
  const activeCounts = classifyActiveOpportunities(input.activeOpportunities);
  const indexedLeads = indexLeads(eligibleLeads);
  const matchedLeadKeys = new Set<string>();
  const matchedActiveKeys = new Set<string>();
  const matches: ConversionMatch[] = [];
  const matchCounts = {
    byContactId: 0,
    bySameOpportunityId: 0,
    byEmail: 0,
    byPhone: 0,
    facebookConversions: 0,
    websiteConversions: 0,
    unknownSourceConversions: 0,
    manualReviewCount: 0,
    duplicateOrAmbiguousCount: 0,
    unmatchedRecurringEligible: 0,
    dateRuleRejected: 0
  };

  for (const active of activeCounts.recurringEligible) {
    const match = findMatch(active, indexedLeads);
    if (match.status === "ambiguous") {
      matchCounts.duplicateOrAmbiguousCount += 1;
      matchCounts.manualReviewCount += 1;
      continue;
    }
    if (match.status === "none") {
      matchCounts.unmatchedRecurringEligible += 1;
      continue;
    }

    const leadKey = stableLeadKey(match.lead);
    const activeKey = stableActiveKey(active);
    if (!leadKey || !activeKey || matchedLeadKeys.has(leadKey) || matchedActiveKeys.has(activeKey)) {
      matchCounts.duplicateOrAmbiguousCount += 1;
      matchCounts.manualReviewCount += 1;
      continue;
    }

    const conversionDate = active.updatedAt ?? active.createdAt;
    if (conversionDate && match.lead.originalLeadDate && new Date(conversionDate) < new Date(match.lead.originalLeadDate)) {
      matchCounts.dateRuleRejected += 1;
      matchCounts.manualReviewCount += 1;
      continue;
    }

    matchedLeadKeys.add(leadKey);
    matchedActiveKeys.add(activeKey);
    incrementMatchMethod(matchCounts, match.method);
    if (match.lead.originalLeadSource === "facebook") {
      matchCounts.facebookConversions += 1;
    } else if (match.lead.originalLeadSource === "website") {
      matchCounts.websiteConversions += 1;
    } else {
      matchCounts.unknownSourceConversions += 1;
    }
    matches.push({
      lead: match.lead,
      activeOpportunity: active,
      matchMethod: match.method,
      conversionDate
    });
  }

  const facebookLeads = eligibleLeads.filter((lead) => lead.originalLeadSource === "facebook").length;
  const websiteLeads = eligibleLeads.filter((lead) => lead.originalLeadSource === "website").length;
  const spendCoverage = summarizeSpendCoverage({
    rows: input.spendRows ?? [],
    rangeDays,
    facebookConversions: matchCounts.facebookConversions,
    websiteConversions: matchCounts.websiteConversions
  });
  const dataWarnings = buildDataWarnings({
    spendCoverage,
    unmatchedRecurringEligible: matchCounts.unmatchedRecurringEligible,
    duplicateOrAmbiguousCount: matchCounts.duplicateOrAmbiguousCount,
    unknownStageExcluded: activeCounts.unknownStageExcluded.length
  });

  return {
    leadCounts: {
      facebookLeads,
      websiteLeads,
      totalLeads: facebookLeads + websiteLeads
    },
    activeOpportunityCounts: {
      checked: input.activeOpportunities.length,
      recurringEligible: activeCounts.recurringEligible.length,
      oneTimePausedCanceledExcluded: activeCounts.oneTimePausedCanceledExcluded.length,
      unknownStageExcluded: activeCounts.unknownStageExcluded.length
    },
    matchCounts,
    closeRates: {
      facebookCloseRatePercent: pct(matchCounts.facebookConversions, facebookLeads),
      websiteCloseRatePercent: pct(matchCounts.websiteConversions, websiteLeads),
      totalCloseRatePercent: pct(matchCounts.facebookConversions + matchCounts.websiteConversions, facebookLeads + websiteLeads)
    },
    spendCoverage,
    matches,
    dataWarnings
  };
}

export function isRecurringActiveClientStage(stageName: string | undefined): boolean {
  return RECURRING_ACTIVE_STAGE_NAMES.has(normalizeStageName(stageName));
}

export function isExcludedActiveClientStage(stageName: string | undefined): boolean {
  return EXCLUDED_ACTIVE_STAGE_NAMES.has(normalizeStageName(stageName));
}

export function normalizeEmail(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

export function normalizePhone(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 ? digits : undefined;
}

function classifyActiveOpportunities(activeOpportunities: ActiveClientOpportunityCandidate[]) {
  const recurringEligible: ActiveClientOpportunityCandidate[] = [];
  const oneTimePausedCanceledExcluded: ActiveClientOpportunityCandidate[] = [];
  const unknownStageExcluded: ActiveClientOpportunityCandidate[] = [];

  for (const active of activeOpportunities) {
    if (isRecurringActiveClientStage(active.stageName)) {
      recurringEligible.push(active);
    } else if (isExcludedActiveClientStage(active.stageName)) {
      oneTimePausedCanceledExcluded.push(active);
    } else {
      unknownStageExcluded.push(active);
    }
  }

  return { recurringEligible, oneTimePausedCanceledExcluded, unknownStageExcluded };
}

function indexLeads(leads: LeadCandidate[]): IndexedLeads {
  return {
    byOpportunity: indexUnique(leads, (lead) => lead.externalOpportunityId),
    byContact: indexUnique(leads, (lead) => lead.contactExternalId),
    byEmail: indexUnique(leads, (lead) => normalizeEmail(lead.email)),
    byPhone: indexUnique(leads, (lead) => normalizePhone(lead.phone))
  };
}

function findMatch(
  active: ActiveClientOpportunityCandidate,
  indexedLeads: IndexedLeads
):
  | { status: "matched"; lead: LeadCandidate; method: ConversionMatch["matchMethod"] }
  | { status: "ambiguous" }
  | { status: "none" } {
  const priority = [
    { key: active.contactExternalId, index: indexedLeads.byContact, method: "contact_id" as const },
    { key: active.externalOpportunityId, index: indexedLeads.byOpportunity, method: "same_opportunity_id" as const },
    { key: normalizeEmail(active.email), index: indexedLeads.byEmail, method: "email" as const },
    { key: normalizePhone(active.phone), index: indexedLeads.byPhone, method: "phone" as const }
  ];

  for (const item of priority) {
    if (!item.key) continue;
    if (item.index.ambiguous.has(item.key)) {
      return { status: "ambiguous" };
    }
    const lead = item.index.map.get(item.key);
    if (lead) {
      return { status: "matched", lead, method: item.method };
    }
  }

  return { status: "none" };
}

function indexUnique<T>(items: T[], keyFn: (item: T) => string | undefined): UniqueIndex<T> {
  const map = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (map.has(key)) {
      ambiguous.add(key);
    } else {
      map.set(key, item);
    }
  }
  for (const key of ambiguous) {
    map.delete(key);
  }
  return { map, ambiguous };
}

function isCountableLead(lead: LeadCandidate): boolean {
  return lead.originalLeadSource === "facebook" || lead.originalLeadSource === "website";
}

function isInsideRange(value: string | undefined, start: string, end: string): boolean {
  if (!value) return false;
  const date = value.slice(0, 10);
  return date >= start && date <= end;
}

function stableLeadKey(lead: LeadCandidate): string | undefined {
  return lead.biOpportunityId ?? lead.externalOpportunityId;
}

function stableActiveKey(active: ActiveClientOpportunityCandidate): string | undefined {
  return active.externalOpportunityId;
}

function incrementMatchMethod(
  counts: ConversionMatchDryRunResult["matchCounts"],
  method: ConversionMatch["matchMethod"]
) {
  if (method === "contact_id") counts.byContactId += 1;
  if (method === "same_opportunity_id") counts.bySameOpportunityId += 1;
  if (method === "email") counts.byEmail += 1;
  if (method === "phone") counts.byPhone += 1;
}

function summarizeSpendCoverage(input: {
  rows: SpendCoverageRow[];
  rangeDays: number;
  facebookConversions: number;
  websiteConversions: number;
}): ConversionMatchDryRunResult["spendCoverage"] {
  const meta = summarizePlatform(input.rows, ["meta"], input.rangeDays, input.facebookConversions);
  const google = summarizePlatform(input.rows, ["google", "google_ads"], input.rangeDays, input.websiteConversions);
  return {
    meta,
    google,
    costPerNewCustomerStatus: meta.coverageSafe && google.coverageSafe
      ? "available"
      : "unavailable_incomplete_spend_coverage"
  };
}

function summarizePlatform(
  rows: SpendCoverageRow[],
  platforms: string[],
  rangeDays: number,
  conversions: number
): PlatformSpendCoverage {
  const relevantRows = rows.filter((row) => platforms.includes(row.platform));
  const daysWithSpendRows = relevantRows.reduce((total, row) => total + row.days, 0);
  const spend = roundMoney(relevantRows.reduce((total, row) => total + row.spend, 0));
  const coverageSafe = rangeDays > 0 && daysWithSpendRows >= rangeDays;
  return {
    daysWithSpendRows,
    spend,
    coverageSafe,
    costPerConvertedCustomer: coverageSafe && conversions > 0 ? roundMoney(spend / conversions) : null
  };
}

function buildDataWarnings(input: {
  spendCoverage: ConversionMatchDryRunResult["spendCoverage"];
  unmatchedRecurringEligible: number;
  duplicateOrAmbiguousCount: number;
  unknownStageExcluded: number;
}): string[] {
  const warnings: string[] = [];
  if (!input.spendCoverage.meta.coverageSafe) {
    warnings.push("Meta spend coverage is incomplete for this range, so Facebook cost per new customer is unavailable.");
  }
  if (!input.spendCoverage.google.coverageSafe) {
    warnings.push("Google spend coverage is incomplete for this range, so Website cost per new customer is unavailable.");
  }
  if (input.unmatchedRecurringEligible > 0) {
    warnings.push("Some recurring active-client opportunities did not match a Facebook/Website lead by approved stable identifiers.");
  }
  if (input.duplicateOrAmbiguousCount > 0) {
    warnings.push("Some possible conversion matches were duplicate or ambiguous and require manual review.");
  }
  if (input.unknownStageExcluded > 0) {
    warnings.push("Some active-client opportunities were in unrecognized stages and were excluded from recurring conversion counts.");
  }
  return warnings;
}

function normalizeStageName(value: string | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function pct(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : null;
}

function inclusiveDateCount(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 0;
  }
  return Math.floor((endMs - startMs) / 86400000) + 1;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
