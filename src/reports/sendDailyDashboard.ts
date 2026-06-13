import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.ts";
import { sendSmtpEmail } from "../email/smtp.ts";
import { logger, sanitizeForLogs, serializeError } from "../logger.ts";
import { SweepAndGoClient } from "../sweepandgo/client.ts";
import {
  buildDailyDashboardReport,
  renderDailyDashboardEmail
} from "./dailyDashboard.ts";

export async function sendDailyDashboard(input: {
  date?: string;
  now?: Date;
} = {}): Promise<void> {
  const config = loadConfig();
  const date = input.date ?? dateInTimeZone(input.now ?? new Date(), config.dailyDashboardTimeZone);
  const client = new SweepAndGoClient(config);
  const report = await buildDailyDashboardReport({
    date,
    client,
    generatedAt: input.now
  });
  const email = renderDailyDashboardEmail(report);

  await sendSmtpEmail({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    user: config.smtpUser,
    password: config.smtpPassword
  }, {
    from: config.dailyDashboardFrom ?? "",
    to: splitRecipients(config.dailyDashboardRecipient),
    subject: email.subject,
    text: email.text,
    html: email.html
  });

  logger.info({
    date,
    recipient: config.dailyDashboardRecipient,
    techCount: report.techs.length,
    jobs: report.totals.jobs,
    skippedJobs: report.totals.skippedJobs
  }, "Daily dashboard report emailed");
}

export function dateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return `${lookup.get("year")}-${lookup.get("month")}-${lookup.get("day")}`;
}

function splitRecipients(value: string): string[] {
  return value.split(",").map((recipient) => recipient.trim()).filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const date = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);
  sendDailyDashboard({ date }).catch((error) => {
    logger.error({ error: sanitizeForLogs(serializeError(error)) }, "Daily dashboard report failed");
    process.exit(1);
  });
}
