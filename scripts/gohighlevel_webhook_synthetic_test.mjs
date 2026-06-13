import { Readable } from "node:stream";
import { loadConfig } from "../src/config.ts";
import { createPool } from "../src/db/pool.ts";
import { GoHighLevelWebhookProcessor } from "../src/gohighlevel/webhookProcessor.ts";
import { PostgresGoHighLevelWebhookStore } from "../src/gohighlevel/store.ts";
import { createRequestHandler } from "../src/http/app.ts";
import { InMemoryWebhookEventStore } from "../src/webhooks/inMemoryStore.ts";
import { PostgresIntegrationEventStore } from "../src/webhooks/integrationEventStore.ts";

const config = loadConfig();

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required for the GoHighLevel webhook synthetic test.");
}
if (!config.goHighLevelWebhookSecret) {
  throw new Error("GOHIGHLEVEL_WEBHOOK_SECRET is required for the GoHighLevel webhook synthetic test.");
}
if (!config.goHighLevelPipelineId || !config.goHighLevelFacebookStageId || !config.goHighLevelWebsiteStageId) {
  throw new Error("GHL_PIPELINE_ID, GHL_FACEBOOK_STAGE_ID and GHL_WEBSITE_STAGE_ID are required.");
}

const pool = await createPool(config.databaseUrl);
const integrationEventStore = new PostgresIntegrationEventStore(pool);
const goHighLevelProcessor = new GoHighLevelWebhookProcessor(
  new PostgresGoHighLevelWebhookStore(pool),
  config
);
const handler = createRequestHandler({
  config,
  webhookStore: new InMemoryWebhookEventStore(),
  integrationEventStore,
  integrationEventProcessor: goHighLevelProcessor,
  startedAt: new Date()
});

const testRunId = `phase4_synthetic_${Date.now()}`;
const idPrefix = `${testRunId}_`;
const baseTimestamp = "2026-06-13T17:00:00.000Z";

try {
  const before = await countSyntheticState(pool, testRunId, idPrefix);
  const invalidSecretResponse = await invokeWebhook({
    handler,
    secret: `${config.goHighLevelWebhookSecret}_invalid`,
    body: syntheticPayload("invalid_secret", {
      event_type: "pipeline_stage_updated",
      opportunityId: `${idPrefix}invalid_secret`,
      contactId: `${idPrefix}contact_invalid_secret`,
      pipelineId: config.goHighLevelPipelineId,
      pipelineStageId: config.goHighLevelFacebookStageId,
      timestamp: baseTimestamp
    })
  });

  const events = [
    syntheticPayload("facebook", {
      event_type: "pipeline_stage_updated",
      eventId: `${idPrefix}event_facebook`,
      opportunityId: `${idPrefix}opp_facebook`,
      contactId: `${idPrefix}contact_facebook`,
      pipelineId: config.goHighLevelPipelineId,
      pipelineStageId: config.goHighLevelFacebookStageId,
      timestamp: baseTimestamp
    }),
    syntheticPayload("facebook", {
      event_type: "pipeline_stage_updated",
      eventId: `${idPrefix}event_facebook`,
      opportunityId: `${idPrefix}opp_facebook`,
      contactId: `${idPrefix}contact_facebook`,
      pipelineId: config.goHighLevelPipelineId,
      pipelineStageId: config.goHighLevelFacebookStageId,
      timestamp: baseTimestamp
    }),
    syntheticPayload("website", {
      event_type: "pipeline_stage_updated",
      eventId: `${idPrefix}event_website`,
      opportunityId: `${idPrefix}opp_website`,
      contactId: `${idPrefix}contact_website`,
      pipelineId: config.goHighLevelPipelineId,
      pipelineStageId: config.goHighLevelWebsiteStageId,
      timestamp: "2026-06-13T17:05:00.000Z"
    }),
    syntheticPayload("website", {
      event_type: "pipeline_stage_updated",
      eventId: `${idPrefix}event_website`,
      opportunityId: `${idPrefix}opp_website`,
      contactId: `${idPrefix}contact_website`,
      pipelineId: config.goHighLevelPipelineId,
      pipelineStageId: config.goHighLevelWebsiteStageId,
      timestamp: "2026-06-13T17:05:00.000Z"
    }),
    syntheticPayload("follow_up", {
      event_type: "pipeline_stage_updated",
      eventId: `${idPrefix}event_follow_up`,
      opportunityId: `${idPrefix}opp_website`,
      contactId: `${idPrefix}contact_website`,
      pipelineId: config.goHighLevelPipelineId,
      pipelineStageId: `${idPrefix}stage_follow_up`,
      timestamp: "2026-06-13T17:10:00.000Z"
    }),
    syntheticPayload("status", {
      event_type: "opportunity_status_changed",
      eventId: `${idPrefix}event_status`,
      opportunityId: `${idPrefix}opp_status`,
      contactId: `${idPrefix}contact_status`,
      pipelineId: config.goHighLevelPipelineId,
      pipelineStageId: config.goHighLevelFacebookStageId,
      status: "won",
      timestamp: "2026-06-13T17:15:00.000Z"
    }),
    syntheticPayload("wrong_pipeline", {
      event_type: "pipeline_stage_updated",
      eventId: `${idPrefix}event_wrong_pipeline`,
      opportunityId: `${idPrefix}opp_wrong_pipeline`,
      contactId: `${idPrefix}contact_wrong_pipeline`,
      pipelineId: `${idPrefix}pipeline_wrong`,
      pipelineStageId: config.goHighLevelFacebookStageId,
      timestamp: "2026-06-13T17:20:00.000Z"
    }),
    syntheticPayload("missing_opportunity", {
      event_type: "pipeline_stage_updated",
      eventId: `${idPrefix}event_missing_opportunity`,
      contactId: `${idPrefix}contact_missing_opportunity`,
      pipelineId: config.goHighLevelPipelineId,
      pipelineStageId: config.goHighLevelFacebookStageId,
      timestamp: "2026-06-13T17:25:00.000Z"
    }),
    syntheticPayload("out_of_order_latest", {
      event_type: "pipeline_stage_updated",
      eventId: `${idPrefix}event_out_of_order_latest`,
      opportunityId: `${idPrefix}opp_out_of_order`,
      contactId: `${idPrefix}contact_out_of_order`,
      pipelineId: config.goHighLevelPipelineId,
      pipelineStageId: `${idPrefix}stage_follow_up`,
      timestamp: "2026-06-13T17:30:00.000Z"
    }),
    syntheticPayload("out_of_order_original", {
      event_type: "pipeline_stage_updated",
      eventId: `${idPrefix}event_out_of_order_original`,
      opportunityId: `${idPrefix}opp_out_of_order`,
      contactId: `${idPrefix}contact_out_of_order`,
      pipelineId: config.goHighLevelPipelineId,
      pipelineStageId: `${idPrefix}stage_older_follow_up`,
      timestamp: "2026-06-13T17:00:00.000Z"
    })
  ];

  const responses = [];
  for (const body of events) {
    responses.push(await invokeWebhook({ handler, secret: config.goHighLevelWebhookSecret, body }));
  }

  await waitForProcessing(pool, testRunId, 8);
  const after = await countSyntheticState(pool, testRunId, idPrefix);

  const output = {
    endpoint: {
      enabled: true,
      validPathFormat: "/webhooks/gohighlevel/{GOHIGHLEVEL_WEBHOOK_SECRET}",
      incorrectSecretRejected: invalidSecretResponse.status === 404,
      validRequestsAccepted: responses.filter((response) => response.status === 200).length,
      duplicateRequestsReported: responses.filter((response) => response.body?.duplicate === true).length
    },
    counts: {
      before,
      after
    },
    assertions: {
      facebookLeadCountedOnce: after.opportunitiesByOriginalSource.facebook === 1,
      websiteLeadCountedOnce: after.opportunitiesByOriginalSource.website === 1,
      wrongPipelineIgnoredForClassification: after.wrongPipelineClassifiedCount === 0,
      statusUpdateDidNotCreateLead: after.statusOpportunityLeadSource === "unknown",
      duplicateEventsDidNotInsert: after.integrationEvents === 8,
      reconciliationIssuesCreated: after.reconciliationIssues >= 1,
      noDuplicateContacts: after.duplicateContacts === 0,
      noDuplicateOpportunities: after.duplicateOpportunities === 0,
      noDuplicateStageHistoryEvents: after.duplicateStageHistoryEvents === 0
    }
  };

  console.log(JSON.stringify(output, null, 2));

  const failed = Object.entries(output.assertions).filter(([, passed]) => !passed);
  if (failed.length > 0) {
    process.exit(1);
  }
} finally {
  await pool.end();
}

function syntheticPayload(testCase, fields) {
  return {
    testRunId,
    testCase,
    ...fields
  };
}

async function invokeWebhook({ handler, secret, body }) {
  const chunks = [];
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = "POST";
  request.url = `/webhooks/gohighlevel/${encodeURIComponent(secret)}`;
  request.headers = { "content-type": "application/json" };

  const response = {
    statusCode: 200,
    writeHead(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return this;
    }
  };

  await handler(request, response);
  const text = Buffer.concat(chunks).toString("utf8");
  return {
    status: response.statusCode,
    body: text ? JSON.parse(text) : undefined
  };
}

async function waitForProcessing(pool, runId, expectedProcessedCount) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM integration_events
       WHERE provider = 'gohighlevel'
         AND payload->>'testRunId' = $1
         AND processing_status IN ('processed', 'failed')`,
      [runId]
    );
    if (Number(result.rows[0].count) >= expectedProcessedCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function countSyntheticState(pool, runId, prefix) {
  const [
    integrationEvents,
    opportunities,
    contacts,
    services,
    issues,
    wrongPipeline,
    statusOpportunity,
    duplicateContacts,
    duplicateOpportunities,
    duplicateStageHistoryEvents
  ] = await Promise.all([
    scalar(pool, "SELECT COUNT(*)::int FROM integration_events WHERE provider = 'gohighlevel' AND payload->>'testRunId' = $1", [runId]),
    pool.query(
      `SELECT original_lead_source, COUNT(*)::int AS count
       FROM opportunities
       WHERE provider = 'gohighlevel'
         AND external_opportunity_id LIKE $1
       GROUP BY original_lead_source`,
      [`${prefix}%`]
    ),
    scalar(pool, "SELECT COUNT(*)::int FROM contacts WHERE external_ghl_id LIKE $1", [`${prefix}%`]),
    scalar(pool, "SELECT COUNT(*)::int FROM opportunity_stage_history WHERE external_opportunity_id LIKE $1", [`${prefix}%`]),
    scalar(pool, "SELECT COUNT(*)::int FROM reconciliation_issues WHERE details->>'testRunId' = $1", [runId]),
    scalar(
      pool,
      `SELECT COUNT(*)::int
       FROM opportunities
       WHERE external_opportunity_id = $1
         AND original_lead_source <> 'unknown'`,
      [`${prefix}opp_wrong_pipeline`]
    ),
    scalar(
      pool,
      `SELECT original_lead_source
       FROM opportunities
       WHERE external_opportunity_id = $1
       LIMIT 1`,
      [`${prefix}opp_status`],
      "unknown"
    ),
    scalar(
      pool,
      `SELECT COUNT(*)::int
       FROM (
         SELECT external_ghl_id
         FROM contacts
         WHERE external_ghl_id LIKE $1
         GROUP BY external_ghl_id
         HAVING COUNT(*) > 1
       ) duplicates`,
      [`${prefix}%`]
    ),
    scalar(
      pool,
      `SELECT COUNT(*)::int
       FROM (
         SELECT external_opportunity_id
         FROM opportunities
         WHERE provider = 'gohighlevel'
           AND external_opportunity_id LIKE $1
         GROUP BY external_opportunity_id
         HAVING COUNT(*) > 1
       ) duplicates`,
      [`${prefix}%`]
    ),
    scalar(
      pool,
      `SELECT COUNT(*)::int
       FROM (
         SELECT event_fingerprint
         FROM opportunity_stage_history
         WHERE external_opportunity_id LIKE $1
           AND event_fingerprint IS NOT NULL
         GROUP BY event_fingerprint
         HAVING COUNT(*) > 1
       ) duplicates`,
      [`${prefix}%`]
    )
  ]);

  return {
    integrationEvents: Number(integrationEvents),
    contacts: Number(contacts),
    opportunities: opportunities.rows.reduce((output, row) => {
      output[row.original_lead_source ?? "unknown"] = Number(row.count);
      return output;
    }, { facebook: 0, website: 0, other: 0, unknown: 0 }),
    opportunitiesByOriginalSource: opportunities.rows.reduce((output, row) => {
      output[row.original_lead_source ?? "unknown"] = Number(row.count);
      return output;
    }, { facebook: 0, website: 0, other: 0, unknown: 0 }),
    stageHistory: Number(services),
    reconciliationIssues: Number(issues),
    wrongPipelineClassifiedCount: Number(wrongPipeline),
    statusOpportunityLeadSource: statusOpportunity,
    duplicateContacts: Number(duplicateContacts),
    duplicateOpportunities: Number(duplicateOpportunities),
    duplicateStageHistoryEvents: Number(duplicateStageHistoryEvents)
  };
}

async function scalar(pool, sql, params, fallback = 0) {
  const result = await pool.query(sql, params);
  const first = result.rows[0];
  if (!first) {
    return fallback;
  }
  return Object.values(first)[0] ?? fallback;
}
