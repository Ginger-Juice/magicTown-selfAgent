import * as store from "../memory/store";
import { keyPrefix } from "../memory/keys";
import type { MemoryView, RunContext, StepOutcome } from "../types";

export function ok(data: Record<string, unknown>, shouldExit = false): StepOutcome {
  return { data, shouldExit };
}

export function fail(error: string, detail?: unknown): StepOutcome {
  return { data: detail === undefined ? { error } : { error, detail } };
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Memory keys are ASCII-only by design, but most of this town writes Chinese.
 * Latin text keeps a readable slug; anything else falls back to a stable hash
 * so the same title always lands on the same row.
 */
export function slugFor(text: string): string {
  const ascii = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return ascii.length >= 2 ? ascii : `h${fnv1a(text.trim())}`;
}

export function recordKey(prefix: string, title: string): string {
  return `${prefix}:${slugFor(title)}`;
}

export type RememberInput = {
  key: string;
  value: string;
  topics?: string;
};

/**
 * Everything a town tool records is a user-subject insight. Nothing here writes
 * canon, so a wrong log is always something the visitor can simply overwrite.
 */
export async function remember(ctx: RunContext, input: RememberInput): Promise<StepOutcome> {
  const result = await store.write(
    {
      subject: { type: "user", id: ctx.user.id },
      level: "L2",
      key: input.key,
      value: input.value,
      topics: input.topics ?? "",
      origin: "agent",
    },
    {
      slots: ctx.definition.memorySlots,
      proposedByAgentId: ctx.definition.id,
      sourceConversationId: ctx.conversationId,
      sourceRunId: ctx.runId,
    },
  );

  if (!result.ok) return fail("not_recorded", result.reason);
  return ok({ recorded: true, key: input.key });
}

/** Reads back everything this agent's tools filed under one key prefix. */
export async function recall(ctx: RunContext, prefix: string): Promise<MemoryView[]> {
  const rows = await store.listLive({ type: "user", id: ctx.user.id }, ["L2"], {
    conversationId: null,
  });
  const wanted = prefix.endsWith(":") ? prefix : `${prefix}:`;
  return rows
    .filter((r) => keyPrefix(r.key) === wanted)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function asList(rows: MemoryView[], limit = 20) {
  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    key: r.key,
    value: r.value,
    updatedAt: r.updatedAt.toISOString().slice(0, 10),
  }));
}
