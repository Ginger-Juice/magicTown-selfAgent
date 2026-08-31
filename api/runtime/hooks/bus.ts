import type {
  EnvelopeSummary,
  HookBus,
  RunContext,
  StepOutcome,
  ToolCall,
  ToolVerdict,
} from "../types";

/**
 * A hook only implements the points it cares about. `beforeTool` is the one
 * with real semantics: the first denial wins and short-circuits the rest, so
 * order the list from cheapest check to most expensive.
 */
export type Hook = {
  name: string;
  beforeTurn?(ctx: RunContext): Promise<void>;
  beforeTool?(ctx: RunContext, call: ToolCall): Promise<ToolVerdict | void>;
  afterTool?(ctx: RunContext, call: ToolCall, outcome: StepOutcome): Promise<void>;
  afterTurn?(ctx: RunContext, finalText: string): Promise<void>;
  onHandoff?(ctx: RunContext, envelope: EnvelopeSummary): Promise<void>;
  onError?(ctx: RunContext, err: unknown): Promise<void>;
};

export function createHookBus(hooks: Hook[]): HookBus {
  return {
    async beforeTurn(ctx) {
      for (const hook of hooks) await hook.beforeTurn?.(ctx);
    },

    async beforeTool(ctx, call) {
      for (const hook of hooks) {
        const verdict = await hook.beforeTool?.(ctx, call);
        if (verdict && !verdict.allowed) return verdict;
      }
      return { allowed: true };
    },

    async afterTool(ctx, call, outcome) {
      for (const hook of hooks) await hook.afterTool?.(ctx, call, outcome);
    },

    async afterTurn(ctx, finalText) {
      for (const hook of hooks) await hook.afterTurn?.(ctx, finalText);
    },

    async onHandoff(ctx, envelope) {
      for (const hook of hooks) await hook.onHandoff?.(ctx, envelope);
    },

    /**
     * Error hooks must never mask the original failure, so each one is isolated.
     */
    async onError(ctx, err) {
      for (const hook of hooks) {
        try {
          await hook.onError?.(ctx, err);
        } catch (hookErr) {
          console.error(`[runtime] onError hook "${hook.name}" threw`, hookErr);
        }
      }
    },
  };
}

export const NOOP_HOOKS: HookBus = createHookBus([]);
