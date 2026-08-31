import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

/**
 * Never throws. The LLM credentials are deliberately not a boot dependency —
 * an unconfigured key must degrade to "agents can't talk" rather than taking
 * the whole town offline.
 */
function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),

  /** `vendor:model`. Empty falls back to the catalog's own default. */
  townDefaultModel: optional("TOWN_DEFAULT_MODEL"),
};

/**
 * Raw vendor credentials. Read by `runtime/providers/catalog.ts`, which is the
 * only place that decides what a missing key means — this module just reports
 * what is in the environment.
 */
export function readVendorEnv(prefix: string): {
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  return {
    apiKey: optional(`${prefix}_API_KEY`).trim(),
    baseUrl: optional(`${prefix}_BASE_URL`).trim(),
    model: optional(`${prefix}_MODEL`).trim(),
  };
}
