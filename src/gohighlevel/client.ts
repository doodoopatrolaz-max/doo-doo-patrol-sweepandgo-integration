import type { AppConfig } from "../config.ts";

export type GoHighLevelClientOptions = {
  baseUrl: string;
  apiVersion: string;
  privateIntegrationToken: string;
};

export type GoHighLevelPipelineStage = {
  id?: string;
  name?: string;
  position?: number;
  [key: string]: unknown;
};

export type GoHighLevelPipeline = {
  id?: string;
  name?: string;
  stages?: GoHighLevelPipelineStage[];
  [key: string]: unknown;
};

export type GoHighLevelContact = {
  id?: string;
  tags?: unknown[];
  [key: string]: unknown;
};

export type SearchOpportunitiesInput = {
  locationId: string;
  pipelineId?: string;
  limit?: number;
  page?: number;
};

export class GoHighLevelClient {
  private readonly options: GoHighLevelClientOptions;

  constructor(options: GoHighLevelClientOptions) {
    this.options = options;
  }

  static fromConfig(config: AppConfig): GoHighLevelClient {
    if (!config.goHighLevelPrivateIntegrationToken) {
      throw new Error("GHL_PRIVATE_INTEGRATION_TOKEN is required");
    }

    return new GoHighLevelClient({
      baseUrl: config.goHighLevelApiBaseUrl,
      apiVersion: config.goHighLevelApiVersion,
      privateIntegrationToken: config.goHighLevelPrivateIntegrationToken
    });
  }

  async getPipelines(locationId: string): Promise<GoHighLevelPipeline[]> {
    const response = await this.readOnlyRequest(`/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`);
    const record = asRecord(response);
    const pipelines = Array.isArray(response)
      ? response
      : Array.isArray(record?.pipelines)
        ? record.pipelines
        : Array.isArray(record?.data)
          ? record.data
          : [];

    return pipelines.filter(isRecord) as GoHighLevelPipeline[];
  }

  async searchOpportunities(input: SearchOpportunitiesInput): Promise<unknown> {
    return await this.readOnlyRequest("/opportunities/search", {
      method: "POST",
      body: {
        locationId: input.locationId,
        pipelineId: input.pipelineId,
        limit: input.limit ?? 25,
        page: input.page ?? 1
      }
    });
  }

  async getContact(contactId: string): Promise<GoHighLevelContact> {
    const response = await this.readOnlyRequest(`/contacts/${encodeURIComponent(nonEmpty(contactId, "contactId"))}`);
    const record = asRecord(response);
    const contact = asRecord(record?.contact) ?? record;
    return (contact ?? {}) as GoHighLevelContact;
  }

  async addContactTags(contactId: string, tags: string[]): Promise<unknown> {
    const cleanedTags = tags.map((tag) => tag.trim()).filter(Boolean);
    if (cleanedTags.length === 0) {
      return { tags: [] };
    }

    return await this.writeRequest(`/contacts/${encodeURIComponent(nonEmpty(contactId, "contactId"))}/tags`, {
      method: "POST",
      body: {
        tags: cleanedTags
      }
    });
  }

  private async readOnlyRequest(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<unknown> {
    const method = init.method ?? "GET";
    if (method !== "GET" && method !== "POST") {
      throw new Error(`HighLevel client blocked non-read discovery method: ${method}`);
    }

    return await this.request(path, { ...init, method }, "read");
  }

  private async writeRequest(path: string, init: { method: "POST"; body?: unknown }): Promise<unknown> {
    if (init.method !== "POST" || !path.match(/^\/contacts\/[^/]+\/tags$/)) {
      throw new Error("HighLevel client blocked unsupported write request");
    }

    return await this.request(path, init, "write");
  }

  private async request(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown },
    mode: "read" | "write"
  ): Promise<unknown> {
    const method = init.method;
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.options.privateIntegrationToken}`,
          "Content-Type": "application/json",
          Version: this.options.apiVersion
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
      });

      if (response.ok) {
        const text = await response.text();
        return text ? JSON.parse(text) : {};
      }

      if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
        await sleep(250 * attempt);
        continue;
      }

      throw new Error(`HighLevel ${mode} request failed with HTTP ${response.status}`);
    }

    throw new Error(`HighLevel ${mode} request failed`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
