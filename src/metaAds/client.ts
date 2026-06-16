import type { AppConfig } from "../config.ts";
import { metaInsightsFields } from "./mapper.ts";

export type MetaAdsClientOptions = {
  accessToken: string;
  adAccountId: string;
  apiVersion: string;
  apiBaseUrl: string;
};

export type MetaAdAccountSummary = {
  account_id?: string;
  id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  timezone_id?: number;
  [key: string]: unknown;
};

export type MetaAdsInsightsInput = {
  since: string;
  until: string;
  level?: "campaign" | "adset" | "ad";
  limit?: number;
  maxPages?: number;
};

export class MetaAdsClient {
  private readonly options: MetaAdsClientOptions;

  constructor(options: MetaAdsClientOptions) {
    this.options = options;
  }

  static fromConfig(config: AppConfig): MetaAdsClient {
    if (!config.metaAccessToken) {
      throw new Error("META_ACCESS_TOKEN is required");
    }
    if (!config.metaAdAccountId) {
      throw new Error("META_AD_ACCOUNT_ID is required");
    }
    return new MetaAdsClient({
      accessToken: config.metaAccessToken,
      adAccountId: config.metaAdAccountId,
      apiVersion: config.metaApiVersion,
      apiBaseUrl: config.metaApiBaseUrl
    });
  }

  async getAdAccount(): Promise<MetaAdAccountSummary> {
    const fields = ["account_id", "id", "name", "currency", "timezone_name", "timezone_id"];
    return await this.readOnlyRequest(`/${this.normalizedAccountId()}`, {
      fields
    }) as MetaAdAccountSummary;
  }

  async getInsights(input: MetaAdsInsightsInput): Promise<unknown[]> {
    const level = input.level ?? "campaign";
    const path = `/${this.normalizedAccountId()}/insights`;
    const params: Record<string, string | number> = {
      fields: metaInsightsFields(level).join(","),
      level,
      time_increment: 1,
      limit: input.limit ?? 25,
      time_range: JSON.stringify({ since: input.since, until: input.until })
    };

    const rows: unknown[] = [];
    let pageUrl: string | undefined = this.buildUrl(path, params).toString();
    let pagesRead = 0;
    const maxPages = input.maxPages ?? 1;

    while (pageUrl && pagesRead < maxPages) {
      const response = await this.fetchJson(pageUrl);
      const record = asRecord(response);
      if (Array.isArray(record?.data)) {
        rows.push(...record.data);
      }

      const next = asRecord(record?.paging)?.next;
      pageUrl = typeof next === "string" ? next : undefined;
      pagesRead += 1;
    }

    return rows;
  }

  private async readOnlyRequest(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
    return await this.fetchJson(this.buildUrl(path, params).toString());
  }

  private buildUrl(path: string, params: Record<string, string | number | undefined>): URL {
    const url = new URL(`${this.options.apiBaseUrl}/${this.options.apiVersion}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.options.accessToken}`
        }
      });

      if (response.ok) {
        const text = await response.text();
        return text ? JSON.parse(text) : {};
      }

      if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }

      throw new Error(`Meta Ads read request failed with HTTP ${response.status}`);
    }

    throw new Error("Meta Ads read request failed");
  }

  private normalizedAccountId(): string {
    const trimmed = this.options.adAccountId.trim();
    return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
