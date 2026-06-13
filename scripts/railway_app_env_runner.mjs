import { execFileSync } from "node:child_process";

const action = process.argv[2];

if (!action) {
  console.error("Usage: railway_app_env_runner.mjs <classify|sync|webhook-test>");
  process.exit(1);
}

const railway = process.env.RAILWAY_BIN || "railway";

const status = JSON.parse(execFileSync(railway, ["status", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
}));

const production = status.environments.edges
  .map((edge) => edge.node)
  .find((environment) => environment.name === "production");

if (!production) {
  throw new Error("production Railway environment not found");
}

const services = production.serviceInstances.edges.map((edge) => edge.node);
const app = services.find((service) => service.serviceName === "doo-doo-patrol-sweepandgo-integration");
const postgres = services.find((service) => service.serviceName === "Postgres");

if (!app || !postgres) {
  throw new Error("Expected Railway app or Postgres service was not found");
}

const publicPostgresDomain = postgres.domains.serviceDomains
  .find((domain) => domain.targetPort === 5432)?.domain;
if (!publicPostgresDomain) {
  throw new Error("Postgres public proxy domain was not found");
}

const appDomain = app.domains.serviceDomains[0]?.domain;
if (!appDomain) {
  throw new Error("App public domain was not found");
}

const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.hostname = publicPostgresDomain;
databaseUrl.port = "5432";
process.env.DATABASE_URL = databaseUrl.toString();

if (action === "classify") {
  console.log(JSON.stringify({
    databaseUrlRewrittenToPublicProxy: true,
    appDomainAvailable: true,
    postgresPublicProxyAvailable: true
  }, null, 2));
} else if (action === "sync") {
  const { runLimitedSweepAndGoSync } = await import("./limited_sweepandgo_sync.mjs");
  const result = await runLimitedSweepAndGoSync();
  console.log(JSON.stringify(result, null, 2));
} else if (action === "webhook-test") {
  const payload = {
    event_id: `step4_verification_${Date.now()}`,
    event_type: "system:verification",
    source: "codex_step4"
  };
  const response = await fetch(`https://${appDomain}/webhooks/sweepandgo/${encodeURIComponent(process.env.WEBHOOK_PATH_SECRET)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  console.log(JSON.stringify({
    status: response.status,
    ok: body.ok === true,
    duplicate: body.duplicate === true,
    stored: Boolean(body.eventId)
  }, null, 2));
} else {
  throw new Error(`Unknown action: ${action}`);
}
