import { describe, expect, it, vi } from "vitest";
import type { agents } from "@db/schema";
import { buildSystemPrompt } from "../prompt";
import { KIND_PRESETS, toDefinition } from "../registry";
import { coachingPack } from "../knowledge";
import { TOWN_TOOLS } from "../tools/town";
import { ToolRegistry } from "../tools/registry";
import { makeContext, scriptedProvider } from "./helpers";

vi.mock("../memory/store", () => ({
  listLive: vi.fn(async () => []),
}));

function row(
  patch: Partial<typeof agents.$inferSelect> = {}
): typeof agents.$inferSelect {
  return {
    id: 3,
    ownerUserId: null,
    kind: "divination",
    slug: "divination",
    name: "驻塔巫师",
    persona: "神秘但坦率。",
    toolIds: "[]",
    landmarkId: "magic-house",
    provider: "builtin",
    providerOptions: "{}",
    capabilityTags: "[]",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...patch,
  };
}

describe("toDefinition skills", () => {
  it("loads diet, fitness, and divination playbooks from the kind preset", () => {
    expect(
      toDefinition(row({ kind: "divination", slug: "divination" })).skills.map(
        s => s.id
      )
    ).toEqual(["divination.three-card"]);
    expect(
      toDefinition(row({ kind: "fitness", slug: "fitness" })).skills.map(
        s => s.id
      )
    ).toEqual(["fitness.beginner-plan"]);
    expect(
      toDefinition(row({ kind: "diet", slug: "diet" })).skills.map(s => s.id)
    ).toEqual(["diet.plate-coach"]);
  });

  it("leaves kinds without a playbook empty, and does not read Cursor skill seeds", () => {
    expect(toDefinition(row({ kind: "work", slug: "work" })).skills).toEqual(
      []
    );
    const diet = toDefinition(
      row({
        kind: "diet",
        slug: "diet",
        providerOptions: JSON.stringify({
          skills: [{ name: "review", body: "看 diff" }],
        }),
      })
    );
    expect(diet.skills.map(s => s.id)).toEqual(["diet.plate-coach"]);
    expect(diet.skills.some(s => s.body.includes("看 diff"))).toBe(false);
  });

  it("keeps ethics on selfCanon and the short voice on persona", () => {
    const diet = toDefinition(
      row({ kind: "diet", slug: "diet", persona: "语气温和，务实。" })
    );
    expect(diet.selfCanon).toEqual(KIND_PRESETS.diet.selfCanon);
    expect(diet.persona).toBe("语气温和，务实。");
    expect(diet.selfCanon.join("\n")).not.toContain("土豆");
    expect(diet.persona).not.toContain("土豆");
  });
});

describe("buildSystemPrompt skill injection", () => {
  it("inserts a matching playbook after self memory and before user memory", () => {
    const prompt = buildSystemPrompt({
      definition: toDefinition(row()),
      userMessage: "帮我抽一张塔罗牌",
      memoryBlocks: { self: "SELF_BLOCK", user: "USER_BLOCK" },
    });
    const personaAt = prompt.indexOf("神秘但坦率");
    const selfAt = prompt.indexOf("SELF_BLOCK");
    const skillAt = prompt.indexOf("先 draw_tarot");
    const userAt = prompt.indexOf("USER_BLOCK");
    expect(personaAt).toBeGreaterThanOrEqual(0);
    expect(personaAt).toBeLessThan(selfAt);
    expect(selfAt).toBeLessThan(skillAt);
    expect(skillAt).toBeLessThan(userAt);
    expect(userAt).toBeLessThan(prompt.indexOf("找别人帮忙的规矩"));
  });

  it("skips the playbook when the line is off-topic or hits notFor", () => {
    const definition = toDefinition(
      row({ kind: "fitness", slug: "fitness", persona: "有耐心的老教练。" })
    );
    const quiet = buildSystemPrompt({
      definition,
      userMessage: "今天雾很大",
      memoryBlocks: { self: "", user: "" },
    });
    expect(quiet).not.toContain("suggest_plan");
    expect(quiet).toContain("不开康复处方");

    const blocked = buildSystemPrompt({
      definition,
      userMessage: "骨折了怎么练",
      memoryBlocks: { self: "", user: "" },
    });
    expect(blocked).not.toContain("suggest_plan");
  });

  it("points at the dish tool without pasting the plate encyclopedia", () => {
    const prompt = buildSystemPrompt({
      definition: toDefinition(
        row({ kind: "diet", slug: "diet", persona: "语气温和。" })
      ),
      userMessage: "这一餐吃什么好",
      memoryBlocks: { self: "", user: "" },
    });
    expect(prompt).toContain("topic 填 plate");
    expect(prompt).toContain("不做医疗诊断");
    expect(prompt).not.toContain("土豆");
  });
});

describe("suggest_plan knowledge", () => {
  it("returns the coaching pack alongside the split", async () => {
    const tool = new ToolRegistry()
      .register(...TOWN_TOOLS)
      .get("suggest_plan")!;
    const outcome = await tool.execute(
      { daysPerWeek: 3 },
      makeContext(scriptedProvider([[]]), { userMessage: "新手怎么练" })
    );
    expect(outcome.data).toMatchObject({
      daysPerWeek: 3,
      knowledge: {
        domain: "fitness",
        principles: coachingPack.principles,
        sample_week: coachingPack.sample_week,
      },
    });
  });
});
