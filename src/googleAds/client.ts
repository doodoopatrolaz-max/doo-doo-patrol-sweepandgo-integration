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
    const response = await this.fetchJson(`${this.options.apiBaseUrl}/${this.options.apiVersion}/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers: this.headers(accessToken),
      body: JSON.stringify({
        query: input.query,
        pageSize: Math.max(1, Math.floor(input.pageSize)),
        pageToken: input.pageToken
      })
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

      throw new Error(`Google Ads read request failed with HTTP ${response.status}`);
    }

    throw new Error("Google Ads read request failed");
  }
}

export function normalizeCustomerId(value: string): string {
  return value.trim().replace(/-/g, "");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
