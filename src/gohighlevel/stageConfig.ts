export type GoHighLevelStageConfig = {
  pipelineName: string;
  facebookNewLeadStageName: string;
  websiteQuoteLeadStageName: string;
};

export function loadGoHighLevelStageConfig(env: NodeJS.ProcessEnv = process.env): GoHighLevelStageConfig {
  return {
    pipelineName: env.GOHIGHLEVEL_PIPELINE_NAME?.trim() || "Fresh Leads to Onboarding",
    facebookNewLeadStageName: env.GOHIGHLEVEL_STAGE_FACEBOOK_NEW_LEAD?.trim() || "Facebook New Lead",
    websiteQuoteLeadStageName: env.GOHIGHLEVEL_STAGE_WEBSITE_QUOTE_LEAD?.trim() || "Website Quote Lead"
  };
}
