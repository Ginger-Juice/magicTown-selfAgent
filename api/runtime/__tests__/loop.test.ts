import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runLoop } from "../loop";
import { LIMITS } from "../limits";
import { defineTool } from "../tools/registry";
import {
  denyingHooks,
  makeContext,
  passthroughHooks,
  scriptedProvider,
  text,
  toolCall,
} from "./helpers";
import type { ToolSpec } from "../types";

function recorderTool(id: string, log: string[], extra: Partial<{ shouldExit: boolean }> = {}): ToolSpec {
  return defineTool({
    id,
    description: `records ${id}`,
    parameters: z.object({ note: z.string().optional() }),
    realAction: true,
    async execute(args) {
      log.push(id);
      return { data: { ok: true, note: args.note ?? null }, shouldExit: extra.shouldExit };
    },
  });
}

describe("runLoop", () => {
  it("returns the text and stops after one step when no tools are called", async () => {
    const ctx = makeContext(scriptedProvider([[text("湖边今天很安静。")]]));

    const result = await runLoop({
      ctx,
      hooks: passthroughHooks,
      tools: [],
      system: "s",
      messages: [],
    });

    expect(result.finalText).toBe("湖边今天很安静。");
    expect(result.steps).toBe(1);
    expect(ctx.trace).toHaveLength(0);
  });

  it("executes tool calls in the order the provider emitted them", async () => {
    const log: string[] = [];
    const ctx = makeContext(
      scriptedProvider([
        [toolCall("log_meal"), toolCall("lookup_dish")],
        [text("记好了。")],
      ]),
    );

    const result = await runLoop({
      ctx,
      hooks: passthroughHooks,
      tools: [recorderTool("log_meal", log), recorderTool("lookup_dish", log)],
      system: "s",
      messages: [],
    });

    expect(log).toEqual(["log_meal", "lookup_dish"]);
    expect(result.finalText).toBe("记好了。");
    expect(result.steps).toBe(2);
    expect(ctx.trace.map((t) => t.tool)).toEqual(["log_meal", "lookup_dish"]);
    expect(ctx.realActions).toEqual(["log_meal", "lookup_dish"]);
  });

  it("stops immediately on shouldExit and skips the rest of the batch", async () => {
    const log: string[] = [];
    const ctx = makeContext(
      scriptedProvider([[toolCall("handoff"), toolCall("log_meal")], [text("unreachable")]]),
    );

    const result = await runLoop({
      ctx,
      hooks: passthroughHooks,
      tools: [
        recorderTool("handoff", log, { shouldExit: true }),
        recorderTool("log_meal", log),
      ],
      system: "s",
      messages: [],
    });

    expect(log).toEqual(["handoff"]);
    expect(result.steps).toBe(1);
  });

  it("caps at maxSteps when the model never stops calling tools", async () => {
    const log: string[] = [];
    const ctx = makeContext(scriptedProvider([[toolCall("log_meal")]]));

    const result = await runLoop({
      ctx,
      hooks: passthroughHooks,
      tools: [recorderTool("log_meal", log)],
      system: "s",
      messages: [],
    });

    expect(result.steps).toBe(LIMITS.maxSteps);
    expect(log).toHaveLength(LIMITS.maxSteps);
    expect(ctx.notes.some((n) => n.meta?.reason === "max_steps")).toBe(true);
  });

  it("feeds a denial back to the model instead of executing the tool", async () => {
    const log: string[] = [];
    const ctx = makeContext(
      scriptedProvider([[toolCall("log_meal")], [text("那我换个办法。")]]),
    );

    const result = await runLoop({
      ctx,
      hooks: denyingHooks((name) =>
        name === "log_meal" ? { allowed: false, reason: "capability_denied" } : null,
      ),
      tools: [recorderTool("log_meal", log)],
      system: "s",
      messages: [],
    });

    expect(log).toEqual([]);
    expect(result.finalText).toBe("那我换个办法。");
    expect(ctx.trace[0]).toMatchObject({ tool: "log_meal", allowed: false, reason: "capability_denied" });
    expect(ctx.realActions).toEqual([]);
  });

  it("reports unknown tools as a readable result rather than throwing", async () => {
    const ctx = makeContext(
      scriptedProvider([[toolCall("summon_dragon")], [text("这个我做不到。")]]),
    );

    const result = await runLoop({
      ctx,
      hooks: passthroughHooks,
      tools: [],
      system: "s",
      messages: [],
    });

    expect(result.finalText).toBe("这个我做不到。");
    expect(ctx.trace[0]).toMatchObject({ tool: "summon_dragon", allowed: false, reason: "unknown_tool" });
  });

  it("stops executing once the per-turn tool budget is spent", async () => {
    const log: string[] = [];
    const ctx = makeContext(scriptedProvider([[toolCall("log_meal")]]));

    await runLoop({
      ctx,
      hooks: passthroughHooks,
      tools: [recorderTool("log_meal", log)],
      system: "s",
      messages: [],
    });

    // maxSteps (8) is the binding limit here, but the budget must never be exceeded.
    expect(log.length).toBeLessThanOrEqual(LIMITS.maxToolCallsPerTurn);
    expect(ctx.toolCallCount).toBeLessThanOrEqual(LIMITS.maxToolCallsPerTurn);
  });

  it("rejects malformed tool arguments without killing the turn", async () => {
    const ctx = makeContext(
      scriptedProvider([
        [{ type: "tool_call", callId: "c1", name: "log_meal", args: { note: 42 } }],
        [text("参数写错了，我重来。")],
      ]),
    );

    const result = await runLoop({
      ctx,
      hooks: passthroughHooks,
      tools: [recorderTool("log_meal", [])],
      system: "s",
      messages: [],
    });

    expect(result.finalText).toBe("参数写错了，我重来。");
    expect(ctx.trace[0]?.allowed).toBe(true);
  });
});
