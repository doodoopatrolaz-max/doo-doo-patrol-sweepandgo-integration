export type DashboardSourceBucket =
  | "website_paid"
  | "website_organic"
  | "facebook"
  | "referral"
  | "truck_wrap"
  | "other_unknown";

export type DashboardDetailedSourceBreakdown = Record<DashboardSourceBucket, number>;

export type DashboardSourceAttributionConfig = {
  googleSearchDefault: "website_organic" | "website_paid";
};

export type DashboardSourceAttributionResult = {
  bucket: DashboardSourceBucket;
  paidProof: boolean;
  googleSearchOnlyProof: boolean;
  referralProof: boolean;
  truckWrapProof: boolean;
};

export const DASHBOARD_SOURCE_BUCKETS: DashboardSourceBucket[] = [
  "website_paid",
  "website_organic",
  "facebook",
  "referral",
  "truck_wrap",
  "other_unknown"
];

export const DEFAULT_DASHBOARD_SOURCE_ATTRIBUTION_CONFIG: DashboardSourceAttributionConfig = {
  // Owner-approved rule: Search Engine + Google is reported as Website Paid for dashboard attribution.
  googleSearchDefault: "website_paid"
};

const PAID_UTM_MEDIUMS = new Set(["cpc", "ppc", "paid", "paid_search", "paid-search", "ads", "ad", "adwords", "google_ads", "google-ads"]);

export function emptyDetailedSourceBreakdown(): DashboardDetailedSourceBreakdown {
  return {
    website_paid: 0,
    website_organic: 0,
    facebook: 0,
    referral: 0,
    truck_wrap: 0,
    other_unknown: 0
  };
}

export function classifyDashboardSource(
  input: unknown,
  config: DashboardSourceAttributionConfig = DEFAULT_DASHBOARD_SOURCE_ATTRIBUTION_CONFIG
): DashboardSourceAttributionResult {
  const flattened = flattenEvidence(input);
  const text = flattened.map((entry) => entry.value.toLowerCase()).join(" ");
  const tags = flattened
    .filter((entry) => entry.path.toLowerCase().includes("tag"))
    .map((entry) => entry.value.trim().toLowerCase());
  const explicitSource = firstStringField(flattened, ["original_lead_source", "lead_source", "source", "customer_source", "acquisition_source"]);

  if (explicitSource === "facebook" || tags.includes("facebook lead") || /\b(facebook|instagram|meta)\b/.test(text)) {
    return sourceResult("facebook", flattened);
  }

  const paidProof = hasPaidProof(flattened);
  if (paidProof) {
    return sourceResult("website_paid", flattened, { paidProof: true });
  }

  const referralProof = /\b(referral|referred|referred by|friend|neighbor|word of mouth|word-of-mouth)\b/.test(text);
  if (referralProof) {
    return sourceResult("referral", flattened, { referralProof: true });
  }

  const truckWrapProof = /\b(truck wrap|truck|vehicle wrap|vehicle|saw truck|patrol truck|wrapped truck)\b/.test(text);
  if (truckWrapProof) {
    return sourceResult("truck_wrap", flattened, { truckWrapProof: true });
  }

  const googleSearchOnlyProof = hasGoogleSearchOnlyProof(flattened);
  if (googleSearchOnlyProof) {
    return sourceResult(config.googleSearchDefault, flattened, { googleSearchOnlyProof });
  }

  const websiteProof =
    explicitSource === "website" ||
    tags.includes("website lead") ||
    /\b(website|web site|web lead|quote form|website quote|direct signup|organic search|google organic)\b/.test(text) ||
    hasOrganicUtmProof(flattened);
  if (websiteProof) {
    return sourceResult("website_organic", flattened);
  }

  return sourceResult("other_unknown", flattened);
}

export function labelForDashboardSourceBucket(bucket: DashboardSourceBucket): string {
  switch (bucket) {
    case "website_paid":
      return "Website Paid";
    case "website_organic":
      return "Website Organic";
    case "facebook":
      return "Facebook";
    case "referral":
      return "Referral";
    case "truck_wrap":
      return "Truck Wrap";
    case "other_unknown":
      return "Other/Unknown";
  }
}

export function addToDetailedBreakdown(
  breakdown: DashboardDetailedSourceBreakdown,
  bucket: DashboardSourceBucket,
  count = 1
): void {
  breakdown[bucket] += count;
}

function sourceResult(
  bucket: DashboardSourceBucket,
  flattened: EvidenceEntry[],
  overrides: Partial<Omit<DashboardSourceAttributionResult, "bucket">> = {}
): DashboardSourceAttributionResult {
  return {
    bucket,
    paidProof: overrides.paidProof ?? hasPaidProof(flattened),
    googleSearchOnlyProof: overrides.googleSearchOnlyProof ?? hasGoogleSearchOnlyProof(flattened),
    referralProof: overrides.referralProof ?? false,
    truckWrapProof: overrides.truckWrapProof ?? false
  };
}

function hasPaidProof(flattened: EvidenceEntry[]): boolean {
  for (const entry of flattened) {
    const path = entry.path.toLowerCase();
    const value = entry.value.trim().toLowerCase();
    if ((path.endsWith("gclid") || path.endsWith("gbraid") || path.endsWith("wbraid")) && value) {
      return true;
    }
    if (path.endsWith("utm_medium") && PAID_UTM_MEDIUMS.has(value)) {
      return true;
    }
    if (path.endsWith("utm_source") && value === "google" && paidMediumExists(flattened)) {
      return true;
    }
    const params = parseParams(entry.value);
    const clickId = params.get("gclid") ?? params.get("gbraid") ?? params.get("wbraid");
    if (clickId) {
      return true;
    }
    const utmSource = params.get("utm_source")?.toLowerCase();
    const utmMedium = params.get("utm_medium")?.toLowerCase();
    if (utmSource === "google" && utmMedium && PAID_UTM_MEDIUMS.has(utmMedium)) {
      return true;
    }
    if (/\b(google ads|google ad|paid search|paid google|cpc|ppc|google cpc|google ppc)\b/.test(value)) {
      return true;
    }
  }
  return false;
}

function hasOrganicUtmProof(flattened: EvidenceEntry[]): boolean {
  return flattened.some((entry) => {
    const path = entry.path.toLowerCase();
    const value = entry.value.trim().toLowerCase();
    if (path.endsWith("utm_medium") && value === "organic") {
      return true;
    }
    const params = parseParams(entry.value);
    return params.get("utm_medium")?.toLowerCase() === "organic";
  });
}

function hasGoogleSearchOnlyProof(flattened: EvidenceEntry[]): boolean {
  const answer = firstStringField(flattened, ["how_heard_answer", "how_heard_about_us", "how_you_heard_about_us"]);
  const detail = firstStringField(flattened, ["how_heard_about_us_details", "how_heard_details", "source_detail", "source_details"]);
  const combined = flattened.map((entry) => entry.value.toLowerCase()).join(" ");
  return (
    Boolean(answer && /\b(search engine|search|google search)\b/.test(answer) && (!detail || /\bgoogle\b/.test(detail))) ||
    /\bsearch engine\b/.test(combined) && /\bgoogle\b/.test(combined)
  );
}

function paidMediumExists(flattened: EvidenceEntry[]): boolean {
  return flattened.some((entry) => entry.path.toLowerCase().endsWith("utm_medium") && PAID_UTM_MEDIUMS.has(entry.value.trim().toLowerCase()));
}

type EvidenceEntry = {
  path: string;
  value: string;
};

function flattenEvidence(value: unknown, path = "root", output: EvidenceEntry[] = []): EvidenceEntry[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const raw = String(value).trim();
    if (raw) {
      output.push({ path, value: raw });
    }
    return output;
  }
  if (!value || typeof value !== "object") {
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenEvidence(item, `${path}.${index}`, output));
    return output;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    flattenEvidence(nested, `${path}.${key}`, output);
  }
  return output;
}

function firstStringField(flattened: EvidenceEntry[], fieldNames: string[]): string | undefined {
  const wanted = new Set(fieldNames.map((field) => field.toLowerCase()));
  for (const entry of flattened) {
    const parts = entry.path.toLowerCase().split(".");
    const key = parts[parts.length - 1];
    if (wanted.has(key) && entry.value.trim()) {
      return entry.value.trim().toLowerCase();
    }
  }
  return undefined;
}

function parseParams(value: string): URLSearchParams {
  try {
    const query = value.includes("?") ? value.slice(value.indexOf("?") + 1) : value;
    return new URLSearchParams(query.replace(/\s*&\s*/g, "&"));
  } catch {
    return new URLSearchParams();
  }
}
