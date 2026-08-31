import { describe, expect, it } from "vitest";
import { clampValue, defaultExpiry, isValidKey, keyPrefix, memoKey, topicsAllow } from "../keys";
import { LIMITS } from "../../limits";

describe("isValidKey", () => {
  it.each(["diet:restriction", "session:rolling", "code:style.ts", "work:cadence-am"])(
    "accepts %s",
    (key) => expect(isValidKey(key)).toBe(true),
  );

  it.each(["nocolon", "Diet:Goal", ":slug", "diet:", "a:b", "diet:滋味"])(
    "rejects %s",
    (key) => expect(isValidKey(key)).toBe(false),
  );
});

describe("keyPrefix", () => {
  it("returns everything up to and including the colon", () => {
    expect(keyPrefix("diet:restriction")).toBe("diet:");
  });

  it("returns an empty string when there is no colon", () => {
    expect(keyPrefix("broken")).toBe("");
  });
});

describe("memoKey", () => {
  it("collapses a null conversation to 0 so the unique index still bites", () => {
    expect(memoKey({ type: "user", id: 4 }, null, "diet:goal")).toBe("user:4:0:diet:goal");
    expect(memoKey({ type: "user", id: 4 }, undefined, "diet:goal")).toBe("user:4:0:diet:goal");
  });

  it("separates subjects of the same id", () => {
    expect(memoKey({ type: "user", id: 4 }, null, "k:v")).not.toBe(
      memoKey({ type: "agent", id: 4 }, null, "k:v"),
    );
  });
});

describe("topicsAllow", () => {
  it("treats an untagged row as public", () => {
    expect(topicsAllow("", [])).toBe(true);
  });

  it("needs one overlapping tag", () => {
    expect(topicsAllow("health,diet", ["diet"])).toBe(true);
    expect(topicsAllow("health", ["diet"])).toBe(false);
  });

  it("ignores case and stray spaces", () => {
    expect(topicsAllow(" Health , diet ", ["HEALTH"])).toBe(true);
  });
});

describe("defaultExpiry", () => {
  it("gives insights a TTL and leaves canon permanent", () => {
    const now = new Date(2026, 0, 1);
    expect(defaultExpiry("L1", now)).toBeNull();
    expect(defaultExpiry("L3", now)).toBeNull();
    const l2 = defaultExpiry("L2", now);
    expect(l2).not.toBeNull();
    expect(l2!.getTime() - now.getTime()).toBe(LIMITS.memoryL2TtlDays * 86_400_000);
  });
});

describe("clampValue", () => {
  it("leaves a short value untouched", () => {
    expect(clampValue("短的")).toBe("短的");
  });

  it("truncates on bytes, not characters, and marks the cut", () => {
    const out = clampValue("字".repeat(2000));
    expect(out.endsWith("…（已截断）")).toBe(true);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(LIMITS.memoryMaxValueBytes);
  });
});
