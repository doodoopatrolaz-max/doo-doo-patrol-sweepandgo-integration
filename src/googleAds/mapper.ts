export type GoogleAdsCustomer = {
  id?: string | number;
  descriptiveName?: string;
  currencyCode?: string;
  timeZone?: string;
};

export type GoogleAdsCampaign = {
  id?: string | number;
  name?: string;
  status?: string;
  advertisingChannelType?: string;
};

export type GoogleAdsMetrics = {
  costMicros?: string | number;
  impressions?: string | number;
  clicks?: string | number;
  conversions?: string | number;
  allConversions?: string | number;
  conversionsValue?: string | number;
  ctr?: string | number;
  averageCpc?: string | number;
  costPerConversion?: string | number;
  phoneCalls?: string | number;
  searchImpressionShare?: string | number;
};

export type GoogleAdsSegments = {
  date?: string;
};

export type GoogleAdsRow = {
  customer?: GoogleAdsCustomer;
  campaign?: GoogleAdsCampaign;
  metrics?: GoogleAdsMetrics;
  segments?: GoogleAdsSegments;
  [key: string]: unknown;
};

export type GoogleAdsDailyPerformanceRecord = {
  platform: "google_ads";
  reportDate: string;
  externalAccountId: string;
  accountName?: string;
  accountTimezone?: string;
  currency?: string;
  externalCampaignId: string;
  campaignName?: string;
  campaignStatus?: string;
  advertisingChannelType?: string;
  costMicros: number;
  spendAmount: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsDecimal: string;
  allConversions?: string;
  conversionValue?: string;
  ctr?: string;
  averageCpc?: string;
  costPerConversion?: string;
  phoneCalls?: string;
  searchImpressionShare?: string;
  rawMetrics: Record<string, unknown>;
};

export function mapGoogleAdsCampaignRow(row: GoogleAdsRow): GoogleAdsDailyPerformanceRecord {
  const metrics = row.metrics ?? {};
  const campaign = row.campaign ?? {};
  const customer = row.customer ?? {};
  const costMicros = integerValue(metrics.costMicros);

  return {
    platform: "google_ads",
    reportDate: requiredDate(row.segments?.date),
    externalAccountId: requiredId(customer.id, "customer.id"),
    accountName: optionalString(customer.descriptiveName),
    accountTimezone: optionalString(customer.timeZone),
    currency: optionalString(customer.currencyCode),
    externalCampaignId: requiredId(campaign.id, "campaign.id"),
    campaignName: optionalString(campaign.name),
    campaignStatus: optionalString(campaign.status),
    advertisingChannelType: optionalString(campaign.advertisingChannelType),
    costMicros,
    spendAmount: microsToDollars(costMicros),
    impressions: integerValue(metrics.impressions),
    clicks: integerValue(metrics.clicks),
    conversions: Math.floor(numberValue(metrics.conversions)),
    conversionsDecimal: decimalString(metrics.conversions),
    allConversions: decimalStringOrUndefined(metrics.allConversions),
    conversionValue: decimalStringOrUndefined(metrics.conversionsValue),
    ctr: decimalStringOrUndefined(metrics.ctr),
    averageCpc: microsToDollarsOrUndefined(metrics.averageCpc),
    costPerConversion: microsToDollarsOrUndefined(metrics.costPerConversion),
    phoneCalls: decimalStringOrUndefined(metrics.phoneCalls),
    searchImpressionShare: decimalStringOrUndefined(metrics.searchImpressionShare),
    rawMetrics: row
  };
}

export function googleAdsAccountQuery(): string {
  return [
    "SELECT",
    "  customer.id,",
    "  customer.descriptive_name,",
    "  customer.currency_code,",
    "  customer.time_zone",
    "FROM customer",
    "LIMIT 1"
  ].join("\n");
}

export function googleAdsCampaignPerformanceQuery(input: { date: string; limit?: number }): string {
  requiredDate(input.date);
  const limit = Math.max(1, Math.floor(input.limit ?? 25));
  return [
    "SELECT",
    "  segments.date,",
    "  customer.id,",
    "  customer.descriptive_name,",
    "  customer.currency_code,",
    "  customer.time_zone,",
    "  campaign.id,",
    "  campaign.name,",
    "  campaign.status,",
    "  campaign.advertising_channel_type,",
    "  metrics.cost_micros,",
    "  metrics.impressions,",
    "  metrics.clicks,",
    "  metrics.conversions,",
    "  metrics.all_conversions,",
    "  metrics.conversions_value,",
    "  metrics.ctr,",
    "  metrics.average_cpc,",
    "  metrics.cost_per_conversion,",
    "  metrics.phone_calls,",
    "  metrics.search_impression_share",
    "FROM campaign",
    `WHERE segments.date = '${input.date}'`,
    "ORDER BY campaign.id",
    `LIMIT ${limit}`
  ].join("\n");
}

function requiredDate(value: unknown): string {
  const text = requiredString(value, "segments.date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error("Google Ads date must be YYYY-MM-DD");
  }
  return text;
}

function requiredId(value: unknown, field: string): string {
  const text = requiredString(value, field).replace(/-/g, "");
  if (!text) {
    throw new Error(`Google Ads row is missing ${field}`);
  }
  return text;
}

function requiredString(value: unknown, field: string): string {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
    throw new Error(`Google Ads row is missing ${field}`);
  }
  return String(value).trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerValue(value: unknown): number {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function decimalString(value: unknown): string {
  return numberValue(value).toFixed(6);
}

function decimalStringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return decimalString(value);
}

function microsToDollars(value: unknown): string {
  return (numberValue(value) / 1_000_000).toFixed(2);
}

function microsToDollarsOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return microsToDollars(value);
}
