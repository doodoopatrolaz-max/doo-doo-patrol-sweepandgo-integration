import type { AppConfig } from "../config.ts";
import { googleAdsAccountQuery, googleAdsCampaignPerformanceQuery, type GoogleAdsRow } from "./mapper.ts";

export type GoogleAdsClientOptions = {
  developerToken: string;
  customerId: string;
  loginCustomerId?: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  apiVersion: string;
  apiBaseUrl: string;
  oauthTokenUrl: string;
};

export type GoogleAdsSearchInput = {
  query: string;
  pageSize?: number;
  maxPages?: number;
};

export type GoogleAdsAccountSummary = {
  idPresent: boolean;
  descriptiveNamePresent: boolean;
  currencyCode?: string;
  timeZone?: string;
};

type SearchResponse = {
  results?: GoogleAdsRow[];
  nextPageToken?: string;
};

export class GoogleAdsClient {
  private readonly options: GoogleAdsClientOptions;
  private accessToken?: string;

  constructor(options: GoogleAdsClientOptions) {
    this.options = options;
  }

  static fromConfig(config: AppConfig): GoogleAdsClient {
    const required: Array<[keyof AppConfig, string]> = [
      ["googleAdsDeveloperToken", "GOOGLE_ADS_DEVELOPER_TOKEN"],
      ["googleAdsCustomerId", "GOOGLE_ADS_CUSTOMER_ID"],
      ["googleAdsClientId", "GOOGLE_ADS_CLIENT_ID"],
      ["googleAdsClientSecret", "GOOGLE_ADS_CLIENT_SECRET"],
      ["googleAdsRefreshToken", "GOOGLE_ADS_REFRESH_TOKEN"]
    ];

    for (const [key, variableName] of required) {
      if (!config[key]) {
        throw new Error(`${variableName} is required`);
      }
    }

    return new GoogleAdsClient({
      developerToken: config.googleAdsDeveloperToken!,
      customerId: config.googleAdsCustomerId!,
      loginCustomerId: config.googleAdsLoginCustomerId,
      clientId: config.googleAdsClientId!,
      clientSecret: config.googleAdsClientSecret!,
      refreshToken: config.googleAdsRefreshToken!,
      apiVersion: config.googleAdsApiVersion,
      apiBaseUrl: config.googleAdsApiBaseUrl,
      oauthTokenUrl: config.googleAdsOAuthTokenUrl
    });
  }

  async discoverAccount(): Promise<GoogleAdsAccountSummary> {
    const rows = await this.search({
      query: googleAdsAccountQuery(),
      pageSize: 1,
      maxPages: 1
    });
    const customer = rows[0]?.customer ?? {};
    return {
      idPresent: Boolean(customer.id),
      descriptiveNamePresent: Boolean(customer.descriptiveName),
      currencyCode: stringValue(customer.currencyCode),
      timeZone: stringValue(customer.timeZone)
    };
  }

  async getCampaignPerformance(input: { date: string; pageSize?: number; maxPages?: number }): Promise<GoogleAdsRow[]> {
    return await this.search({
      query: googleAdsCampaignPerformanceQuery({ date: input.date, limit: input.pageSize }),
      pageSize: input.pageSize,
      maxPages: input.maxPages
    });
  }

  async search(input: GoogleAdsSearchInput): Promise<GoogleAdsRow[]> {
    const rows: GoogleAdsRow[] = [];
    let pageToken: string | undefined;
    let pagesRead = 0;
    const maxPages = Math.max(1, Math.floor(input.maxPages ?? 1));

    while (pagesRead < maxPages) {
      const response = await this.searchPage({
        query: input.query,
        pageSize: input.pageSize ?? 25,
        pageToken
      });
      if (Array.isArray(response.results)) {
        rows.push(...response.results);
      }

      pagesRead += 1;
      pageToken = response.nextPageToken;
      if (!pageToken) {
        break;
      }
    }

    return rows;
  }

  private async searchPage(input: { query: string; pageSize: number; pageToken?: string }): Promise<SearchResponse> {
    const accessToken = await this.getAccessToken();
    const customerId = normalizeCustomerId(this.options.customerId);
    const body: Record<string, unknown> = {
      query: input.query,
      pageToken: input.pageToken
    };

    if (supportsSearchPageSize(this.options.apiVersion)) {
      body.pageSize = Math.max(1, Math.floor(input.pageSize));
    }

    const response = await this.fetchJson(`${this.options.apiBaseUrl}/${this.options.apiVersion}/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers: this.headers(accessToken),
      body: JSON.stringify(body)
    });
    return response as SearchResponse;
  }

  private headers(accessToken: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "developer-token": this.options.developerToken
    };

    if (this.options.loginCustomerId) {
      headers["login-customer-id"] = normalizeCustomerId(this.options.loginCustomerId);
    }

    return headers;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      refresh_token: this.options.refreshToken
    });

    const response = await this.fetchJson(this.options.oauthTokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    }, false) as Record<string, unknown>;

    if (typeof response.access_token !== "string" || !response.access_token) {
      throw new Error("Google Ads OAuth token refresh did not return an access token");
    }

    this.accessToken = response.access_token;
    return this.accessToken;
  }

  private async fetchJson(url: string, init: RequestInit, retryable = true): Promise<unknown> {
    const maxAttempts = retryable ? 3 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(url, init);
      if (response.ok) {
        const text = await response.text();
        return text ? JSON.parse(text) : {};
      }

      if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }

      const errorText = await response.text().catch(() => "");
      throw new Error(formatGoogleAdsHttpError(response.status, errorText));
    }

    throw new Error("Google Ads read request failed");
  }
}

export function normalizeCustomerId(value: string): string {
  return value.trim().replace(/-/g, "");
}

export function supportsSearchPageSize(apiVersion: string): boolean {
  const major = Number(apiVersion.trim().replace(/^v/i, "").split(".")[0]);
  return !Number.isFinite(major) || major < 24;
}

export function formatGoogleAdsHttpError(status: number, bodyText: string): string {
  const details = summarizeGoogleAdsError(bodyText);
  return details
    ? `Google Ads read request failed with HTTP ${status}: ${details}`
    : `Google Ads read request failed with HTTP ${status}`;
}

function summarizeGoogleAdsError(bodyText: string): string | undefined {
  if (!bodyText.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return sanitizeGoogleAdsErrorText(bodyText).slice(0, 500);
  }

  const parts: string[] = [];
  if (isRecord(parsed)) {
    const topLevelError = parsed.error;
    if (typeof topLevelError === "string") {
      parts.push(`error=${sanitizeGoogleAdsErrorText(topLevelError)}`);
    }
    if (typeof parsed.error_description === "string") {
      parts.push(`description=${sanitizeGoogleAdsErrorText(parsed.error_description)}`);
    }

    if (isRecord(topLevelError)) {
      const code = typeof topLevelError.code === "number" ? topLevelError.code : undefined;
      const status = typeof topLevelError.status === "string" ? topLevelError.status : undefined;
      const message = typeof topLevelError.message === "string" ? topLevelError.message : undefined;
      if (code !== undefined) {
        parts.push(`code=${code}`);
      }
      if (status) {
        parts.push(`status=${sanitizeGoogleAdsErrorText(status)}`);
      }
      if (message) {
        parts.push(`message=${sanitizeGoogleAdsErrorText(message)}`);
      }
      parts.push(...googleAdsFailureDetails(topLevelError.details));
    }
  }

  return parts.length ? parts.join("; ").slice(0, 1000) : sanitizeGoogleAdsErrorText(bodyText).slice(0, 500);
}

function googleAdsFailureDetails(details: unknown): string[] {
  if (!Array.isArray(details)) {
    return [];
  }

  const parts: string[] = [];
  for (const detail of details) {
    if (!isRecord(detail) || !Array.isArray(detail.errors)) {
      continue;
    }
    for (const error of detail.errors) {
      if (!isRecord(error)) {
        continue;
      }
      const errorCode = isRecord(error.errorCode)
        ? Object.entries(error.errorCode)
            .map(([key, value]) => `${key}=${sanitizeGoogleAdsErrorText(String(value))}`)
            .join(",")
        : undefined;
      const message = typeof error.message === "string" ? sanitizeGoogleAdsErrorText(error.message) : undefined;
      if (errorCode || message) {
        parts.push(`googleAdsError=${[errorCode, message].filter(Boolean).join(": ")}`);
      }
    }
  }
  return parts;
}

function sanitizeGoogleAdsErrorText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/(access[_-]?token|refresh[_-]?token|client[_-]?secret|developer[_-]?token)\s*[:=]\s*[^,}\s]+/gi, "$1=[REDACTED]")
    .replace(/customers\/[0-9-]+/gi, "customers/[REDACTED]")
    .replace(/customer[_ -]?id\s*[:=]\s*['\"]?[0-9-]+['\"]?/gi, "customer_id=[REDACTED]")
    .replace(/login[_ -]?customer[_ -]?id\s*[:=]\s*['\"]?[0-9-]+['\"]?/gi, "login_customer_id=[REDACTED]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL_REDACTED]")
    .replace(/\b\d{3}[-.) ]?\d{3}[-. ]?\d{4}\b/g, "[PHONE_REDACTED]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
