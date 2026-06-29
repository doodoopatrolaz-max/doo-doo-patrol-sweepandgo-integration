import type { DashboardDateRange } from "./dateRange.ts";

export type DashboardSummary = {
  range: DashboardDateRange;
  totalAdSpend: number;
  metaSpend: number;
  googleSpend: number;
  googleAdsStatus: DashboardAdProviderStatus;
  facebookLeads: number;
  websiteLeads: number;
  otherLeads: number;
  totalLeads: number;
  newRecurringCustomers: number;
  costPerLead: number | null;
  costPerNewRecurringCustomer: number | null;
  estimatedMrrAdded: number | null;
  cancellations: number;
  netRecurringCustomerGrowth: number;
  closeRate: number | null;
  closeRateMetrics: DashboardCloseRateMetrics;
  dataNotes: string[];
};

export type DashboardAdProviderStatus = {
  connected: boolean;
  latestStatus?: string;
  latestFailed: boolean;
  hasHistoricalPerformance: boolean;
  warning?: string;
};

export type DashboardCloseRateMetrics = {
  facebookMatchedConversions: number;
  websiteMatchedConversions: number;
  totalMatchedConversions: number;
  manualReviewConversions: number;
  facebookCloseRate: number | null;
  websiteCloseRate: number | null;
  totalCloseRate: number | null;
  costPerNewCustomerStatus: "unavailable_incomplete_spend_coverage";
};

export type DashboardTrendPoint = {
  date: string;
  metaSpend: number;
  googleSpend: number;
  totalSpend: number;
  facebookLeads: number;
  websiteLeads: number;
  totalLeads: number;
  newRecurringCustomers: number;
  costPerLead: number | null;
  costPerNewRecurringCustomer: number | null;
};

export type DashboardSourceRow = {
  source: "facebook" | "website" | "other" | "unknown";
  leads: number;
  newRecurringCustomers: number;
};

export type DashboardCampaignRow = {
  provider: string;
  campaignCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
};

export type DashboardSources = {
  leadSources: DashboardSourceRow[];
  campaignPerformance: DashboardCampaignRow[];
  unmatchedLeads: {
    count: number;
    note: string;
  };
  matchingStatus: string;
};

export type DashboardSyncHealthRow = {
  provider: string;
  latestStatus: string;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  recordsRead: number;
  recordsWritten: number;
  recentEvents: number;
  failedEvents: number;
  openReconciliationIssues: number;
  isStale: boolean;
  staleWarning?: string;
};

export type DashboardSyncHealth = {
  rows: DashboardSyncHealthRow[];
};

export type DashboardData = {
  summary: DashboardSummary;
  trends: DashboardTrendPoint[];
  sources: DashboardSources;
  syncHealth: DashboardSyncHealth;
};

export type DashboardDataSource = {
  getSummary(range: DashboardDateRange): Promise<DashboardSummary>;
  getTrends(range: DashboardDateRange): Promise<DashboardTrendPoint[]>;
  getSources(range: DashboardDateRange): Promise<DashboardSources>;
  getSyncHealth(range: DashboardDateRange): Promise<DashboardSyncHealth>;
};
