import { describe, expect, it } from "vitest";
import { check, selfIntroducedNames } from "../deidentify";
import type { DeidentifyContext } from "../deidentify";

const ctx: DeidentifyContext = {
  displayName: "Ada",
  email: "lovelace@example.com",
  userId: 42,
  transcript: "访客：我叫小满，晚上老想吃甜的。\n你：记下了。",
};

function reasonFor(value: string): string | null {
  const result = check(value, ctx);
  return result.ok ? null : result.reason;
}

describe("deidentify.check", () => {
  it("passes a genuinely general piece of craft knowledge", () => {
    expect(check("访客深夜问宵夜时，先问有没有胃病比直接推荐更有用。", ctx)).toEqual({ ok: true });
  });

  it("rejects the visitor's display name", () => {
    expect(reasonFor("Ada 每次都点无糖的。")).toBe("contains_display_name");
  });

  it("matches the display name case-insensitively", () => {
    expect(reasonFor("ada 更喜欢清淡口味。")).toBe("contains_display_name");
  });

  it("does not trip on a longer word that merely contains the name", () => {
    expect(check("适度的 adaptation 有助于养成习惯。", ctx)).toEqual({ ok: true });
  });

  it("rejects the email local part", () => {
    expect(reasonFor("联系 lovelace 确认口味。")).toBe("contains_email_local_part");
  });

  it("rejects the full email", () => {
    expect(reasonFor("写信给 lovelace@example.com。")).toBe("contains_email_local_part");
  });

  it("rejects a bare visitor id", () => {
    expect(reasonFor("第 42 位访客偏好清淡。")).toBe("contains_user_id");
  });

  it("does not trip on a number that merely embeds the id", () => {
    expect(check("一杯水大约 420 毫升。", ctx)).toEqual({ ok: true });
  });

  it("rejects a name the visitor introduced themselves by", () => {
    expect(reasonFor("小满 喜欢深夜的甜食。")).toBe("contains_self_introduced_name");
  });

  it.each([
    ["2026-08-30 那天客人特别多。", "iso"],
    ["2026年8月30日 晚上很忙。", "chinese full"],
    ["8月30日 的推荐很受欢迎。", "chinese short"],
    ["记得 8/30 那次的配方。", "slash"],
  ])("rejects a concrete date (%s)", (value) => {
    expect(reasonFor(value)).toBe("contains_concrete_date");
  });

  it("rejects an empty value", () => {
    expect(reasonFor("   ")).toBe("empty");
  });

  it("keeps a relative time reference, which carries no identity", () => {
    expect(check("深夜时段的访客更需要清淡的选择。", ctx)).toEqual({ ok: true });
  });
});

describe("selfIntroducedNames", () => {
  it("pulls names out of Chinese self-introductions", () => {
    expect(selfIntroducedNames("我叫小满。叫我阿满就好。")).toEqual(
      expect.arrayContaining(["小满", "阿满"]),
    );
  });

  it("pulls names out of English self-introductions", () => {
    expect(selfIntroducedNames("Hi, my name is Grace. Call me Gracie.")).toEqual(
      expect.arrayContaining(["Grace", "Gracie"]),
    );
  });

  it("returns nothing when nobody introduced themselves", () => {
    expect(selfIntroducedNames("今天天气不错。")).toEqual([]);
  });
});
