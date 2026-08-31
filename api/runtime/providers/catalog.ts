import { readVendorEnv } from "../../lib/env";

/**
 * Every vendor here speaks the OpenAI chat-completions protocol, including
 * Gemini through its compatibility endpoint. That is the whole reason there is
 * one provider implementation instead of five.
 *
 * The default model ids are starting points, not gospel — each one can be
 * overridden with `<PREFIX>_MODEL` without touching this file.
 */
export type VendorId = "deepseek" | "moonshotai" | "zai" | "google" | "openai";

export type Vendor = {
  id: VendorId;
  label: string;
  /** Environment prefix, e.g. `DEEPSEEK` reads `DEEPSEEK_API_KEY`. */
  prefix: string;
  defaultBaseUrl: string;
  defaultModel: string;
};

export const VENDORS: Vendor[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    prefix: "DEEPSEEK",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
  },
  {
    id: "moonshotai",
    label: "Kimi",
    prefix: "MOONSHOTAI",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k3",
  },
  {
    id: "zai",
    label: "GLM",
    prefix: "ZAI",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
    defaultModel: "glm-5.2",
  },
  {
    id: "google",
    label: "Gemini",
    prefix: "GOOGLE",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
  },
  {
    id: "openai",
    label: "OpenAI",
    prefix: "OPENAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
  },
];

export const FALLBACK_VENDOR: VendorId = "deepseek";

export type ResolvedModel = {
  vendor: Vendor;
  model: string;
  apiKey: string;
  baseUrl: string;
  /** `vendor:model`, the form stored on the conversation. */
  id: string;
};

function vendorById(id: string): Vendor | undefined {
  return VENDORS.find((v) => v.id === id);
}

export function isConfigured(vendor: Vendor): boolean {
  return readVendorEnv(vendor.prefix).apiKey.length > 0;
}

/** Vendors the visitor may actually pick, in catalog order. */
export function availableVendors(): Vendor[] {
  return VENDORS.filter(isConfigured);
}

export function hasAnyCredentials(): boolean {
  return availableVendors().length > 0;
}

function build(vendor: Vendor, requestedModel?: string): ResolvedModel {
  const fromEnv = readVendorEnv(vendor.prefix);
  const model = requestedModel || fromEnv.model || vendor.defaultModel;
  return {
    vendor,
    model,
    apiKey: fromEnv.apiKey,
    baseUrl: (fromEnv.baseUrl || vendor.defaultBaseUrl).replace(/\/+$/, ""),
    id: `${vendor.id}:${model}`,
  };
}

/**
 * Parses `vendor:model`, `vendor`, or nothing at all. Falls through to the
 * town default and then to the first configured vendor, so a conversation
 * pinned to a vendor whose key was later removed keeps working instead of
 * going silent.
 */
export function resolveModel(requested?: string | null): ResolvedModel | null {
  const candidates = [requested, process.env.TOWN_DEFAULT_MODEL, FALLBACK_VENDOR];

  for (const candidate of candidates) {
    const spec = candidate?.trim();
    if (!spec) continue;

    const colon = spec.indexOf(":");
    const vendorId = colon === -1 ? spec : spec.slice(0, colon);
    const model = colon === -1 ? "" : spec.slice(colon + 1).trim();

    const vendor = vendorById(vendorId);
    if (!vendor || !isConfigured(vendor)) continue;
    return build(vendor, model);
  }

  const [first] = availableVendors();
  return first ? build(first) : null;
}

/** The id a new conversation should pin when the visitor has not picked yet. */
export function townDefaultId(): string | null {
  return resolveModel(null)?.id ?? null;
}

/** Safe to send to the browser: labels and model ids, never a key. */
export function publicCatalog(): {
  id: string;
  vendor: VendorId;
  label: string;
  model: string;
}[] {
  return availableVendors().map((vendor) => {
    const resolved = build(vendor);
    return {
      id: resolved.id,
      vendor: vendor.id,
      label: vendor.label,
      model: resolved.model,
    };
  });
}
