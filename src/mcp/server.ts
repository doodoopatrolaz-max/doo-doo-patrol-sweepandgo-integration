import { loadConfig } from "../config.ts";
import { createPool } from "../db/pool.ts";
import { logger, sanitizeForLogs, serializeError } from "../logger.ts";
import { PostgresOnboardingIntakeStore } from "../onboarding/postgresStore.ts";
import type { OnboardingIntakeStore } from "../onboarding/store.ts";
import { buildDailyDashboardReport } from "../reports/dailyDashboard.ts";
import { SweepAndGoClient } from "../sweepandgo/client.ts";
import type { PaginationOptions } from "../sweepandgo/client.ts";
import { PostgresWebhookEventStore } from "../webhooks/postgresStore.ts";
import type { WebhookEventStore } from "../webhooks/store.ts";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

const emptySchema = {
  type: "object",
  properties: {},
  additionalProperties: false
};

const paginationSchema = {
  type: "object",
  properties: {
    page: {
      type: "number",
      description: "Page number to fetch. Defaults to 1."
    },
    allPages: {
      type: "boolean",
      description: "Fetch all available pages up to maxPages. Defaults to false."
    },
    maxPages: {
      type: "number",
      description: "Maximum pages to fetch when allPages is true. Defaults to 25."
    }
  },
  additionalProperties: false
};

function pagination(input: Record<string, unknown>): PaginationOptions {
  return {
    page: numberInput(input.page, 1),
    allPages: booleanInput(input.allPages, false),
    maxPages: Math.min(numberInput(input.maxPages, 25), 100)
  };
}

function stringInput(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function numberInput(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("Expected a positive number");
  }
  return Math.floor(number);
}

function booleanInput(value: unknown, fallback: boolean): boolean {
  return value === undefined ? fallback : Boolean(value);
}

async function main() {
  const config = loadConfig();
  const client = new SweepAndGoClient(config);
  let pool: any | undefined;
  let webhookStore: WebhookEventStore | undefined;
  let onboardingStore: OnboardingIntakeStore | undefined;

  async function getPool() {
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL is required to read stored database records");
    }

    if (!pool) {
      pool = await createPool(config.databaseUrl);
    }

    return pool;
  }

  async function getWebhookStore() {
    if (!webhookStore) {
      webhookStore = new PostgresWebhookEventStore(await getPool());
    }

    return webhookStore;
  }

  async function getOnboardingStore() {
    if (!onboardingStore) {
      onboardingStore = new PostgresOnboardingIntakeStore(await getPool());
    }

    return onboardingStore;
  }

  const tools: ToolDefinition[] = [
    {
      name: "sweepandgo_health_check",
      description: "Check whether the public Sweep&Go API is reachable.",
      inputSchema: emptySchema,
      handler: async () => client.healthCheck()
    },
    {
      name: "get_active_clients",
      description: "Read active clients from Sweep&Go.",
      inputSchema: paginationSchema,
      handler: async (input) => client.getActiveClients(pagination(input))
    },
    {
      name: "get_inactive_clients",
      description: "Read inactive clients from Sweep&Go.",
      inputSchema: paginationSchema,
      handler: async (input) => client.getInactiveClients(pagination(input))
    },
    {
      name: "get_active_clients_without_subscription",
      description: "Read active clients that do not have an active subscription.",
      inputSchema: paginationSchema,
      handler: async (input) => client.getActiveClientsWithoutSubscription(pagination(input))
    },
    {
      name: "search_client_by_email",
      description: "Find a Sweep&Go client by email address.",
      inputSchema: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string", format: "email" },
          status: { type: "string", enum: ["active", "inactive"] },
          latest: { type: "boolean", default: true }
        },
        additionalProperties: false
      },
      handler: async (input) => client.searchClientByEmail({
        email: stringInput(input.email, "email"),
        status: input.status === "active" || input.status === "inactive" ? input.status : undefined,
        latest: booleanInput(input.latest, true)
      })
    },
    {
      name: "get_client_details_and_payments",
      description: "Read client details and payment summary from Sweep&Go by client identifier.",
      inputSchema: {
        type: "object",
        required: ["client"],
        properties: {
          client: {
            type: "string",
            description: "Sweep&Go client string, for example rcl_MTPQPRUUUY7G."
          }
        },
        additionalProperties: false
      },
      handler: async (input) => client.getClientDetailsAndPayments(stringInput(input.client, "client"))
    },
    {
      name: "get_leads",
      description: "Read Sweep&Go leads.",
      inputSchema: paginationSchema,
      handler: async (input) => client.getLeads(pagination(input))
    },
    {
      name: "get_out_of_area_leads",
      description: "Read Sweep&Go out-of-area leads.",
      inputSchema: paginationSchema,
      handler: async (input) => client.getOutOfAreaLeads(pagination(input))
    },
    {
      name: "get_dispatch_jobs",
      description: "Read Sweep&Go dispatch-board jobs for a date.",
      inputSchema: {
        type: "object",
        required: ["date"],
        properties: {
          date: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Date in YYYY-MM-DD format."
          }
        },
        additionalProperties: false
      },
      handler: async (input) => client.getDispatchJobs(stringInput(input.date, "date"))
    },
    {
      name: "get_daily_dashboard_report",
      description: "Build the internal daily route dashboard summary for one date, grouped by tech.",
      inputSchema: {
        type: "object",
        required: ["date"],
        properties: {
          date: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Date in YYYY-MM-DD format."
          }
        },
        additionalProperties: false
      },
      handler: async (input) => buildDailyDashboardReport({
        date: stringInput(input.date, "date"),
        client
      })
    },
    { name: "count_dogs", description: "Count dogs for happy clients.", inputSchema: emptySchema, handler: async () => client.countDogs() },
    { name: "count_happy_clients", description: "Count happy clients.", inputSchema: emptySchema, handler: async () => client.countHappyClients() },
    { name: "count_active_clients", description: "Count active clients.", inputSchema: emptySchema, handler: async () => client.countActiveClients() },
    { name: "count_completed_jobs", description: "Count completed jobs.", inputSchema: emptySchema, handler: async () => client.countCompletedJobs() },
    { name: "list_active_staff", description: "List active Sweep&Go staff.", inputSchema: emptySchema, handler: async () => client.listActiveStaff() },
    {
      name: "list_received_webhooks",
      description: "List locally received webhook payloads stored by this integration.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", maximum: 100, default: 25 },
          offset: { type: "number", minimum: 0, default: 0 }
        },
        additionalProperties: false
      },
      handler: async (input) => {
        const store = await getWebhookStore();
        return store.listEvents(Math.min(numberInput(input.limit, 25), 100), Number(input.offset ?? 0));
      }
    },
    {
      name: "get_received_webhook_details",
      description: "Read one locally stored webhook event by internal ID.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
        additionalProperties: false
      },
      handler: async (input) => {
        const event = await (await getWebhookStore()).getEvent(stringInput(input.id, "id"));
        return event ?? { error: "not_found" };
      }
    },
    {
      name: "list_onboarding_intakes",
      description: "List Sweep&Go onboarding intakes captured from onboarding webhook triggers.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", maximum: 100, default: 25 },
          offset: { type: "number", minimum: 0, default: 0 }
        },
        additionalProperties: false
      },
      handler: async (input) => {
        const store = await getOnboardingStore();
        return store.listIntakes(Math.min(numberInput(input.limit, 25), 100), Number(input.offset ?? 0));
      }
    },
    {
      name: "get_onboarding_intake_details",
      description: "Read one captured onboarding intake by internal ID, including verified and missing details.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
        additionalProperties: false
      },
      handler: async (input) => {
        const intake = await (await getOnboardingStore()).getIntake(stringInput(input.id, "id"));
        return intake ?? { error: "not_found" };
      }
    },
    {
      name: "retry_sweepandgo_webhook",
      description: "Ask Sweep&Go to retry one previously triggered webhook by Sweep&Go webhook ID.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: {
            type: "string",
            description: "Sweep&Go webhook ID from the Sweep&Go webhooks list."
          }
        },
        additionalProperties: false
      },
      handler: async (input) => client.retryWebhook(stringInput(input.id, "id"))
    }
  ];

  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  startMcpServer(async (request) => {
    if (request.method === "initialize") {
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "doo-doo-patrol-sweepandgo",
          version: "0.1.0"
        }
      };
    }

    if (request.method === "tools/list") {
      return {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
      };
    }

    if (request.method === "tools/call") {
      const name = stringInput(request.params?.name, "name");
      const tool = toolMap.get(name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const args = typeof request.params?.arguments === "object" && request.params.arguments
        ? request.params.arguments as Record<string, unknown>
        : {};

      return textResult(await tool.handler(args));
    }

    if (request.method === "ping") {
      return {};
    }

    throw new Error(`Unsupported MCP method: ${request.method}`);
  });

  process.on("SIGINT", async () => {
    await pool?.end();
    process.exit(0);
  });
}

function startMcpServer(handle: (request: JsonRpcRequest) => Promise<unknown>) {
  let buffer = Buffer.alloc(0);

  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const parsed = readMessage(buffer);
      if (!parsed) {
        break;
      }

      buffer = parsed.remaining;
      void respond(parsed.message, handle);
    }
  });
}

async function respond(request: JsonRpcRequest, handle: (request: JsonRpcRequest) => Promise<unknown>) {
  if (!request.id && request.method?.startsWith("notifications/")) {
    return;
  }

  try {
    const result = await handle(request);
    writeMessage({ jsonrpc: "2.0", id: request.id ?? null, result });
  } catch (error) {
    const serialized = sanitizeForLogs(serializeError(error));
    logger.error({ error: serialized, method: request.method }, "MCP request failed");
    writeMessage({
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: {
        code: -32000,
        message: serialized && typeof serialized === "object" && "message" in serialized
          ? String(serialized.message)
          : "MCP request failed"
      }
    });
  }
}

function readMessage(buffer: Buffer): { message: JsonRpcRequest; remaining: Buffer } | undefined {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    return undefined;
  }

  const header = buffer.slice(0, headerEnd).toString("utf8");
  const match = /Content-Length:\s*(\d+)/i.exec(header);
  if (!match) {
    throw new Error("Missing Content-Length header");
  }

  const length = Number(match[1]);
  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + length;
  if (buffer.length < bodyEnd) {
    return undefined;
  }

  const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
  return {
    message: JSON.parse(body) as JsonRpcRequest,
    remaining: buffer.slice(bodyEnd)
  };
}

function writeMessage(message: unknown) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

main().catch((error) => {
  logger.error({ error: sanitizeForLogs(serializeError(error)) }, "MCP server failed");
  process.exit(1);
});
