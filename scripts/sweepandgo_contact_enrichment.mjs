import { runSweepAndGoContactEnrichment } from "../src/sweepandgo/contactEnrichment.ts";

const result = await runSweepAndGoContactEnrichment();
console.log(JSON.stringify({
  status: "completed",
  ...result
}, null, 2));
