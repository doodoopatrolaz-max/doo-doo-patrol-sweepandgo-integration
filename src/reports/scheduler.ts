import type { AppConfig } from "../config.ts";
import { logger, sanitizeForLogs, serializeError } from "../logger.ts";
import { sendDailyDashboard, dateInTimeZone } from "./sendDailyDashboard.ts";

const CHECK_EVERY_MS = 60_000;
const RUN_HOUR = 17;
const RUN_MINUTE = 0;

export function startDailyDashboardScheduler(config: AppConfig): NodeJS.Timeout | undefined {
  if (!config.dailyDashboardEnabled) {
    logger.info("Daily dashboard scheduler disabled");
    return undefined;
  }

  let lastRunKey: string | undefined;

  async function check(now = new Date()) {
    const parts = dateTimeParts(now, config.dailyDashboardTimeZone);
    if (!isWeekday(parts.weekday) || parts.hour !== RUN_HOUR || parts.minute !== RUN_MINUTE) {
      return;
    }

    const runKey = dateInTimeZone(now, config.dailyDashboardTimeZone);
    if (runKey === lastRunKey) {
      return;
    }

    lastRunKey = runKey;
    try {
      await sendDailyDashboard({ date: runKey, now });
    } catch (error) {
      logger.error({
        date: runKey,
        recipient: config.dailyDashboardRecipient,
        error: sanitizeForLogs(serializeError(error))
      }, "Daily dashboard scheduled run failed");
    }
  }

  const timer = setInterval(() => void check(), CHECK_EVERY_MS);
  void check();
  logger.info({
    recipient: config.dailyDashboardRecipient,
    timeZone: config.dailyDashboardTimeZone,
    schedule: "Monday-Friday 5:00 PM"
  }, "Daily dashboard scheduler started");
  return timer;
}

function dateTimeParts(date: Date, timeZone: string): {
  weekday: string;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));

  return {
    weekday: lookup.get("weekday") ?? "",
    hour: Number(lookup.get("hour")),
    minute: Number(lookup.get("minute"))
  };
}

function isWeekday(weekday: string): boolean {
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
}
