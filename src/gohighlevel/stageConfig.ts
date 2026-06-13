export type GoHighLevelStageConfig = {
  locationId?: string;
  pipelineId?: string;
  pipelineName: string;
  facebookNewLeadStageId?: string;
  facebookNewLeadStageName: string;
  websiteQuoteLeadStageId?: string;
  websiteQuoteLeadStageName: string;
};

export function loadGoHighLevelStageConfig(env: NodeJS.ProcessEnv = process.env): GoHighLevelStageConfig {
  return {
    locationId: optional(env.GHL_LOCATION_ID) ?? optional(env.GOHIGHLEVEL_LOCATION_ID),
    pipelineId: optional(env.GHL_PIPELINE_ID),
    pipelineName: optional(env.GHL_PIPELINE_NAME) ?? optional(env.GOHIGHLEVEL_PIPELINE_NAME) ?? "Fresh Leads to Onboarding",
    facebookNewLeadStageId: optional(env.GHL_FACEBOOK_STAGE_ID),
    facebookNewLeadStageName: optional(env.GHL_FACEBOOK_STAGE_NAME) ?? optional(env.GOHIGHLEVEL_STAGE_FACEBOOK_NEW_LEAD) ?? "Facebook New Lead",
    websiteQuoteLeadStageId: optional(env.GHL_WEBSITE_STAGE_ID),
    websiteQuoteLeadStageName: optional(env.GHL_WEBSITE_STAGE_NAME) ?? optional(env.GOHIGHLEVEL_STAGE_WEBSITE_QUOTE_LEAD) ?? "Website Quote Lead"
  };
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
