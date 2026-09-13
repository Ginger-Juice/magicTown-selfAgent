import * as store from "../memory/store";
import type { WriteOutcome } from "../memory/store";
import {
  DIVINATION_ARCHIVE_RULES,
  PENDING_READING_KEY,
  decideArchiveAction,
  formatReadingArchive,
  parseDrawnSpread,
  uniqueReadingKey,
  type PendingReading,
} from "../divination";
import type { Hook } from "./bus";
import type { MemorySlot, RunContext, StepOutcome, ToolCall } from "../types";

const draws = new WeakMap<RunContext, ReturnType<typeof parseDrawnSpread>>();

function kindOf(ctx: RunContext): string {
  return ctx.definition.kind;
}

export async function readPendingReading(
  conversationId: number,
  userId: number,
): Promise<PendingReading | null> {
  const rows = await store.listLive({ type: "user", id: userId }, ["L3"], { conversationId });
  const raw = rows.find((r) => r.key === PENDING_READING_KEY)?.value;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as PendingReading;
    if (!Array.isArray(value.cards) || !value.cards.length) return null;
    return value;
  } catch {
    return null;
  }
}

async function clearPending(conversationId: number, userId: number): Promise<void> {
  const rows = await store.listLive({ type: "user", id: userId }, ["L3"], { conversationId });
  const existing = rows.find((r) => r.key === PENDING_READING_KEY);
  if (existing) await store.forget(existing.id, { origin: "system" });
}

async function writePendingReading(ctx: RunContext, pending: PendingReading | null): Promise<void> {
  if (ctx.conversationId == null) return;
  if (!pending) {
    await clearPending(ctx.conversationId, ctx.user.id);
    return;
  }
  await store.write(
    {
      subject: { type: "user", id: ctx.user.id },
      level: "L3",
      key: PENDING_READING_KEY,
      value: JSON.stringify(pending),
      origin: "system",
      conversationId: ctx.conversationId,
    },
    { slots: [] },
  );
}

async function persistArchive(
  userId: number,
  archive: Parameters<typeof formatReadingArchive>[0],
  env: {
    conversationId?: number | null;
    agentId?: number;
    runId?: number | null;
    slots?: MemorySlot[];
  },
): Promise<WriteOutcome> {
  const value = formatReadingArchive(archive);
  const seed = `${value}:${env.conversationId ?? 0}`;
  return store.write(
    {
      subject: { type: "user", id: userId },
      level: "L2",
      key: uniqueReadingKey(seed),
      value,
      topics: "divination",
      origin: "system",
    },
    {
      slots: env.slots ?? [],
      proposedByAgentId: env.agentId,
      sourceConversationId: env.conversationId,
      sourceRunId: env.runId,
    },
  );
}

async function fileReading(ctx: RunContext, archive: Parameters<typeof formatReadingArchive>[0]): Promise<void> {
  const result = await persistArchive(ctx.user.id, archive, {
    conversationId: ctx.conversationId,
    agentId: ctx.definition.id,
    runId: ctx.runId,
    slots: ctx.definition.memorySlots,
  });
  if (!result.ok) {
    console.error("[divination] archive write failed", result.reason);
    return;
  }
  ctx.notes.push({
    kind: "notice",
    body: "这次占卜已记进塔里的档案。",
    meta: { kind: "reading_archive", memoryId: result.id },
  });
}

/** Idle distill: file a draw that never got a spoken reaction. */
export async function archiveIdlePending(conversationId: number, userId: number): Promise<boolean> {
  const pending = await readPendingReading(conversationId, userId);
  if (!pending) return false;
  const result = await persistArchive(userId, { ...pending, feedback: null }, { conversationId });
  if (!result.ok) {
    console.error("[divination] idle archive write failed", result.reason);
    return false;
  }
  await clearPending(conversationId, userId);
  return true;
}

/**
 * Safety net around `log_reading`: if the wizard forgets to file, the house
 * still keeps the cards, the answer, and the visitor's reaction.
 */
export const divinationArchiveHook: Hook = {
  name: "divination-archive",

  async afterTool(ctx: RunContext, call: ToolCall, outcome: StepOutcome) {
    if (kindOf(ctx) !== "divination") return;
    if (call.name === "draw_tarot") {
      draws.set(ctx, parseDrawnSpread(outcome.data));
    }
  },

  async afterTurn(ctx: RunContext, finalText: string) {
    if (kindOf(ctx) !== "divination") return;
    if (ctx.conversationId == null) return;

    try {
      const pending = await readPendingReading(ctx.conversationId, ctx.user.id);
      const decision = decideArchiveAction({
        kind: ctx.definition.kind,
        drew: draws.get(ctx) ?? null,
        loggedThisTurn: ctx.realActions.includes("log_reading"),
        pending,
        userMessage: ctx.userMessage,
        interpretation: finalText,
      });

      if (decision.action === "noop") return;
      if (decision.action === "clear") {
        await writePendingReading(ctx, null);
        return;
      }
      if (decision.action === "stash") {
        await writePendingReading(ctx, decision.pending);
        return;
      }
      await fileReading(ctx, decision.archive);
      await writePendingReading(ctx, decision.stash);
    } catch (err) {
      console.error("[divination] archive hook failed", err);
    }
  },
};

export { DIVINATION_ARCHIVE_RULES };
