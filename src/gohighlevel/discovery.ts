import { loadConfig } from "../config.ts";
import { GoHighLevelClient, type GoHighLevelPipeline } from "./client.ts";
import { loadGoHighLevelStageConfig } from "./stageConfig.ts";

export type PipelineDiscoveryResult = {
  configuredPipelineName: string;
  matchedPipeline?: {
    id?: string;
    name?: string;
    stages: Array<{ id?: string; name?: string; order: number }>;
  };
  similarPipelineNames: string[];
  duplicateStageNames: string[];
  facebookStageMatches: Array<{ id?: string; name?: string; order: number }>;
  websiteStageMatches: Array<{ id?: string; name?: string; order: number }>;
  totalPipelines: number;
};

export function assertGoHighLevelDiscoveryConfig(): { locationId: string; client: GoHighLevelClient } {
  const config = loadConfig();
  const missing = [];
  if (!config.goHighLevelPrivateIntegrationToken) missing.push("GHL_PRIVATE_INTEGRATION_TOKEN");
  if (!config.goHighLevelLocationId) missing.push("GHL_LOCATION_ID");
  if (missing.length) {
    throw new Error(`Missing required HighLevel discovery environment variables: ${missing.join(", ")}`);
  }

  return {
    locationId: config.goHighLevelLocationId as string,
    client: GoHighLevelClient.fromConfig(config)
  };
}

export async function discoverPipelines(): Promise<PipelineDiscoveryResult> {
  const { locationId, client } = assertGoHighLevelDiscoveryConfig();
  const stageConfig = loadGoHighLevelStageConfig();
  const pipelines = await client.getPipelines(locationId);
  return summarizePipelines(pipelines, stageConfig.pipelineName, stageConfig.facebookNewLeadStageName, stageConfig.websiteQuoteLeadStageName);
}

export function summarizePipelines(
  pipelines: GoHighLevelPipeline[],
  pipelineName: string,
  facebookStageName: string,
  websiteStageName: string
): PipelineDiscoveryResult {
  const matchedPipeline = pipelines.find((pipeline) => sameName(pipeline.name, pipelineName));
  const stages = (matchedPipeline?.stages ?? []).map((stage, index) => ({
    id: stage.id,
    name: stage.name,
    order: typeof stage.position === "number" ? stage.position : index + 1
  }));
  const stageNameCounts = new Map<string, number>();
  for (const stage of stages) {
    const key = stage.name?.trim().toLowerCase();
    if (key) {
      stageNameCounts.set(key, (stageNameCounts.get(key) ?? 0) + 1);
    }
  }

  return {
    configuredPipelineName: pipelineName,
    matchedPipeline: matchedPipeline ? {
      id: matchedPipeline.id,
      name: matchedPipeline.name,
      stages
    } : undefined,
    similarPipelineNames: pipelines
      .map((pipeline) => pipeline.name)
      .filter((name): name is string => Boolean(name && looseName(name).includes(looseName(pipelineName).split(" ")[0] ?? ""))),
    duplicateStageNames: [...stageNameCounts.entries()].filter(([, count]) => count > 1).map(([name]) => name),
    facebookStageMatches: stages.filter((stage) => sameName(stage.name, facebookStageName)),
    websiteStageMatches: stages.filter((stage) => sameName(stage.name, websiteStageName)),
    totalPipelines: pipelines.length
  };
}

function sameName(left: string | undefined, right: string): boolean {
  return looseName(left) === looseName(right);
}

function looseName(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}
