import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { memories, type Memory } from "@db/schema";
import { getDb } from "../../queries/connection";
import { LIMITS } from "../limits";
import { check as deidentifyCheck, type DeidentifyContext } from "./deidentify";
import { compile, filterByTopics, type DigestBlocks } from "./digest";
import { SESSION_ROLLING_KEY } from "./keys";
import { canForget, decideWrite, type PolicyContext, type WriteRequest } from "./policy";
import type { MemoryLevel, MemoryStatus, MemorySubject, MemoryView } from "../types";

export type WriteOutcome =
  | { ok: true; id: number; status: MemoryStatus }
  | { ok: false; reason: string };

export type WriteEnv = PolicyContext & {
  /** Only consulted for agent-subject writes. */
  deidentify?: DeidentifyContext;
  proposedByAgentId?: number | null;
  sourceConversationId?: number | null;
  sourceRunId?: number | null;
};

function toView(row: Memory): MemoryView {
  return {
    id: row.id,
    level: row.level as MemoryLevel,
    key: row.key,
    value: row.value,
    topics: row.topics,
    status: row.status as MemoryStatus,
    origin: row.origin as MemoryView["origin"],
    pinned: row.pinned,
    hits: row.hits,
    updatedAt: row.updatedAt,
  };
}

/** Live rows only: not soft-deleted, not expired, not rejected. */
function liveFilter(subject: MemorySubject) {
  return and(
    eq(memories.subjectType, subject.type),
    eq(memories.subjectId, subject.id),
    isNull(memories.deletedAt),
    or(isNull(memories.expiresAt), sql`${memories.expiresAt} > NOW()`),
  );
}

export async function listLive(
  subject: MemorySubject,
  levels: MemoryLevel[],
  opts: { conversationId?: number | null; includeProposed?: boolean } = {},
): Promise<MemoryView[]> {
  const db = getDb();
  const statuses: MemoryStatus[] = opts.includeProposed ? ["active", "proposed"] : ["active"];

  const rows = await db
    .select()
    .from(memories)
    .where(
      and(
        liveFilter(subject),
        inArray(memories.level, levels),
        inArray(memories.status, statuses),
        opts.conversationId === undefined
          ? undefined
          : opts.conversationId === null
            ? isNull(memories.conversationId)
            : eq(memories.conversationId, opts.conversationId),
      ),
    );

  return rows.map(toView);
}

/**
 * The three gates in order: policy decides shape and status, de-identification
 * guards agent-subject rows, and the unique `memoKey` makes the write itself
 * atomic. There is no interactive transaction available, so upsert must be a
 * single statement.
 */
export async function write(req: WriteRequest, env: WriteEnv): Promise<WriteOutcome> {
  const decision = decideWrite(req, env);
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  const w = decision.write;

  if (w.subjectType === "agent") {
    if (!env.deidentify) return { ok: false, reason: "deidentify_context_missing" };
    const clean = deidentifyCheck(w.value, env.deidentify);
    if (!clean.ok) return { ok: false, reason: `deidentify:${clean.reason}` };
  }

  const db = getDb();
  await db
    .insert(memories)
    .values({
      subjectType: w.subjectType,
      subjectId: w.subjectId,
      level: w.level,
      conversationId: w.conversationId,
      key: w.key,
      memoKey: w.memoKey,
      value: w.value,
      topics: w.topics,
      status: w.status,
      origin: w.origin,
      pinned: w.pinned,
      proposedByAgentId: env.proposedByAgentId ?? null,
      sourceConversationId: env.sourceConversationId ?? null,
      sourceRunId: env.sourceRunId ?? null,
      expiresAt: w.expiresAt,
    })
    .onDuplicateKeyUpdate({
      set: {
        value: w.value,
        topics: w.topics,
        status: w.status,
        origin: w.origin,
        pinned: w.pinned,
        expiresAt: w.expiresAt,
        // Rewriting a row un-forgets it; that is what "remember this again" means.
        deletedAt: null,
      },
    });

  const row = await db.query.memories.findFirst({ where: eq(memories.memoKey, w.memoKey) });
  if (!row) return { ok: false, reason: "write_lost" };

  await evict(
    { type: w.subjectType, id: w.subjectId },
    w.level === "L3" ? "L2" : w.level,
  );

  return { ok: true, id: row.id, status: row.status as MemoryStatus };
}

export type EvictionCandidate = {
  id: number;
  pinned: boolean;
  hits: number;
  updatedAt: Date;
};

/**
 * Picks the rows to drop when a subject is over its ceiling: coldest first,
 * where each use is worth about a day of freshness. Pinned rows are never
 * candidates, so a subject that pins past its cap simply stays over it.
 */
export function pickVictims(rows: EvictionCandidate[], cap: number): number[] {
  if (rows.length <= cap) return [];
  const dayMs = 24 * 60 * 60 * 1000;
  const score = (r: EvictionCandidate) => r.updatedAt.getTime() + r.hits * dayMs;

  return rows
    .filter((r) => !r.pinned)
    .sort((a, b) => score(a) - score(b))
    .slice(0, rows.length - cap)
    .map((r) => r.id);
}

/**
 * Keeps a subject under its per-level ceiling by soft-deleting the least
 * valuable rows. Canon rows have a higher ceiling and are usually pinned.
 */
export async function evict(subject: MemorySubject, level: MemoryLevel): Promise<number> {
  const cap = level === "L1" ? LIMITS.memoryMaxL1PerSubject : LIMITS.memoryMaxL2PerSubject;
  const db = getDb();

  const rows = await db
    .select({
      id: memories.id,
      pinned: memories.pinned,
      hits: memories.hits,
      updatedAt: memories.updatedAt,
    })
    .from(memories)
    .where(and(liveFilter(subject), eq(memories.level, level), eq(memories.status, "active")));

  const victims = pickVictims(rows, cap);
  if (!victims.length) return 0;

  await db
    .update(memories)
    .set({ deletedAt: new Date() })
    .where(inArray(memories.id, victims));

  return victims.length;
}

export async function forget(
  id: number,
  by: { origin: "user" | "agent" | "system"; subject?: MemorySubject },
): Promise<{ ok: boolean; reason?: string }> {
  const db = getDb();
  const row = await db.query.memories.findFirst({ where: eq(memories.id, id) });
  if (!row || row.deletedAt) return { ok: false, reason: "not_found" };

  if (by.subject && (row.subjectType !== by.subject.type || row.subjectId !== by.subject.id)) {
    return { ok: false, reason: "wrong_subject" };
  }
  if (!canForget(row.level as MemoryLevel, by.origin)) {
    return { ok: false, reason: "canon_needs_the_user" };
  }

  await db.update(memories).set({ deletedAt: new Date() }).where(eq(memories.id, id));
  return { ok: true };
}

/** Fire-and-forget: a lost hit count changes ranking slightly, nothing more. */
export async function recordHits(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await getDb()
    .update(memories)
    .set({ hits: sql`${memories.hits} + 1`, lastUsedAt: new Date() })
    .where(inArray(memories.id, ids));
}

export type LoadedDigest = DigestBlocks & { usedIds: number[] };

/**
 * Builds both prompt blocks for one turn. Topic filtering happens here rather
 * than in the query so the same rows can serve agents with different tags.
 */
export async function loadDigest(input: {
  agentSubject: MemorySubject;
  userSubject: MemorySubject;
  capabilityTags: string[];
}): Promise<LoadedDigest> {
  const [selfRows, userRows] = await Promise.all([
    listLive(input.agentSubject, ["L1", "L2"]),
    listLive(input.userSubject, ["L1", "L2"], { conversationId: null }),
  ]);

  const visibleUser = filterByTopics(userRows, input.capabilityTags);
  const byLevel = (rows: MemoryView[], level: MemoryLevel) =>
    rows.filter((r) => r.level === level);

  const blocks = compile({
    selfL1: byLevel(selfRows, "L1"),
    selfL2: byLevel(selfRows, "L2"),
    userL1: byLevel(visibleUser, "L1"),
    userL2: byLevel(visibleUser, "L2"),
  });

  return { ...blocks, usedIds: [...selfRows, ...visibleUser].map((r) => r.id) };
}

export async function readSession(conversationId: number, userId: number): Promise<string> {
  const rows = await listLive({ type: "user", id: userId }, ["L3"], { conversationId });
  return rows.find((r) => r.key === SESSION_ROLLING_KEY)?.value ?? "";
}

export async function writeSession(
  conversationId: number,
  userId: number,
  summary: string,
): Promise<void> {
  await write(
    {
      subject: { type: "user", id: userId },
      level: "L3",
      key: SESSION_ROLLING_KEY,
      value: summary,
      origin: "system",
      conversationId,
    },
    { slots: [] },
  );
}

/** Proposals older than the TTL are noise; the sweeper clears them. */
export async function purgeExpired(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(isNull(memories.deletedAt), lt(memories.expiresAt, new Date())));
  if (!rows.length) return 0;
  await db
    .update(memories)
    .set({ deletedAt: new Date() })
    .where(inArray(memories.id, rows.map((r) => r.id)));
  return rows.length;
}

export async function listForUser(
  subject: MemorySubject,
  opts: { includeProposed?: boolean } = {},
): Promise<MemoryView[]> {
  const rows = await listLive(subject, ["L1", "L2"], {
    includeProposed: opts.includeProposed ?? true,
  });
  return rows.sort((a, b) => {
    if (a.level !== b.level) return a.level < b.level ? -1 : 1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

export async function setStatus(id: number, status: MemoryStatus): Promise<void> {
  await getDb().update(memories).set({ status }).where(eq(memories.id, id));
}