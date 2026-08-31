import { describe, expect, it } from "vitest";
import { canForget, decideWrite } from "../policy";
import { LIMITS } from "../../limits";
import type { PolicyContext, WriteRequest } from "../policy";
import type { MemorySubject } from "../../types";

const userSubject: MemorySubject = { type: "user", id: 42 };
const agentSubject: MemorySubject = { type: "agent", id: 3 };

const ctx: PolicyContext = {
  slots: [
    { key: "diet:restriction", desc: "忌口", topics: "diet,health" },
    { key: "diet:goal", desc: "目标", topics: "diet" },
  ],
};

function req(patch: Partial<WriteRequest>): WriteRequest {
  return {
    subject: userSubject,
    level: "L2",
    key: "diet:pattern",
    value: "晚饭后想吃甜的。",
    origin: "agent",
    ...patch,
  };
}

function allowed(decision: ReturnType<typeof decideWrite>) {
  if (!decision.allowed) throw new Error(`expected allow, got ${decision.reason}`);
  return decision.write;
}

function reason(decision: ReturnType<typeof decideWrite>): string {
  if (decision.allowed) throw new Error("expected deny");
  return decision.reason;
}

describe("decideWrite", () => {
  it("rejects a key that does not follow prefix:slug", () => {
    expect(reason(decideWrite(req({ key: "no-prefix" }), ctx))).toBe("invalid_key");
    expect(reason(decideWrite(req({ key: "Diet:Goal" }), ctx))).toBe("invalid_key");
  });

  it("rejects a blank value", () => {
    expect(reason(decideWrite(req({ value: "  " }), ctx))).toBe("empty_value");
  });

  it("forces an agent-authored canon write into proposed, whatever it asked for", () => {
    const write = allowed(
      decideWrite(req({ level: "L1", key: "diet:restriction", status: "active" }), ctx),
    );
    expect(write.status).toBe("proposed");
    expect(write.topics).toBe("diet,health");
  });

  it("rejects a canon proposal outside the agent's declared slots", () => {
    expect(reason(decideWrite(req({ level: "L1", key: "code:style" }), ctx))).toBe(
      "key_not_in_slots",
    );
  });

  it("rejects any canon proposal from an agent with no slots", () => {
    expect(
      reason(decideWrite(req({ level: "L1", key: "diet:restriction" }), { slots: [] })),
    ).toBe("no_proposal_rights");
  });

  it("lets the user write canon directly, pinned and active", () => {
    const write = allowed(
      decideWrite(req({ level: "L1", key: "diet:restriction", origin: "user" }), ctx),
    );
    expect(write.status).toBe("active");
    expect(write.pinned).toBe(true);
  });

  it("never lets the runtime invent canon", () => {
    expect(
      reason(decideWrite(req({ level: "L1", key: "diet:goal", origin: "system" }), ctx)),
    ).toBe("system_cannot_write_canon");
  });

  it("writes insights active without an approval round", () => {
    const write = allowed(decideWrite(req({ level: "L2" }), ctx));
    expect(write.status).toBe("active");
    expect(write.expiresAt).toBeInstanceOf(Date);
  });

  it("rejects an insight submitted as a proposal", () => {
    expect(reason(decideWrite(req({ level: "L2", status: "proposed" }), ctx))).toBe(
      "insights_need_no_approval",
    );
  });

  it("keeps canon and session rows free of a TTL", () => {
    const canon = allowed(
      decideWrite(req({ level: "L1", key: "diet:goal", origin: "user" }), ctx),
    );
    expect(canon.expiresAt).toBeNull();
  });

  it("reserves L3 for the runtime and requires a conversation", () => {
    expect(reason(decideWrite(req({ level: "L3", key: "session:rolling" }), ctx))).toBe(
      "l3_requires_conversation",
    );
    expect(
      reason(decideWrite(req({ level: "L3", key: "session:rolling", conversationId: 9 }), ctx)),
    ).toBe("l3_is_runtime_only");
    const write = allowed(
      decideWrite(
        req({ level: "L3", key: "session:rolling", conversationId: 9, origin: "system" }),
        ctx,
      ),
    );
    expect(write.conversationId).toBe(9);
  });

  it("refuses to give an agent subject a session row", () => {
    expect(
      reason(
        decideWrite(
          req({ subject: agentSubject, level: "L3", key: "session:rolling", conversationId: 9 }),
          ctx,
        ),
      ),
    ).toBe("agent_subject_has_no_session");
  });

  it("strips the conversation from an agent-subject write", () => {
    const write = allowed(
      decideWrite(req({ subject: agentSubject, level: "L2", conversationId: 9 }), ctx),
    );
    expect(write.conversationId).toBeNull();
    expect(write.memoKey).toBe("agent:3:0:diet:pattern");
  });

  it("builds a memoKey that separates subjects, conversations, and keys", () => {
    const a = allowed(decideWrite(req({ conversationId: 1 }), ctx));
    const b = allowed(decideWrite(req({ conversationId: 2 }), ctx));
    expect(a.memoKey).not.toBe(b.memoKey);
    expect(a.memoKey).toBe("user:42:1:diet:pattern");
  });

  it("truncates an oversized value instead of rejecting it", () => {
    const write = allowed(decideWrite(req({ value: "字".repeat(5000) }), ctx));
    expect(write.value.endsWith("…（已截断）")).toBe(true);
    expect(new TextEncoder().encode(write.value).length).toBeLessThanOrEqual(
      LIMITS.memoryMaxValueBytes,
    );
  });
});

describe("canForget", () => {
  it("lets an agent drop its own insights but never canon", () => {
    expect(canForget("L2", "agent")).toBe(true);
    expect(canForget("L3", "system")).toBe(true);
    expect(canForget("L1", "agent")).toBe(false);
  });

  it("lets the user drop anything they own", () => {
    expect(canForget("L1", "user")).toBe(true);
  });
});
