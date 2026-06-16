export type MetaAdsAction = {
  action_type?: string;
  value?: string;
};

export type MetaAdsInsightsRow = {
  date_start?: string;
  date_stop?: string;
  account_id?: string;
  account_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  objective?: string;
  optimization_goal?: string;
  buying_type?: string;
  status?: string;
  effective_status?: string;
  actions?: MetaAdsAction[];
  cost_per_action_type?: MetaAdsAction[];
  [key: string]: unknown;
};

export type MetaAdsDailyPerformanceRecord = {
  platform: "meta";
  reportDate: string;
  externalAccountId: string;
  accountName?: string;
  accountTimezone?: string;
  currency?: string;
  externalCampaignId: string;
  campaignName?: string;
  externalAdsetId?: string;
  adsetName?: string;
  externalAdId?: string;
  adName?: string;
  spendAmount: string;
  impressions: number;
  reach: number;
  frequency?: string;
  clicks: number;
  linkClicks: number;
  landingPageViews: number;
  leads: number;
  costPerLead?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  objective?: string;
  optimizationGoal?: string;
  buyingType?: string;
  status?: string;
  effectiveStatus?: string;
  rawMetrics: Record<string, unknown>;
};

const LEAD_ACTION_TYPES = new Set([
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "onsite_conversion.messaging_conversation_started_7d"
]);

export function mapMetaAdsInsightsRow(
  row: MetaAdsInsightsRow,
  context: {
    accountTimezone?: string;
    currency?: string;
  } = {}
): MetaAdsDailyPerformanceRecord {
  return {
    platform: "meta",
    reportDate: requiredDate(row.date_start),
    externalAccountId: requiredString(row.account_id, "account_id"),
    accountName: optionalString(row.account_name),
    accountTimezone: context.accountTimezone,
    currency: context.currency,
    externalCampaignId: requiredString(row.campaign_id, "campaign_id"),
    campaignName: optionalString(row.campaign_name),
    externalAdsetId: optionalString(row.adset_id),
    adsetName: optionalString(row.adset_name),
    externalAdId: optionalString(row.ad_id),
    adName: optionalString(row.ad_name),
    spendAmount: decimalString(row.spend),
    impressions: integerValue(row.impressions),
    reach: integerValue(row.reach),
    frequency: decimalStringOrUndefined(row.frequency),
    clicks: integerValue(row.clicks),
    linkClicks: actionValue(row.actions, ["link_click"]),
    landingPageViews: actionValue(row.actions, ["landing_page_view"]),
    leads: actionValue(row.actions, [...LEAD_ACTION_TYPES]),
    costPerLead: costPerAction(row.cost_per_action_type, [...LEAD_ACTION_TYPES]),
    ctr: decimalStringOrUndefined(row.ctr),
    cpc: decimalStringOrUndefined(row.cpc),
    cpm: decimalStringOrUndefined(row.cpm),
    objective: optionalString(row.objective),
    optimizationGoal: optionalString(row.optimization_goal),
    buyingType: optionalString(row.buying_type),
    status: optionalString(row.status),
    effectiveStatus: optionalString(row.effective_status),
    rawMetrics: row
  };
}

export function metaInsightsFields(level: "campaign" | "adset" | "ad" = "campaign"): string[] {
  const fields = [
    "date_start",
    "date_stop",
    "account_id",
    "account_name",
    "campaign_id",
    "campaign_name",
    "spend",
    "impressions",
    "reach",
    "frequency",
    "clicks",
    "actions",
    "cost_per_action_type",
    "ctr",
    "cpc",
    "cpm",
    "objective",
    "buying_type"
  ];

  if (level === "adset" || level === "ad") {
    fields.push("adset_id", "adset_name");
  }
  if (level === "ad") {
    fields.push("ad_id", "ad_name");
  }

  return fields;
}

function requiredDate(value: unknown): string {
  const text = requiredString(value, "date_start");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error("Meta Ads date_start must be YYYY-MM-DD");
  }
  return text;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Meta Ads Insights row is missing ${field}`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function decimalString(value: unknown): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return "0.00";
  }
  return parsed.toFixed(2);
}

function decimalStringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : undefined;
}

function actionValue(actions: MetaAdsAction[] | undefined, actionTypes: string[]): number {
  if (!Array.isArray(actions)) {
    return 0;
  }
  const types = new Set(actionTypes);
  return actions.reduce((sum, action) => {
    if (!action.action_type || !types.has(action.action_type)) {
      return sum;
    }
    return sum + integerValue(action.value);
  }, 0);
}

function costPerAction(actions: MetaAdsAction[] | undefined, actionTypes: string[]): string | undefined {
  if (!Array.isArray(actions)) {
    return undefined;
  }
  const types = new Set(actionTypes);
  const match = actions.find((action) => action.action_type && types.has(action.action_type));
  return decimalStringOrUndefined(match?.value);
}
