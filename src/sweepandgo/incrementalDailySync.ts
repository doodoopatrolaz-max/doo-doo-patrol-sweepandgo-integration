import { logger, serializeError } from "../logger.ts";
import { maxPagesFromArgs, runSweepAndGoReportingSync } from "./sync.ts";

runSweepAndGoReportingSync({
  mode: "daily",
  maxPages: maxPagesFromArgs(process.argv.slice(2), 5)
}).catch((error) => {
  logger.error({ error: serializeError(error) }, "Sweep&Go daily sync failed");
  process.exit(1);
});
