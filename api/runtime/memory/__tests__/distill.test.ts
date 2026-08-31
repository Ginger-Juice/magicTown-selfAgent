import { describe, expect, it } from "vitest";
import { parseDistilled } from "../distill";

describe("parseDistilled", () => {
  it("splits the two sections", () => {
    const out = parseDistilled(
      ["USER:", "- 偏好清淡", "- 晚上不喝咖啡", "SELF:", "- 深夜先问胃口再推荐"].join("\n"),
    );
    expect(out.user).toEqual(["偏好清淡", "晚上不喝咖啡"]);
    expect(out.self).toEqual(["深夜先问胃口再推荐"]);
  });

  it("accepts a full-width colon", () => {
    const out = parseDistilled("USER：\n- 偏好清淡");
    expect(out.user).toEqual(["偏好清淡"]);
  });

  it("accepts a bullet on the same line as the header", () => {
    const out = parseDistilled("USER: - 偏好清淡\nSELF: - 先问再推荐");
    expect(out).toEqual({ user: ["偏好清淡"], self: ["先问再推荐"] });
  });

  it("treats 无 as nothing to record", () => {
    const out = parseDistilled("USER:\n- 无\nSELF:\n- 无");
    expect(out).toEqual({ user: [], self: [] });
  });

  it("ignores prose outside a bullet", () => {
    const out = parseDistilled(
      ["好的，我总结一下。", "USER:", "- 偏好清淡", "这些应该够了。"].join("\n"),
    );
    expect(out.user).toEqual(["偏好清淡"]);
  });

  it("drops bullets that appear before any section header", () => {
    expect(parseDistilled("- 无主的一条\nUSER:\n- 有主的一条").user).toEqual(["有主的一条"]);
  });

  it("caps each section at its budget", () => {
    const out = parseDistilled(
      [
        "USER:",
        ...Array.from({ length: 8 }, (_, i) => `- u${i}`),
        "SELF:",
        ...Array.from({ length: 8 }, (_, i) => `- s${i}`),
      ].join("\n"),
    );
    expect(out.user).toHaveLength(3);
    expect(out.self).toHaveLength(2);
  });

  it("returns empty sections for an empty reply", () => {
    expect(parseDistilled("")).toEqual({ user: [], self: [] });
  });

  it("is case-insensitive about the headers", () => {
    expect(parseDistilled("user:\n- 一条").user).toEqual(["一条"]);
  });
});
