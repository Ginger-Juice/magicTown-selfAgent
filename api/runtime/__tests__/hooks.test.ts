import { describe, expect, it, vi } from "vitest";
import { createHookBus, type Hook } from "../hooks/bus";
import { createRepeatGuard, depthGuard, wallClockGuard } from "../hooks/guards";
import { LIMITS } from "../limits";
import { makeContext, scriptedProvider } from "./helpers";
import type { ToolCall } from "../types";

const ctx = () => makeContext(scriptedProvider([[]]));
const call = (name: string, args: unknown = {}): ToolCall => ({ callId: "c1", name, args });

describe("createHookBus", () => {
  it("runs every beforeTurn hook in order", async () => {
    const order: string[] = [];
    const hook = (name: string): Hook => ({
      name,
      async beforeTurn() {
        order.push(name);
      },
    });

    await createHookBus([hook("a"), hook("b")]).beforeTurn(ctx());
    expect(order).toEqual(["a", "b"]);
  });

  it("allows a tool when no hook objects", async () => {
    const bus = createHookBus([{ name: "quiet" }]);
    expect(await bus.beforeTool(ctx(), call("log_meal"))).toEqual({ allowed: true });
  });

  it("lets the first denial win and skips the rest", async () => {
    const later = vi.fn();
    const bus = createHookBus([
      { name: "deny", async beforeTool() {
        return { allowed: false, reason: "nope" };
      } },
      { name: "later", beforeTool: later },
    ]);

    expect(await bus.beforeTool(ctx(), call("log_meal"))).toEqual({
      allowed: false,
      reason: "nope",
    });
    expect(later).not.toHaveBeenCalled();
  });

  it("isolates a throwing onError hook so the real failure survives", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = vi.fn();
    const bus = createHookBus([
      { name: "bad", async onError() {
        throw new Error("hook exploded");
      } },
      { name: "good", onError: after },
    ]);

    await expect(bus.onError(ctx(), new Error("original"))).resolves.toBeUndefined();
    expect(after).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("wallClockGuard", () => {
  it("allows a fresh turn", async () => {
    expect(await wallClockGuard.beforeTool?.(ctx(), call("x"))).toBeUndefined();
  });

  it("denies once the turn has outlived its budget", async () => {
    const stale = makeContext(scriptedProvider([[]]), {
      startedAt: Date.now() - LIMITS.wallClockMs - 1,
    });
    expect(await wallClockGuard.beforeTool?.(stale, call("x"))).toEqual({
      allowed: false,
      reason: "wall_clock_exceeded",
    });
  });
});

describe("depthGuard", () => {
  it("lets a top-level turn delegate", async () => {
    expect(await depthGuard.beforeTool?.(ctx(), call("ask_agent"))).toBeUndefined();
  });

  it("stops a delegated turn from delegating again", async () => {
    const nested = makeContext(scriptedProvider([[]]), { depth: LIMITS.maxDepth });
    expect(await depthGuard.beforeTool?.(nested, call("ask_agent"))).toEqual({
      allowed: false,
      reason: "depth_exceeded",
    });
  });

  it("leaves ordinary tools alone at depth", async () => {
    const nested = makeContext(scriptedProvider([[]]), { depth: LIMITS.maxDepth });
    expect(await depthGuard.beforeTool?.(nested, call("log_meal"))).toBeUndefined();
  });

  it.each(["ask_agent", "tell_agent", "handoff"])("stops %s at depth", async (tool) => {
    const nested = makeContext(scriptedProvider([[]]), { depth: LIMITS.maxDepth });
    expect(await depthGuard.beforeTool?.(nested, call(tool))).toMatchObject({
      reason: "depth_exceeded",
    });
  });
});

describe("createRepeatGuard", () => {
  it("denies an identical repeat within one turn", async () => {
    const guard = createRepeatGuard();
    const c = ctx();
    expect(await guard.beforeTool?.(c, call("log_meal", { dish: "面" }))).toBeUndefined();
    expect(await guard.beforeTool?.(c, call("log_meal", { dish: "面" }))).toEqual({
      allowed: false,
      reason: "duplicate_call",
    });
  });

  it("allows the same tool with different arguments", async () => {
    const guard = createRepeatGuard();
    const c = ctx();
    await guard.beforeTool?.(c, call("log_meal", { dish: "面" }));
    expect(await guard.beforeTool?.(c, call("log_meal", { dish: "粥" }))).toBeUndefined();
  });

  it("does not leak between concurrent turns", async () => {
    const guard = createRepeatGuard();
    await guard.beforeTool?.(ctx(), call("log_meal", { dish: "面" }));
    expect(await guard.beforeTool?.(ctx(), call("log_meal", { dish: "面" }))).toBeUndefined();
  });
});
