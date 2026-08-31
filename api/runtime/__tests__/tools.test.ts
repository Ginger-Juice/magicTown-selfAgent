import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry, defineTool, toJsonSchemaTools } from "../tools/registry";
import { TOWN_TOOLS } from "../tools/town";
import { MEMORY_TOOLS } from "../tools/memory";
import { A2A_TOOLS } from "../tools/a2a";
import { slugFor } from "../tools/lib";
import { findDish, findRecipe, RECIPES } from "../tools/data";
import { KIND_PRESETS } from "../registry";
import { makeContext, scriptedProvider } from "./helpers";

const ALL = [...TOWN_TOOLS, ...MEMORY_TOOLS, ...A2A_TOOLS];
const registry = new ToolRegistry().register(...ALL);

describe("tool registry", () => {
  it("registers every tool under a unique id", () => {
    expect(new Set(ALL.map((t) => t.id)).size).toBe(ALL.length);
  });

  it("resolves every tool id declared by a kind preset", () => {
    for (const [kind, preset] of Object.entries(KIND_PRESETS)) {
      const missing = preset.toolIds.filter((id) => !registry.get(id));
      expect({ kind, missing }).toEqual({ kind, missing: [] });
    }
  });

  it("appends always-on tools without duplicating a declared one", () => {
    const resolved = registry.resolve(["log_meal", "propose_memory"], ["propose_memory"]);
    expect(resolved.map((t) => t.id)).toEqual(["log_meal", "propose_memory"]);
  });

  it("drops an unknown id rather than throwing", () => {
    expect(registry.resolve(["log_meal", "not_a_tool"]).map((t) => t.id)).toEqual(["log_meal"]);
  });
});

describe("toJsonSchemaTools", () => {
  const schemas = toJsonSchemaTools(ALL);

  it("emits one object schema per tool with no $schema key", () => {
    expect(schemas).toHaveLength(ALL.length);
    for (const s of schemas) {
      expect(s.parameters).not.toHaveProperty("$schema");
      expect(s.parameters.type).toBe("object");
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("carries the field descriptions the model needs", () => {
    const draw = schemas.find((s) => s.name === "recommend_drink");
    const props = draw?.parameters.properties as Record<string, { description?: string }>;
    expect(props.alcoholic.description).toContain("无酒精");
  });
});

describe("argument validation", () => {
  const ctx = makeContext(scriptedProvider([[]]));

  it("turns a bad argument blob into a readable result", async () => {
    const tool = registry.get("draw_tarot")!;
    const outcome = await tool.execute({ count: 99 }, ctx);
    expect(outcome.data).toMatchObject({ error: "invalid_arguments" });
  });

  it("accepts a well-formed call", async () => {
    const tool = registry.get("draw_tarot")!;
    const outcome = await tool.execute({ count: 3 }, ctx);
    expect(outcome.data).toMatchObject({ spread: "三张" });
  });
});

describe("draw_tarot", () => {
  const tool = registry.get("draw_tarot")!;
  const ctx = makeContext(scriptedProvider([[]]));

  it("never repeats a card within one draw", async () => {
    for (let i = 0; i < 50; i++) {
      const outcome = await tool.execute({ count: 5 }, ctx);
      const cards = (outcome.data as { cards: { name: string }[] }).cards;
      expect(new Set(cards.map((c) => c.name)).size).toBe(5);
    }
  });
});

describe("recommend_drink", () => {
  const tool = registry.get("recommend_drink")!;
  const ctx = makeContext(scriptedProvider([[]]));

  it("returns only mocktails when the visitor is not drinking", async () => {
    const outcome = await tool.execute({ alcoholic: false }, ctx);
    const picks = (outcome.data as { picks: { name: string }[] }).picks;
    expect(picks.length).toBeGreaterThan(0);
    for (const pick of picks) {
      expect(RECIPES.find((r) => r.name === pick.name)?.alcoholic).toBe(false);
    }
  });

  it("honours an allergen the visitor asked to avoid", async () => {
    const outcome = await tool.execute({ alcoholic: true, avoid: ["坚果"] }, ctx);
    const picks = (outcome.data as { picks: { name: string }[] }).picks;
    expect(picks.map((p) => p.name)).not.toContain("杏仁酸");
  });

  it("says so when it had to ignore the taste preference", async () => {
    const outcome = await tool.execute({ alcoholic: false, profile: "浓郁" }, ctx);
    expect(outcome.data).toMatchObject({ relaxedProfile: true });
  });
});

describe("lookup tools", () => {
  const ctx = makeContext(scriptedProvider([[]]));

  it("reports a miss instead of inventing nutrition", async () => {
    const outcome = await registry.get("lookup_dish")!.execute({ dish: "龙肝" }, ctx);
    expect(outcome.data).toMatchObject({ error: "not_found" });
  });

  it("matches a dish by its english alias", () => {
    expect(findDish("chicken breast")?.name).toBe("鸡胸肉");
  });

  it("matches a recipe by its english alias", () => {
    expect(findRecipe("virgin mojito")?.alcoholic).toBe(false);
  });

  it("returns suit theme for a minor arcana card", async () => {
    const outcome = await registry.get("lookup_card")!.execute({ name: "圣杯三" }, ctx);
    expect(outcome.data).toMatchObject({ arcana: "小阿卡纳", suit: "圣杯" });
  });
});

describe("slugFor", () => {
  it("keeps latin titles readable", () => {
    expect(slugFor("Refactor the Loop")).toBe("refactor-the-loop");
  });

  it("hashes CJK titles into a valid key segment", () => {
    const slug = slugFor("周五前交周报");
    expect(slug).toMatch(/^h[a-z0-9]+$/);
  });

  it("is stable for the same title", () => {
    expect(slugFor("周五前交周报")).toBe(slugFor("周五前交周报"));
  });

  it("separates different titles", () => {
    expect(slugFor("周五前交周报")).not.toBe(slugFor("周一前交周报"));
  });
});

describe("defineTool", () => {
  it("passes parsed arguments through, not the raw blob", async () => {
    let seen: unknown = null;
    const tool = defineTool({
      id: "probe",
      description: "probe",
      parameters: z.object({ n: z.coerce.number() }),
      async execute(args) {
        seen = args;
        return { data: {} };
      },
    });

    await tool.execute({ n: "5" }, makeContext(scriptedProvider([[]])));
    expect(seen).toEqual({ n: 5 });
  });
});
