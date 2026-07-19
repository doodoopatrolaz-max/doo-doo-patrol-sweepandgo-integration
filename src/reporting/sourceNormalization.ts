export type NormalizedCustomerSource = "facebook" | "website" | "other" | "unknown";

export function normalizeCustomerSource(value: unknown): NormalizedCustomerSource {
  if (typeof value !== "string" || !value.trim()) {
    return "unknown";
  }

  const normalized = value.toLowerCase();
  if (normalized.includes("facebook") || normalized.includes("instagram") || normalized.includes("fb") || normalized.includes("ig") || normalized.includes("meta")) {
    return "facebook";
  }

  if (normalized.includes("website") || normalized.includes("web") || normalized.includes("quote")) {
    return "website";
  }

  return "other";
}

export type SourceNormalizationResult = {
  normalizedSource: NormalizedCustomerSource;
  rawSource?: string;
  evidenceField?: string;
};

export function normalizeExplicitCustomerSource(record: unknown): SourceNormalizationResult {
  if (!record || typeof record !== "object") {
    return { normalizedSource: "unknown" };
  }

  const input = record as Record<string, unknown>;
  const candidates: Array<[string, unknown]> = [
    ["lead_source", input.lead_source],
    ["original_source", input.original_source],
    ["tracking_field", input.tracking_field],
    ["how_heard_answer", input.how_heard_answer],
    ["how_heard_about_us", input.how_heard_about_us],
    ["source", input.source],
    ["customer_source", input.customer_source],
    ["acquisition_source", input.acquisition_source]
  ];

  for (const [field, value] of candidates) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }

    const rawSource = value.trim();
    const normalized = normalizeExplicitSourceText(rawSource);
    if (normalized !== "unknown") {
      return {
        normalizedSource: normalized,
        rawSource,
        evidenceField: field
      };
    }
  }

  return { normalizedSource: "unknown" };
}

function normalizeExplicitSourceText(value: string): NormalizedCustomerSource {
  const normalized = value.toLowerCase();
  const params = parseTrackingParams(value);
  const utmSource = params.get("utm_source")?.toLowerCase();

  if (
    utmSource === "facebook" ||
    utmSource === "fb" ||
    utmSource === "instagram" ||
    utmSource === "ig" ||
    utmSource === "meta" ||
    normalized.includes("facebook") ||
    normalized.includes("instagram")
  ) {
    return "facebook";
  }

  if (
    utmSource === "website" ||
    utmSource === "web" ||
    normalized === "website" ||
    normalized === "web" ||
    normalized.includes("website")
  ) {
    return "website";
  }

  if (normalized === "unknown" || normalized === "not sure" || normalized === "n/a") {
    return "unknown";
  }

  return "other";
}

function parseTrackingParams(value: string): URLSearchParams {
  try {
    return new URLSearchParams(value.replace(/\s*&\s*/g, "&"));
  } catch {
    return new URLSearchParams();
  }
}
