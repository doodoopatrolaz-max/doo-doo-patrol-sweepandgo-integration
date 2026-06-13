import { discoverPipelines } from "../src/gohighlevel/discovery.ts";

try {
  const result = await discoverPipelines();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exit(1);
}
