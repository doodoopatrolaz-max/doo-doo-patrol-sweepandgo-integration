import { logger, serializeError } from "../logger.ts";
import { completedJobsSyncOptionsFromArgs, runSweepAndGoCompletedJobsSync } from "./completedJobsSync.ts";

runSweepAndGoCompletedJobsSync(completedJobsSyncOptionsFromArgs(process.argv.slice(2)))
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    logger.error({ error: serializeError(error) }, "Sweep&Go completed jobs sync failed");
    process.exit(1);
  });
