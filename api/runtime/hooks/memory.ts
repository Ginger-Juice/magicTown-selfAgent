import * as store from "../memory/store";
import type { Hook } from "./bus";
import type { RunContext } from "../types";

/**
 * Fills the two memory blocks before the prompt is built, and pays back the
 * hit counter afterwards so rows that keep earning their place survive
 * eviction. Both halves are best-effort: a memory outage should cost the
 * visitor context, never the reply.
 */
export const memoryHook: Hook = {
  name: "memory",

  async beforeTurn(ctx: RunContext) {
    try {
      const digest = await store.loadDigest({
        agentSubject: { type: "agent", id: ctx.definition.id },
        userSubject: { type: "user", id: ctx.user.id },
        capabilityTags: ctx.definition.capabilityTags,
      });
      ctx.memoryBlocks = { self: digest.self, user: digest.user };
      ctx.memoryUsedIds = digest.usedIds;
      if (ctx.conversationId !== null) {
        ctx.sessionSummary = await store.readSession(ctx.conversationId, ctx.user.id);
      }
    } catch (err) {
      console.error("[runtime] memory digest failed", err);
    }
  },

  async afterTurn(ctx: RunContext) {
    if (!ctx.memoryUsedIds?.length) return;
    try {
      await store.recordHits(ctx.memoryUsedIds);
    } catch (err) {
      console.error("[runtime] memory hit write-back failed", err);
    }
  },
};
