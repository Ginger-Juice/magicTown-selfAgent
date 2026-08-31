import { and, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { agents, delegations } from "@db/schema";
import { getDb } from "../../queries/connection";
import { LIMITS } from "../limits";
import type { EnvelopeSummary, EnvelopeType } from "../types";

export type PostInput = {
  fromAgentId: number;
  toAgentId: number;
  userId: number;
  conversationId: number | null;
  type: EnvelopeType;
  prompt: string;
  depth: number;
  originMessageId?: number | null;
};

export type PostResult =
  | { ok: true; envelope: EnvelopeSummary; warned: boolean }
  | { ok: false; reason: string };

/**
 * Two agents bouncing the same errand back and forth is the failure mode that
 * costs real money. The window counts traffic in both directions so a strict
 * alternation is caught as fast as a one-sided flood.
 */
export async function checkPingPong(
  a: number,
  b: number,
  userId: number,
): Promise<{ count: number; warn: boolean; block: boolean }> {
  const since = new Date(Date.now() - LIMITS.pingPongWindowMs);
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(delegations)
    .where(
      and(
        eq(delegations.userId, userId),
        gt(delegations.createdAt, since),
        or(
          and(eq(delegations.fromAgentId, a), eq(delegations.toAgentId, b)),
          and(eq(delegations.fromAgentId, b), eq(delegations.toAgentId, a)),
        ),
      ),
    );

  const count = Number(row?.count ?? 0);
  return {
    count,
    warn: count >= LIMITS.pingPongWarn,
    block: count >= LIMITS.pingPongBlock,
  };
}

export async function post(input: PostInput): Promise<PostResult> {
  if (input.fromAgentId === input.toAgentId) return { ok: false, reason: "same_agent" };
  if (input.depth >= LIMITS.maxDepth) return { ok: false, reason: "depth_exceeded" };

  const db = getDb();
  const target = await db.query.agents.findFirst({ where: eq(agents.id, input.toAgentId) });
  if (!target) return { ok: false, reason: "no_such_agent" };

  const pingPong = await checkPingPong(input.fromAgentId, input.toAgentId, input.userId);
  if (pingPong.block) return { ok: false, reason: "ping_pong_blocked" };

  const [{ id }] = await db
    .insert(delegations)
    .values({
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      conversationId: input.conversationId,
      userId: input.userId,
      status: "pending",
      type: input.type,
      depth: input.depth + 1,
      expiresAt: new Date(Date.now() + LIMITS.envelopeTtlMs),
      originMessageId: input.originMessageId ?? null,
      prompt: input.prompt,
    })
    .$returningId();

  return {
    ok: true,
    warned: pingPong.warn,
    envelope: {
      id,
      type: input.type,
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      toAgentName: target.name,
      userId: input.userId,
      conversationId: input.conversationId,
      depth: input.depth + 1,
      prompt: input.prompt,
    },
  };
}

export type ClaimedEnvelope = typeof delegations.$inferSelect;

function affectedRows(result: unknown): number {
  const direct = (result as { rowsAffected?: number } | null)?.rowsAffected;
  if (typeof direct === "number") return direct;
  const nested = (result as [{ affectedRows?: number }] | null)?.[0]?.affectedRows;
  return typeof nested === "number" ? nested : 0;
}

/**
 * Claims one pending envelope. The `status = 'pending'` predicate inside the
 * UPDATE is the whole concurrency story: two workers racing the same row means
 * one of them sees zero affected rows and moves on.
 */
export async function claimNext(): Promise<ClaimedEnvelope | null> {
  const db = getDb();
  const candidates = await db
    .select({ id: delegations.id })
    .from(delegations)
    .where(
      and(
        eq(delegations.status, "pending"),
        lt(delegations.attempts, LIMITS.envelopeMaxAttempts),
        or(sql`${delegations.expiresAt} IS NULL`, gt(delegations.expiresAt, new Date())),
      ),
    )
    .orderBy(delegations.id)
    .limit(5);

  for (const candidate of candidates) {
    const result = await db
      .update(delegations)
      .set({ status: "running", attempts: sql`${delegations.attempts} + 1` })
      .where(and(eq(delegations.id, candidate.id), eq(delegations.status, "pending")));

    if (affectedRows(result) === 0) continue;
    const row = await db.query.delegations.findFirst({ where: eq(delegations.id, candidate.id) });
    if (row) return row;
  }

  return null;
}

export async function complete(id: number, reply: string): Promise<void> {
  await getDb()
    .update(delegations)
    .set({ status: "done", reply })
    .where(eq(delegations.id, id));
}

/**
 * A failure below the attempt ceiling goes back to `pending` so the next sweep
 * retries it; at the ceiling it stays failed and the visitor gets told.
 */
export async function fail(id: number, error: string): Promise<"retry" | "gave_up"> {
  const db = getDb();
  const row = await db.query.delegations.findFirst({ where: eq(delegations.id, id) });
  const exhausted = !row || row.attempts >= LIMITS.envelopeMaxAttempts;

  await db
    .update(delegations)
    .set({ status: exhausted ? "failed" : "pending", lastError: error.slice(0, 500) })
    .where(eq(delegations.id, id));

  return exhausted ? "gave_up" : "retry";
}

export async function expireStale(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: delegations.id })
    .from(delegations)
    .where(
      and(
        inArray(delegations.status, ["pending", "running"]),
        lt(delegations.expiresAt, new Date()),
      ),
    );
  if (!rows.length) return 0;

  await db
    .update(delegations)
    .set({ status: "expired" })
    .where(inArray(delegations.id, rows.map((r) => r.id)));
  return rows.length;
}

export async function pendingCount(userId: number, conversationId: number): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(delegations)
    .where(
      and(
        eq(delegations.userId, userId),
        eq(delegations.conversationId, conversationId),
        inArray(delegations.status, ["pending", "running"]),
      ),
    );
  return Number(row?.count ?? 0);
}

/**
 * Resolves whatever the model typed into a real resident: exact slug, then
 * name, then capability tag. Visitor-owned agents are never a target — an
 * agent may only delegate to the town.
 */
export async function findRecipient(query: string, excludeAgentId: number) {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return null;

  const townAgents = await getDb()
    .select()
    .from(agents)
    .where(and(sql`${agents.ownerUserId} IS NULL`, ne(agents.id, excludeAgentId)))
    .orderBy(desc(agents.id));

  const bySlug = townAgents.find((a) => a.slug.toLowerCase() === wanted);
  if (bySlug) return bySlug;

  const byName = townAgents.find((a) => a.name.toLowerCase() === wanted);
  if (byName) return byName;

  return (
    townAgents.find((a) => {
      try {
        const tags: unknown = JSON.parse(a.capabilityTags);
        return Array.isArray(tags) && tags.some((t) => String(t).toLowerCase() === wanted);
      } catch {
        return false;
      }
    }) ?? null
  );
}

export async function listTownDirectory(excludeAgentId: number) {
  const townAgents = await getDb()
    .select({
      slug: agents.slug,
      name: agents.name,
      capabilityTags: agents.capabilityTags,
    })
    .from(agents)
    .where(and(sql`${agents.ownerUserId} IS NULL`, ne(agents.id, excludeAgentId)));

  return townAgents.map((a) => {
    let tags: string[] = [];
    try {
      const parsed: unknown = JSON.parse(a.capabilityTags);
      if (Array.isArray(parsed)) tags = parsed.map(String);
    } catch {
      /* an agent with an unreadable tag blob is still worth listing */
    }
    return { slug: a.slug, name: a.name, capabilities: tags };
  });
}
