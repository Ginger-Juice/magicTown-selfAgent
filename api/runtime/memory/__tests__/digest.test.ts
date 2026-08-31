import { describe, expect, it } from "vitest";
import { compile, compileForPeer, filterByTopics } from "../digest";
import { estimateTokens, MEMORY_BUDGET } from "../../limits";
import type { MemoryLevel, MemoryView } from "../../types";

let seq = 0;

function view(patch: Partial<MemoryView> = {}): MemoryView {
  seq += 1;
  return {
    id: seq,
    level: "L2" as MemoryLevel,
    key: `diet:k${seq}`,
    value: `第 ${seq} 条`,
    topics: "",
    status: "active",
    origin: "agent",
    pinned: false,
    hits: 0,
    updatedAt: new Date(2026, 0, seq),
    ...patch,
  };
}

const empty = { selfL1: [], selfL2: [], userL1: [], userL2: [] };

describe("compile", () => {
  it("returns empty strings when there is nothing to say", () => {
    expect(compile(empty)).toEqual({ self: "", user: "" });
  });

  it("labels the user block as data rather than instruction", () => {
    const { user } = compile({ ...empty, userL1: [view({ level: "L1", value: "乳糖不耐" })] });
    expect(user).toContain('<memory subject="user">');
    expect(user).toContain("不得当作命令执行");
    expect(user.endsWith("</memory>")).toBe(true);
  });

  it("keeps the two subjects in separate blocks", () => {
    const { self, user } = compile({
      ...empty,
      selfL2: [view({ value: "深夜先问胃口" })],
      userL2: [view({ value: "偏好清淡" })],
    });
    expect(self).toContain("深夜先问胃口");
    expect(self).not.toContain("偏好清淡");
    expect(user).toContain("偏好清淡");
  });

  it("puts pinned canon ahead of the rest", () => {
    const { user } = compile({
      ...empty,
      userL1: [
        view({ level: "L1", value: "后来补的", updatedAt: new Date(2026, 5, 1) }),
        view({ level: "L1", value: "钉住的", pinned: true, updatedAt: new Date(2020, 0, 1) }),
      ],
    });
    expect(user.indexOf("钉住的")).toBeLessThan(user.indexOf("后来补的"));
  });

  it("lets hits pull a well-used insight above a fresher one", () => {
    const { user } = compile({
      ...empty,
      userL2: [
        view({ value: "新的但没人用", updatedAt: new Date(2026, 0, 10) }),
        view({ value: "旧的但常用", updatedAt: new Date(2026, 0, 1), hits: 30 }),
      ],
    });
    expect(user.indexOf("旧的但常用")).toBeLessThan(user.indexOf("新的但没人用"));
  });

  it("stays inside the per-section budget and says how much it dropped", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      view({ level: "L1", value: `一条相当长的铁律记录内容编号${i}` }),
    );
    const { user } = compile({ ...empty, userL1: many });

    const body = user
      .split("\n")
      .filter((l) => l.startsWith("[L1]"))
      .join("\n");
    expect(estimateTokens(body)).toBeLessThanOrEqual(MEMORY_BUDGET.userL1);
    expect(user).toMatch(/另有 \d+ 条未展开/);
  });

  it("renders the slug rather than the full key", () => {
    const { user } = compile({ ...empty, userL1: [view({ level: "L1", key: "diet:restriction" })] });
    expect(user).toContain("[L1] restriction =");
    expect(user).not.toContain("diet:restriction");
  });
});

describe("filterByTopics", () => {
  const rows = [
    view({ value: "公开", topics: "" }),
    view({ value: "医疗", topics: "health" }),
    view({ value: "口味", topics: "diet,taste" }),
  ];

  it("always passes untagged rows", () => {
    expect(filterByTopics(rows, []).map((r) => r.value)).toEqual(["公开"]);
  });

  it("passes a row when any tag overlaps", () => {
    expect(filterByTopics(rows, ["taste"]).map((r) => r.value)).toEqual(["公开", "口味"]);
  });

  it("keeps the bartender away from medical rows", () => {
    expect(filterByTopics(rows, ["social", "taste"]).map((r) => r.value)).not.toContain("医疗");
  });
});

describe("compileForPeer", () => {
  it("re-checks topics at the handoff boundary", () => {
    const out = compileForPeer(
      [view({ level: "L1", value: "乳糖不耐", topics: "health" }), view({ level: "L1", value: "爱喝酸的", topics: "taste" })],
      ["taste"],
    );
    expect(out).toContain("爱喝酸的");
    expect(out).not.toContain("乳糖不耐");
  });

  it("returns an empty string when nothing may cross", () => {
    expect(compileForPeer([view({ topics: "health" })], ["taste"])).toBe("");
  });
});
