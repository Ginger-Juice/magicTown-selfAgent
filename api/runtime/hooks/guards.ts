import { LIMITS } from "../limits";
import type { Hook } from "./bus";
import type { RunContext, ToolCall, ToolVerdict } from "../types";

/**
 * Stops a turn that has been running long enough that the visitor has almost
 * certainly given up. Checked before each tool because that is where the
 * expensive work happens.
 */
export const wallClockGuard: Hook = {
  name: "wall-clock",
  async beforeTool(ctx: RunContext): Promise<ToolVerdict | void> {
    if (Date.now() - ctx.startedAt > LIMITS.wallClockMs) {
      return { allowed: false, reason: "wall_clock_exceeded" };
    }
  },
};

/**
 * A delegated turn is doing someone else's errand. Letting it delegate again
 * is how a two-agent exchange turns into a chain nobody asked for; `maxDepth`
 * is the ceiling and this is where it bites.
 */
const DELEGATING_TOOLS = new Set(["ask_agent", "tell_agent", "handoff"]);

export const depthGuard: Hook = {
  name: "depth",
  async beforeTool(ctx: RunContext, call: ToolCall): Promise<ToolVerdict | void> {
    if (DELEGATING_TOOLS.has(call.name) && ctx.depth >= LIMITS.maxDepth) {
      return { allowed: false, reason: "depth_exceeded" };
    }
  },
};

/**
 * Repeating a call with identical arguments never produces a different answer,
 * it just burns the step budget. Rejecting the repeat feeds the model a clear
 * signal that it is going in circles.
 */
export function createRepeatGuard(): Hook {
  // Keyed by the context object rather than an id: the runtime is a singleton
  // serving concurrent turns, and each turn gets exactly one fresh context.
  const seen = new WeakMap<RunContext, Set<string>>();

  return {
    name: "repeat",
    async beforeTool(ctx: RunContext, call: ToolCall): Promise<ToolVerdict | void> {
      const signature = `${call.name}(${JSON.stringify(call.args ?? {})})`;
      let perTurn = seen.get(ctx);
      if (!perTurn) {
        perTurn = new Set<string>();
        seen.set(ctx, perTurn);
      }
      if (perTurn.has(signature)) return { allowed: false, reason: "duplicate_call" };
      perTurn.add(signature);
    },
  };
}

export function defaultGuards(): Hook[] {
  return [wallClockGuard, depthGuard, createRepeatGuard()];
}
