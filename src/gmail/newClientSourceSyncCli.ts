import { loadConfig } from "../config.ts";
import { createPool } from "../db/pool.ts";
import { isSweepAndGoNewClientEmail, parseSweepAndGoNewClientEmail } from "./newClientSourceEmail.ts";
import { PostgresNewClientSourceEmailStore } from "./newClientSourceStore.ts";
import { createGmailReadOnlyClient, GmailReadOnlyClient } from "./readOnlyClient.ts";

type SyncSummary = {
  status: "success" | "skipped";
  reason?: string;
  sinceDays: number;
  messagesRead: number;
  parsedMessages: number;
  matched: number;
  needsReview: number;
  unmatched: number;
  skippedExisting: number;
};

async function main() {
  const config = loadConfig();
  const sinceDays = positiveIntegerArg("--since-days", 3);
  const maxResults = positiveIntegerArg("--max-results", 50);
  const client = createGmailReadOnlyClient(config);
  const availability = new GmailReadOnlyClient(config).getAvailability();
  if (!client) {
    printSummary({
      status: "skipped",
      reason: `missing_gmail_readonly_variables:${availability.missingVariables.join(",")}`,
      sinceDays,
      messagesRead: 0,
      parsedMessages: 0,
      matched: 0,
      needsReview: 0,
      unmatched: 0,
      skippedExisting: 0
    });
    return;
  }
  if (!config.databaseUrl) {
    printSummary({
      status: "skipped",
      reason: "missing_DATABASE_URL",
      sinceDays,
      messagesRead: 0,
      parsedMessages: 0,
      matched: 0,
      needsReview: 0,
      unmatched: 0,
      skippedExisting: 0
    });
    return;
  }

  const pool = await createPool(config.databaseUrl);
  let syncRunId: string | undefined;
  try {
    syncRunId = await startSyncRun(pool, {
      sinceDays,
      maxResults
    });
    const store = new PostgresNewClientSourceEmailStore(pool);
    const messages = await client.searchNewClientEmails({
      query: buildFallbackQuery(sinceDays),
      maxResults
    });
    const summary: SyncSummary = {
      status: "success",
      sinceDays,
      messagesRead: messages.length,
      parsedMessages: 0,
      matched: 0,
      needsReview: 0,
      unmatched: 0,
      skippedExisting: 0
    };

    for (const message of messages) {
      if (!isSweepAndGoNewClientEmail(message)) {
        continue;
      }
      summary.parsedMessages += 1;
      const result = await store.apply(parseSweepAndGoNewClientEmail(message));
      if (result.status === "matched") {
        summary.matched += 1;
      } else if (result.status === "needs_review") {
        summary.needsReview += 1;
      } else if (result.status === "unmatched") {
        summary.unmatched += 1;
      } else if (result.status === "skipped_existing") {
        summary.skippedExisting += 1;
      }
    }

    await completeSyncRun(pool, syncRunId, {
      recordsRead: summary.messagesRead,
      recordsWritten: summary.matched + summary.needsReview + summary.unmatched
    });
    printSummary(summary);
  } catch (error) {
    if (syncRunId) {
      await failSyncRun(pool, syncRunId, error instanceof Error ? error.message : String(error));
    }
    throw error;
  } finally {
    await pool.end();
  }
}

async function startSyncRun(pool: any, metadata: Record<string, unknown>): Promise<string> {
  const result = await pool.query(
    `INSERT INTO sync_runs (provider, sync_type, status, started_at, metadata)
     VALUES ('gmail_new_client_source', 'new_client_source_email_scan', 'started', NOW(), $1::jsonb)
     RETURNING id`,
    [JSON.stringify(metadata)]
  );
  return String(result.rows[0].id);
}

async function completeSyncRun(
  pool: any,
  syncRunId: string,
  input: { recordsRead: number; recordsWritten: number }
): Promise<void> {
  await pool.query(
    `UPDATE sync_runs
     SET status = 'completed',
         completed_at = NOW(),
         records_read = $2,
         records_written = $3
     WHERE id = $1`,
    [syncRunId, input.recordsRead, input.recordsWritten]
  );
}

async function failSyncRun(pool: any, syncRunId: string, errorMessage: string): Promise<void> {
  await pool.query(
    `UPDATE sync_runs
     SET status = 'failed',
         completed_at = NOW(),
         error_message = $2
     WHERE id = $1`,
    [syncRunId, errorMessage.slice(0, 1000)]
  );
}

function buildFallbackQuery(sinceDays: number): string {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - sinceDays);
  return [
    "from:noreply@sweepandgo.com",
    'subject:"created new account"',
    `after:${gmailDate(start)}`,
    `before:${gmailDate(end)}`,
    "-in:trash"
  ].join(" ");
}

function gmailDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "/");
}

function positiveIntegerArg(name: string, fallback: number): number {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  const raw = direct?.slice(name.length + 1);
  const parsed = raw ? Number(raw) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function printSummary(summary: SyncSummary): void {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main().catch((error) => {
  process.stderr.write(JSON.stringify({
    status: "failed",
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exit(1);
});
