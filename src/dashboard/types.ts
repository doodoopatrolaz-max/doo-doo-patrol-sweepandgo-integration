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
  leadBreakdown: DashboardSourceBreakdown;
  totalLeads: number;
  totalActiveClients: number | null;
  totalActiveClientsSource: string;
  totalActiveClientsAsOf?: string;
  totalActiveClientsNeedsVerification: boolean;
  oneTimeCleanups: number;
  oneTimeCleanupsReason: string;
  newRecurringCustomers: number;
  newRecurringCustomerBreakdown: DashboardSourceBreakdown;
  costPerLead: number | null;
  costPerNewRecurringCustomer: number | null;
  costPerNewRecurringCustomerStatus: DashboardCostPerNewCustomerStatus;
  costPerNewRecurringCustomerNote: string;
  estimatedActiveMrr: number | null;
  estimatedActiveMrrReason?: string;
  averageMonthlyTicket: number | null;
  averageMonthlyTicketReason?: string;
  estimatedMrrAdded: number | null;
  cancellations: number;
  cancellationMetrics: DashboardCancellationMetrics;
  churnRate: number | null;
  churnRateDenominator: number;
  churnRateReason?: string;
  lifetimeValue: number | null;
  lifetimeValueReason?: string;
  averageRevenuePerHour: number | null;
  averageRevenuePerHourReason?: string;
  revenuePerHourMetrics: DashboardRevenuePerHourMetrics;
  averageRevenuePerShiftHour: number | null;
  averageRevenuePerShiftHourReason?: string;
  revenuePerShiftHourMetrics: DashboardRevenuePerShiftHourMetrics;
  priorPeriodLeadConversions: number;
  netRecurringCustomerGrowth: number;
  closeRate: number | null;
  closeRateMetrics: DashboardCloseRateMetrics;
  dataNotes: string[];
};

export type DashboardSourceBreakdown = {
  facebook: number;
  website: number;
  other: number;
  unknown: number;
};

export type DashboardCancellationMetrics = {
  countedCancellations: number;
  rawCancellationRows: number;
  uniqueCancellationCandidates: number;
  duplicateRowsExcluded: number;
  subscriptionOnlyActiveExcluded: number;
  pauseRowsExcluded: number;
  needsReview: number;
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
  facebookPriorPeriodLeadConversions: number;
  websitePriorPeriodLeadConversions: number;
  totalPriorPeriodLeadConversions: number;
  facebookCloseRate: number | null;
  websiteCloseRate: number | null;
  otherUnknownCloseRate: number | null;
  totalCloseRate: number | null;
  costPerNewCustomerStatus: DashboardCostPerNewCustomerStatus;
};

export type DashboardRevenuePerHourMetrics = {
  rawCompletedJobRows: number;
  eligibleRows: number;
  excludedRows: number;
  sameStopGroupsCreated: number;
  scoopSprayCombinedStopGroups: number;
  zeroDurationRows: number;
  zeroDurationRowsAttachedToValidStop: number;
  zeroDurationRowsExcluded: number;
  missingPriceRows: number;
  nonRecurringRowsExcluded: number;
  initialCleanupRowsExcluded: number;
  oneTimeCleanupRowsExcluded: number;
  customNonRecurringRowsExcluded: number;
  unknownClassificationRowsExcluded: number;
  nonRecurringServiceHoursExcluded: number;
  initialCleanupHoursExcluded: number;
  oneTimeCleanupHoursExcluded: number;
  customNonRecurringHoursExcluded: number;
  completedRecurringRevenue: number;
  skippedRecurringRevenue: number;
  skippedRecurringJobs: number;
  skippedRecurringMissingPriceRows: number;
  missedCanceledDispatchedRowsExcluded: number;
  serviceRevenue: number;
  serviceHours: number;
  completedJobs: number;
  completedStops: number;
  pricedCompletedJobs: number;
  timedCompletedJobs: number;
  zeroDurationRevenueJobs: number;
  scoopingRevenue: number;
  sprayRevenue: number;
  initialCleanupRevenue: number;
  revenuePerStop: number | null;
  averageMinutesPerStop: number | null;
  status: "available" | "unavailable";
  unavailableReason?: string;
};

export type DashboardRevenuePerShiftHourMetrics = {
  serviceRevenue: number;
  shiftHours: number;
  unadjustedShiftHours: number;
  initialCleanupHoursSubtracted: number;
  oneTimeCleanupHoursSubtracted: number;
  otherNonRecurringHoursSubtracted: number;
  rawShiftRows: number;
  dedupedShiftRows: number;
  duplicateShiftRowsExcluded: number;
  technicianShiftHours: Array<{
    technician: string;
    hours: number;
  }>;
  revenuePerShiftHour: number | null;
  status: "available" | "unavailable";
  unavailableReason?: string;
};

export type DashboardCostPerNewCustomerStatus = "available" | "no_ad_spend" | "no_new_customers" | "unavailable_incomplete_spend_coverage";

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
