import { logger, serializeError } from "../logger.ts";
import { maxPagesFromArgs, runSweepAndGoReportingSync } from "./sync.ts";

runSweepAndGoReportingSync({
  mode: "historical",
  maxPages: maxPagesFromArgs(process.argv.slice(2))
}).catch((error) => {
  logger.error({ error: serializeError(error) }, "Sweep&Go historical sync failed");
  process.exit(1);
});
