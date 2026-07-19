import { logger, serializeError } from "../logger.ts";
import { DEFAULT_DAILY_SWEEPGO_MAX_PAGES, maxPagesFromArgs, runSweepAndGoReportingSync } from "./sync.ts";

runSweepAndGoReportingSync({
  mode: "daily",
  maxPages: maxPagesFromArgs(process.argv.slice(2), DEFAULT_DAILY_SWEEPGO_MAX_PAGES)
}).catch((error) => {
  logger.error({ error: serializeError(error) }, "Sweep&Go daily sync failed");
  process.exit(1);
});
