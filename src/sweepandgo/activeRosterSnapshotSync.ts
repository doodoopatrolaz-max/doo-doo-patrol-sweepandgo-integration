import { logger, serializeError } from "../logger.ts";
import {
  activeRosterDryRunFromArgs,
  activeRosterMaxPagesFromArgs,
  runActiveRosterSnapshotSync
} from "./activeRosterSnapshot.ts";

runActiveRosterSnapshotSync({
  maxPages: activeRosterMaxPagesFromArgs(process.argv.slice(2)),
  dryRun: activeRosterDryRunFromArgs(process.argv.slice(2))
}).catch((error) => {
  logger.error({ error: serializeError(error) }, "Sweep&Go active roster snapshot sync failed");
  process.exit(1);
});
