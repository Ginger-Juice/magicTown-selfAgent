import { afterEach, beforeEach, describe, expect, it } from "vitest";

const VENDOR_KEYS = [
  "DEEPSEEK_API_KEY",
  "MOONSHOTAI_API_KEY",
  "ZAI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
];

const OVERRIDES = [
  ...VENDOR_KEYS,
  "DEEPSEEK_MODEL",
  "DEEPSEEK_BASE_URL",
  "ZAI_MODEL",
  "TOWN_DEFAULT_MODEL",
];

let saved: Record<string, string | undefined> = {};

/**
 * The catalog reads `process.env` on every call rather than at import time,
 * so these tests can rewrite the environment without resetting modules.
 */
async function catalog() {
  return import("../catalog");
}

beforeEach(() => {
  saved = Object.fromEntries(OVERRIDES.map((k) => [k, process.env[k]]));
  // Windows cannot `delete` process.env entries; blank them instead.
  for (const key of OVERRIDES) process.env[key] = "";
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("availableVendors", () => {
  it("hides every vendor when no key is set", async () => {
    const { availableVendors, hasAnyCredentials } = await catalog();
    expect(availableVendors()).toEqual([]);
    expect(hasAnyCredentials()).toBe(false);
  });

  it("shows only the vendors that have a key", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-a";
    process.env.ZAI_API_KEY = "sk-b";
    const { availableVendors } = await catalog();
    expect(availableVendors().map((v) => v.id)).toEqual(["deepseek", "zai"]);
  });

  it("treats a blank key as unset", async () => {
    process.env.OPENAI_API_KEY = "   ";
    const { availableVendors } = await catalog();
    expect(availableVendors()).toEqual([]);
  });
});

describe("resolveModel", () => {
  it("returns null when nothing is configured", async () => {
    const { resolveModel } = await catalog();
    expect(resolveModel("deepseek:deepseek-chat")).toBeNull();
  });

  it("defaults to deepseek when the visitor expressed no preference", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-a";
    process.env.ZAI_API_KEY = "sk-b";
    const { resolveModel } = await catalog();
    expect(resolveModel()?.id).toBe("deepseek:deepseek-chat");
  });

  it("honours an explicit vendor:model", async () => {
    process.env.ZAI_API_KEY = "sk-b";
    const { resolveModel } = await catalog();
    const resolved = resolveModel("zai:glm-4.6-air");
    expect(resolved?.vendor.id).toBe("zai");
    expect(resolved?.model).toBe("glm-4.6-air");
  });

  it("accepts a bare vendor and fills in its default model", async () => {
    process.env.MOONSHOTAI_API_KEY = "sk-c";
    const { resolveModel } = await catalog();
    expect(resolveModel("moonshotai")?.id).toBe("moonshotai:kimi-k3");
  });

  it("lets an env override replace the built-in default model", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-a";
    process.env.DEEPSEEK_MODEL = "deepseek-reasoner";
    const { resolveModel } = await catalog();
    expect(resolveModel()?.id).toBe("deepseek:deepseek-reasoner");
  });

  it("lets an explicit request beat the env override", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-a";
    process.env.DEEPSEEK_MODEL = "deepseek-reasoner";
    const { resolveModel } = await catalog();
    expect(resolveModel("deepseek:deepseek-chat")?.model).toBe("deepseek-chat");
  });

  it("falls back rather than going silent when the pinned vendor lost its key", async () => {
    process.env.ZAI_API_KEY = "sk-b";
    const { resolveModel } = await catalog();
    expect(resolveModel("openai:gpt-4o")?.vendor.id).toBe("zai");
  });

  it("uses TOWN_DEFAULT_MODEL before the built-in fallback", async () => {
    process.env.ZAI_API_KEY = "sk-b";
    process.env.DEEPSEEK_API_KEY = "sk-a";
    process.env.TOWN_DEFAULT_MODEL = "zai:glm-4.6";
    const { resolveModel } = await catalog();
    expect(resolveModel()?.vendor.id).toBe("zai");
  });

  it("ignores TOWN_DEFAULT_MODEL when that vendor has no key", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-a";
    process.env.TOWN_DEFAULT_MODEL = "openai:gpt-4o";
    const { resolveModel } = await catalog();
    expect(resolveModel()?.vendor.id).toBe("deepseek");
  });

  it("strips a trailing slash off a custom base url", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-a";
    process.env.DEEPSEEK_BASE_URL = "https://proxy.example.com/v1/";
    const { resolveModel } = await catalog();
    expect(resolveModel()?.baseUrl).toBe("https://proxy.example.com/v1");
  });

  it("routes gemini through its OpenAI-compatible endpoint", async () => {
    process.env.GOOGLE_API_KEY = "sk-g";
    const { resolveModel } = await catalog();
    expect(resolveModel()?.baseUrl).toContain("/v1beta/openai");
  });
});

describe("publicCatalog", () => {
  it("never leaks a key", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-secret-value";
    const { publicCatalog } = await catalog();
    expect(JSON.stringify(publicCatalog())).not.toContain("sk-secret-value");
  });

  it("labels each configured vendor with its resolved model", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-a";
    const { publicCatalog } = await catalog();
    expect(publicCatalog()).toEqual([
      { id: "deepseek:deepseek-chat", vendor: "deepseek", label: "DeepSeek", model: "deepseek-chat" },
    ]);
  });

  it("reports the town default as a concrete id", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-a";
    process.env.ZAI_API_KEY = "sk-b";
    const { townDefaultId } = await catalog();
    expect(townDefaultId()).toBe("deepseek:deepseek-chat");
  });
});
