import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadDotEnv();

export type AppConfig = {
  nodeEnv: string;
  port: number;
  host: string;
  webhookPathSecret: string;
  databaseUrl?: string;
  sweepgoApiToken?: string;
  sweepgoBaseUrl: string;
  dailyDashboardEnabled: boolean;
  dailyDashboardRecipient: string;
  dailyDashboardFrom?: string;
  dailyDashboardTimeZone: string;
  smtpHost?: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  goHighLevelWebhookSecret?: string;
  goHighLevelPrivateIntegrationToken?: string;
  goHighLevelApiBaseUrl: string;
  goHighLevelApiVersion: string;
  goHighLevelLocationId?: string;
  goHighLevelPipelineId?: string;
  goHighLevelPipelineName: string;
  goHighLevelFacebookStageId?: string;
  goHighLevelFacebookStageName: string;
  goHighLevelWebsiteStageId?: string;
  goHighLevelWebsiteStageName: string;
  gmailWebhookSecret?: string;
  metaAdsWebhookSecret?: string;
  metaAccessToken?: string;
  metaAdAccountId?: string;
  metaApiVersion: string;
  metaApiBaseUrl: string;
  metaAppId?: string;
  metaAppSecret?: string;
  metaBusinessId?: string;
  googleAdsWebhookSecret?: string;
  googleAdsDeveloperToken?: string;
  googleAdsCustomerId?: string;
  googleAdsLoginCustomerId?: string;
  googleAdsClientId?: string;
  googleAdsClientSecret?: string;
  googleAdsRefreshToken?: string;
  googleAdsApiVersion: string;
  googleAdsApiBaseUrl: string;
  googleAdsOAuthTokenUrl: string;
  dashboardPassword?: string;
};

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requiredEnv(name: string, fallback?: string): string {
  const value = optionalEnv(name) ?? fallback;
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = optionalEnv(name);
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function numberEnv(name: string, fallback: number): number {
  const value = optionalEnv(name);
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return Math.floor(parsed);
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 3000),
    host: "0.0.0.0",
    webhookPathSecret: requiredEnv("WEBHOOK_PATH_SECRET", "local-dev-secret"),
    databaseUrl: optionalEnv("DATABASE_URL"),
    sweepgoApiToken: optionalEnv("SWEEPGO_API_TOKEN"),
    sweepgoBaseUrl: requiredEnv("SWEEPGO_BASE_URL", "https://openapi.sweepandgo.com").replace(/\/+$/, ""),
    dailyDashboardEnabled: booleanEnv("DAILY_DASHBOARD_ENABLED", false),
    dailyDashboardRecipient: requiredEnv("DAILY_DASHBOARD_RECIPIENT", "bryan@doodoopatrol.com"),
    dailyDashboardFrom: optionalEnv("DAILY_DASHBOARD_FROM") ?? optionalEnv("SMTP_FROM"),
    dailyDashboardTimeZone: requiredEnv("DAILY_DASHBOARD_TIME_ZONE", "America/Phoenix"),
    smtpHost: optionalEnv("SMTP_HOST"),
    smtpPort: numberEnv("SMTP_PORT", 587),
    smtpSecure: booleanEnv("SMTP_SECURE", false),
    smtpUser: optionalEnv("SMTP_USER"),
    smtpPassword: optionalEnv("SMTP_PASSWORD"),
    goHighLevelWebhookSecret: optionalEnv("GOHIGHLEVEL_WEBHOOK_SECRET"),
    goHighLevelPrivateIntegrationToken: optionalEnv("GHL_PRIVATE_INTEGRATION_TOKEN"),
    goHighLevelApiBaseUrl: requiredEnv("GHL_API_BASE_URL", "https://services.leadconnectorhq.com").replace(/\/+$/, ""),
    goHighLevelApiVersion: requiredEnv("GHL_API_VERSION", "2021-07-28"),
    goHighLevelLocationId: optionalEnv("GHL_LOCATION_ID") ?? optionalEnv("GOHIGHLEVEL_LOCATION_ID"),
    goHighLevelPipelineId: optionalEnv("GHL_PIPELINE_ID"),
    goHighLevelPipelineName: optionalEnv("GHL_PIPELINE_NAME") ?? optionalEnv("GOHIGHLEVEL_PIPELINE_NAME") ?? "Fresh Leads to Onboarding",
    goHighLevelFacebookStageId: optionalEnv("GHL_FACEBOOK_STAGE_ID"),
    goHighLevelFacebookStageName: optionalEnv("GHL_FACEBOOK_STAGE_NAME") ?? optionalEnv("GOHIGHLEVEL_STAGE_FACEBOOK_NEW_LEAD") ?? "Facebook New Lead",
    goHighLevelWebsiteStageId: optionalEnv("GHL_WEBSITE_STAGE_ID"),
    goHighLevelWebsiteStageName: optionalEnv("GHL_WEBSITE_STAGE_NAME") ?? optionalEnv("GOHIGHLEVEL_STAGE_WEBSITE_QUOTE_LEAD") ?? "Website Quote Lead",
    gmailWebhookSecret: optionalEnv("GMAIL_WEBHOOK_SECRET"),
    metaAdsWebhookSecret: optionalEnv("META_ADS_WEBHOOK_SECRET"),
    metaAccessToken: optionalEnv("META_ACCESS_TOKEN"),
    metaAdAccountId: optionalEnv("META_AD_ACCOUNT_ID") ?? optionalEnv("META_ADS_ACCOUNT_ID"),
    metaApiVersion: requiredEnv("META_API_VERSION", "v23.0"),
    metaApiBaseUrl: requiredEnv("META_API_BASE_URL", "https://graph.facebook.com").replace(/\/+$/, ""),
    metaAppId: optionalEnv("META_APP_ID"),
    metaAppSecret: optionalEnv("META_APP_SECRET"),
    metaBusinessId: optionalEnv("META_BUSINESS_ID"),
    googleAdsWebhookSecret: optionalEnv("GOOGLE_ADS_WEBHOOK_SECRET"),
    googleAdsDeveloperToken: optionalEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
    googleAdsCustomerId: optionalEnv("GOOGLE_ADS_CUSTOMER_ID"),
    googleAdsLoginCustomerId: optionalEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID") ?? optionalEnv("GOOGLE_ADS_MANAGER_CUSTOMER_ID"),
    googleAdsClientId: optionalEnv("GOOGLE_ADS_CLIENT_ID"),
    googleAdsClientSecret: optionalEnv("GOOGLE_ADS_CLIENT_SECRET"),
    googleAdsRefreshToken: optionalEnv("GOOGLE_ADS_REFRESH_TOKEN"),
    googleAdsApiVersion: requiredEnv("GOOGLE_ADS_API_VERSION", "v24"),
    googleAdsApiBaseUrl: requiredEnv("GOOGLE_ADS_API_BASE_URL", "https://googleads.googleapis.com").replace(/\/+$/, ""),
    googleAdsOAuthTokenUrl: requiredEnv("GOOGLE_ADS_OAUTH_TOKEN_URL", "https://oauth2.googleapis.com/token"),
    dashboardPassword: optionalEnv("DASHBOARD_PASSWORD")
  };
}

function loadDotEnv() {
  const configDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    process.env.SWEEPGO_ENV_FILE,
    path.resolve(process.cwd(), ".env"),
    path.resolve(configDir, "../.env")
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const envPath of candidatePaths) {
    loadDotEnvFile(envPath);
  }
}

function loadDotEnvFile(envPath: string) {
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
