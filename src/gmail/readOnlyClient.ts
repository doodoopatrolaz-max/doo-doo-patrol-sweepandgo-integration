import type { AppConfig } from "../config.ts";
import type { SweepAndGoNewClientEmail } from "./newClientSourceEmail.ts";

export type GmailReadOnlyClientConfig = Pick<
  AppConfig,
  | "gmailClientId"
  | "gmailClientSecret"
  | "gmailRefreshToken"
  | "gmailUserEmail"
  | "gmailApiBaseUrl"
  | "gmailOAuthTokenUrl"
>;

export type GmailReadOnlyAvailability = {
  available: boolean;
  missingVariables: string[];
};

export type GmailReadOnlyClientOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export class GmailReadOnlyClient {
  private readonly config: GmailReadOnlyClientConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private accessToken?: { value: string; expiresAt: number };

  constructor(config: GmailReadOnlyClientConfig, options: GmailReadOnlyClientOptions = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
    this.baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 1_000));
    this.maxDelayMs = Math.max(this.baseDelayMs, Math.floor(options.maxDelayMs ?? 10_000));
  }

  getAvailability(): GmailReadOnlyAvailability {
    const missingVariables = [
      ["GMAIL_CLIENT_ID", this.config.gmailClientId],
      ["GMAIL_CLIENT_SECRET", this.config.gmailClientSecret],
      ["GMAIL_REFRESH_TOKEN", this.config.gmailRefreshToken],
      ["GMAIL_USER_EMAIL", this.config.gmailUserEmail]
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    return {
      available: missingVariables.length === 0,
      missingVariables
    };
  }

  async searchNewClientEmails(input: {
    query: string;
    maxResults: number;
  }): Promise<SweepAndGoNewClientEmail[]> {
    const availability = this.getAvailability();
    if (!availability.available) {
      throw new Error(`Gmail read-only credentials are not configured: ${availability.missingVariables.join(", ")}`);
    }

    const user = encodeURIComponent(this.config.gmailUserEmail ?? "me");
    const searchUrl = new URL(`${this.config.gmailApiBaseUrl}/gmail/v1/users/${user}/messages`);
    searchUrl.searchParams.set("q", input.query);
    searchUrl.searchParams.set("maxResults", String(input.maxResults));

    const search = await this.fetchJson(searchUrl, "Gmail message search failed");
    const messages = Array.isArray(search.messages) ? search.messages : [];
    const emails: SweepAndGoNewClientEmail[] = [];

    for (const message of messages) {
      const id = typeof message?.id === "string" ? message.id : undefined;
      if (!id) {
        continue;
      }
      emails.push(await this.getMessage(user, id));
    }

    return emails;
  }

  private async getMessage(user: string, messageId: string): Promise<SweepAndGoNewClientEmail> {
    const messageUrl = new URL(`${this.config.gmailApiBaseUrl}/gmail/v1/users/${user}/messages/${encodeURIComponent(messageId)}`);
    messageUrl.searchParams.set("format", "full");
    const message = await this.fetchJson(messageUrl, "Gmail message read failed");
    const headers = extractHeaders(message.payload);
    const subject = headers.get("subject") ?? "";
    const from = headers.get("from") ?? "";
    const receivedAt = internalDateToIso(message.internalDate) ?? new Date().toISOString();
    const body = extractMessageBody(message.payload);

    return {
      messageId,
      subject,
      from,
      receivedAt,
      body
    };
  }

  private async fetchJson(url: URL, errorPrefix: string): Promise<any> {
    const token = await this.getAccessToken();
    return await this.withRetry(errorPrefix, async () => {
      const response = await this.fetchWithNetworkError(
        url,
        {
          headers: {
            authorization: `Bearer ${token}`
          }
        },
        errorPrefix
      );
      if (!response.ok) {
        throw new GmailReadOnlyHttpError(
          `${errorPrefix} with HTTP ${response.status}`,
          response.status,
          retryAfterMs(response)
        );
      }
      return await response.json();
    });
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.expiresAt - 60_000) {
      return this.accessToken.value;
    }

    const body = await this.withRetry("Gmail OAuth refresh", async () => {
      const response = await this.fetchWithNetworkError(
        this.config.gmailOAuthTokenUrl,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            client_id: this.config.gmailClientId ?? "",
            client_secret: this.config.gmailClientSecret ?? "",
            refresh_token: this.config.gmailRefreshToken ?? "",
            grant_type: "refresh_token"
          })
        },
        "Gmail OAuth refresh"
      );
      const parsed = await response.json().catch(() => ({}));
      if (!response.ok || typeof parsed.access_token !== "string") {
        throw new GmailReadOnlyHttpError(
          `Gmail OAuth refresh failed with HTTP ${response.status}`,
          response.status,
          retryAfterMs(response)
        );
      }
      return parsed;
    });

    this.accessToken = {
      value: body.access_token,
      expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000
    };
    return this.accessToken.value;
  }

  private async fetchWithNetworkError(
    input: string | URL,
    init: RequestInit,
    operation: string
  ): Promise<Response> {
    try {
      return await this.fetchImpl(input, init);
    } catch (error) {
      throw new GmailReadOnlyNetworkError(`${operation} network error: ${errorMessage(error)}`);
    }
  }

  private async withRetry<T>(operation: string, run: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        lastError = error;
        if (attempt === this.maxAttempts || !isRetryableGmailReadOnlyError(error)) {
          throw error;
        }
        await this.sleep(this.retryDelayMs(error, attempt));
      }
    }
    throw new Error(`${operation} failed: ${errorMessage(lastError)}`);
  }

  private retryDelayMs(error: unknown, attempt: number): number {
    if (error instanceof GmailReadOnlyHttpError && error.retryAfterMs !== undefined) {
      return Math.min(error.retryAfterMs, this.maxDelayMs);
    }
    return Math.min(this.baseDelayMs * attempt, this.maxDelayMs);
  }
}

export function createGmailReadOnlyClient(config: GmailReadOnlyClientConfig): GmailReadOnlyClient | undefined {
  const client = new GmailReadOnlyClient(config);
  return client.getAvailability().available ? client : undefined;
}

class GmailReadOnlyNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailReadOnlyNetworkError";
  }
}

class GmailReadOnlyHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "GmailReadOnlyHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function isRetryableGmailReadOnlyError(error: unknown): boolean {
  if (error instanceof GmailReadOnlyNetworkError) {
    return true;
  }
  if (error instanceof GmailReadOnlyHttpError) {
    return (
      error.status === 408 ||
      error.status === 409 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  return false;
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = new Date(value).getTime();
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractHeaders(payload: unknown): Map<string, string> {
  const headers = new Map<string, string>();
  const rawHeaders = asRecord(payload)?.headers;
  if (!Array.isArray(rawHeaders)) {
    return headers;
  }
  for (const header of rawHeaders) {
    const name = typeof header?.name === "string" ? header.name.trim().toLowerCase() : undefined;
    const value = typeof header?.value === "string" ? header.value : undefined;
    if (name && value) {
      headers.set(name, value);
    }
  }
  return headers;
}

function extractMessageBody(payload: unknown): string {
  const output: string[] = [];
  collectBodyParts(payload, output);
  return output.join("\n").trim();
}

function collectBodyParts(payload: unknown, output: string[]): void {
  const record = asRecord(payload);
  if (!record) {
    return;
  }

  const mimeType = typeof record.mimeType === "string" ? record.mimeType.toLowerCase() : "";
  const data = asRecord(record.body)?.data;
  if (typeof data === "string" && (mimeType.includes("text/plain") || mimeType.includes("text/html") || !mimeType)) {
    const decoded = decodeBase64Url(data);
    if (decoded) {
      output.push(stripHtml(decoded));
    }
  }

  if (Array.isArray(record.parts)) {
    for (const part of record.parts) {
      collectBodyParts(part, output);
    }
  }
}

function decodeBase64Url(value: string): string {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ");
}

function internalDateToIso(value: unknown): string | undefined {
  const numeric = typeof value === "string" ? Number(value) : undefined;
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return new Date(numeric).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
