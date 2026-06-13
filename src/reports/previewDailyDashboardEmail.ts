import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.ts";
import { logger, sanitizeForLogs, serializeError } from "../logger.ts";
import { SweepAndGoClient } from "../sweepandgo/client.ts";
import {
  buildDailyDashboardReport,
  renderDailyDashboardEmail
} from "./dailyDashboard.ts";
import { dateInTimeZone } from "./sendDailyDashboard.ts";

async function previewDailyDashboardEmail(input: { date?: string } = {}) {
  const config = loadConfig();
  const date = input.date ?? dateInTimeZone(new Date(), config.dailyDashboardTimeZone);
  const report = await buildDailyDashboardReport({
    date,
    client: new SweepAndGoClient(config)
  });
  const email = renderDailyDashboardEmail(report);

  return {
    to: config.dailyDashboardRecipient,
    subject: email.subject,
    text: email.text,
    html: email.html,
    report
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const date = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);
  previewDailyDashboardEmail({ date })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      logger.error({ error: sanitizeForLogs(serializeError(error)) }, "Daily dashboard preview failed");
      process.exit(1);
    });
}
