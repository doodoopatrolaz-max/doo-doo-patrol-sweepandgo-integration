import type { GoHighLevelOpportunityMapping } from "./mapper.ts";

export type PreparedOpportunityUpsert = {
  provider: "gohighlevel";
  externalOpportunityId?: string;
  externalContactId?: string;
  pipelineId?: string;
  pipelineName: string;
  stageId?: string;
  stageName: string;
  status?: string;
  originalLeadSource: string;
  originalLeadDate?: string;
  metadata: Record<string, unknown>;
};

export function prepareOpportunityUpsert(input: GoHighLevelOpportunityMapping): PreparedOpportunityUpsert | undefined {
  if (!input.externalOpportunityId) {
    return undefined;
  }

  return {
    provider: "gohighlevel",
    externalOpportunityId: input.externalOpportunityId,
    externalContactId: input.externalContactId,
    pipelineId: input.pipelineId,
    pipelineName: input.pipelineName ?? "unknown",
    stageId: input.stageId,
    stageName: input.stageName ?? "unknown",
    status: input.status,
    originalLeadSource: input.originalLeadSource,
    originalLeadDate: input.originalLeadDate,
    metadata: {
      sourceRaw: input.sourceRaw,
      assignedTo: input.assignedTo,
      historicalStageSource: input.historicalStageSource,
      currentStage: input.currentStage,
      reconciliationIssue: input.reconciliationIssue
    }
  };
}
