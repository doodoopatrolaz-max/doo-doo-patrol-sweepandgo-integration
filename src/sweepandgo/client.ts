import type { AppConfig } from "../config.ts";
import { sanitizeForLogs } from "../logger.ts";

type QueryParams = Record<string, string | number | boolean | undefined>;
type HttpMethod = "GET" | "POST" | "PUT";

export type PaginatedResponse<T = unknown> = {
  data: T[];
  paginate?: {
    total?: number;
    count?: number;
    per_page?: number;
    current_page?: number;
    total_pages?: number;
  };
  pagesFetched?: number;
};

export class SweepAndGoApiError extends Error {
  readonly status: number;
  readonly responseBody: unknown;

  constructor(
    message: string,
    status: number,
    responseBody: unknown
  ) {
    super(message);
    this.name = "SweepAndGoApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class SweepAndGoClient {
  private readonly config: Pick<AppConfig, "sweepgoApiToken" | "sweepgoBaseUrl">;
  private readonly retryOptions = {
    attempts: 3,
    baseDelayMs: 500
  };

  constructor(config: Pick<AppConfig, "sweepgoApiToken" | "sweepgoBaseUrl">) {
    this.config = config;
  }

  async healthCheck(): Promise<unknown> {
    return this.request("GET", "/api/health", {}, undefined, false);
  }

  async getActiveClients(options: PaginationOptions = {}): Promise<unknown> {
    return this.getPaginated("/api/v1/clients/active", options);
  }

  async getActiveClientsWithoutSubscription(options: PaginationOptions = {}): Promise<unknown> {
    return this.getPaginated("/api/v1/clients/active_no_subscription", options);
  }

  async getInactiveClients(options: PaginationOptions = {}): Promise<unknown> {
    return this.getPaginated("/api/v1/clients/inactive", options);
  }

  async searchClientByEmail(input: {
    email: string;
    status?: "active" | "inactive";
    latest?: boolean;
  }): Promise<unknown> {
    return this.request("POST", "/api/v2/clients/client_search", {}, input);
  }

  async getClientDetailsAndPayments(client: string): Promise<unknown> {
    return this.request("POST", "/api/v2/clients/client_details", {}, { client });
  }

  async getLeads(options: PaginationOptions = {}): Promise<unknown> {
    return this.getPaginated("/api/v1/leads/list", options);
  }

  async getOutOfAreaLeads(options: PaginationOptions = {}): Promise<unknown> {
    return this.getPaginated("/api/v1/leads/out_of_service", options);
  }

  async getDispatchJobs(date: string): Promise<unknown> {
    return this.request("GET", "/api/v1/dispatch_board/jobs_for_date", { date });
  }

  async countDogs(): Promise<unknown> {
    return this.request("GET", "/api/v2/report/count_happy_dogs");
  }

  async countHappyClients(): Promise<unknown> {
    return this.request("GET", "/api/v2/report/count_happy_clients");
  }

  async countActiveClients(): Promise<unknown> {
    return this.request("GET", "/api/v2/report/count_active_clients");
  }

  async countCompletedJobs(): Promise<unknown> {
    return this.request("GET", "/api/v2/report/jobs_count");
  }

  async listActiveStaff(): Promise<unknown> {
    return this.request("GET", "/api/v2/report/staff_select_list");
  }

  async listReceivedWebhooks(options: PaginationOptions = {}): Promise<unknown> {
    return this.getPaginated("/api/v1/webhooks/list", options);
  }

  async retryWebhook(id: string): Promise<unknown> {
    return this.request("PUT", "/api/v1/webhooks/retry", {}, { id });
  }

  private async getPaginated<T>(path: string, options: PaginationOptions): Promise<PaginatedResponse<T> | unknown> {
    if (!options.allPages) {
      return this.request("GET", path, { page: options.page ?? 1 });
    }

    const maxPages = options.maxPages ?? 25;
    const combined: T[] = [];
    let page = options.page ?? 1;
    let lastPaginate: PaginatedResponse<T>["paginate"];
    let pagesFetched = 0;

    while (pagesFetched < maxPages) {
      const response = await this.request("GET", path, { page }) as PaginatedResponse<T>;
      if (!Array.isArray(response.data)) {
        return response;
      }

      combined.push(...response.data);
      lastPaginate = response.paginate;
      pagesFetched += 1;

      const totalPages = Number(response.paginate?.total_pages ?? page);
      if (page >= totalPages) {
        break;
      }

      page += 1;
    }

    return {
      data: combined,
      paginate: lastPaginate,
      pagesFetched
    };
  }

  private async request(
    method: HttpMethod,
    path: string,
    query: QueryParams = {},
    body?: unknown,
    requiresAuth = true
  ): Promise<unknown> {
    if (requiresAuth && !this.config.sweepgoApiToken) {
      throw new Error("SWEEPGO_API_TOKEN is not configured yet");
    }

    const url = new URL(path, this.config.sweepgoBaseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: HeadersInit = {
      Accept: "application/json"
    };

    if (requiresAuth) {
      headers.Authorization = `Bearer ${this.config.sweepgoApiToken}`;
    }

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response | undefined;
    let responseBody: unknown;

    for (let attempt = 1; attempt <= this.retryOptions.attempts; attempt += 1) {
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await response.text();
        responseBody = text ? parseJson(text) : undefined;

        if (!isRetryableStatus(response.status) || attempt === this.retryOptions.attempts) {
          break;
        }
      } catch (error) {
        if (attempt === this.retryOptions.attempts) {
          throw error;
        }
      }

      await sleep(this.retryOptions.baseDelayMs * attempt);
    }

    if (!response) {
      throw new Error("Sweep&Go API request failed before receiving a response");
    }

    if (!response.ok) {
      throw new SweepAndGoApiError(
        `Sweep&Go API request failed with HTTP ${response.status}`,
        response.status,
        sanitizeForLogs(responseBody)
      );
    }

    return responseBody;
  }
}

export type PaginationOptions = {
  page?: number;
  allPages?: boolean;
  maxPages?: number;
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
