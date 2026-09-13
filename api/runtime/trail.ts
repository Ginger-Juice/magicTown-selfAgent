import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { agents, conversations, memories, messages, trailEvents } from "@db/schema";
import { getDb } from "../queries/connection";

export const TRAIL_KINDS = [
  "open_landmark",
  "open_chat",
  "chat_turn",
  "memory_l2",
  "memory_l1",
] as const;

export type TrailKind = (typeof TRAIL_KINDS)[number];

export const TRAIL_WEIGHTS: Record<TrailKind, number> = {
  open_landmark: 1,
  open_chat: 2,
  chat_turn: 3,
  memory_l2: 4,
  memory_l1: 5,
};

const DEDUPE_KINDS = new Set<TrailKind>(["open_landmark", "open_chat"]);
export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
export const TEMPORAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const MINE_LIMIT = 400;

export type RecordInput = {
  userId: number;
  kind: TrailKind;
  agentId?: number | null;
  landmarkId?: string | null;
  conversationId?: number | null;
  memoryId?: number | null;
  sourceKey?: string | null;
  createdAt?: Date;
};

export type RecordResult = { id: number; deduped: boolean };

export function isTrailKind(value: string): value is TrailKind {
  return (TRAIL_KINDS as readonly string[]).includes(value);
}

export type GraphEvent = {
  id: number;
  kind: TrailKind;
  weight: number;
  agentId: number | null;
  landmarkId: string | null;
  conversationId: number | null;
  memoryId: number | null;
  createdAt: Date;
};

export type GraphMemory = {
  id: number;
  key: string;
  topics: string;
  level: string;
  sourceConversationId: number | null;
};

export type GraphAgent = {
  id: number;
  slug: string;
  name: string;
  landmarkId: string | null;
};

export type TrailNode = {
  id: string;
  type: "landmark" | "agent" | "keyword" | "topic";
  label: string;
  weight: number;
  eventIds: number[];
  promoted: boolean;
};

export type TrailEdgeKind = "same_conversation" | "same_place" | "temporal" | "promotion";

export type TrailEdge = {
  id: string;
  from: string;
  to: string;
  kind: TrailEdgeKind;
  weight: number;
};

function keywordId(key: string): string {
  const colon = key.indexOf(":");
  const prefix = colon === -1 ? key : key.slice(0, colon);
  return `keyword:${prefix}`;
}

function bump(
  nodes: Map<string, TrailNode>,
  id: string,
  type: TrailNode["type"],
  label: string,
  weight: number,
  eventId: number | null,
): TrailNode {
  const existing = nodes.get(id);
  if (existing) {
    existing.weight += weight;
    if (eventId != null) existing.eventIds.push(eventId);
    return existing;
  }
  const node: TrailNode = {
    id,
    type,
    label,
    weight,
    eventIds: eventId == null ? [] : [eventId],
    promoted: false,
  };
  nodes.set(id, node);
  return node;
}

function undirected(kind: TrailEdgeKind, a: string, b: string): string {
  return a < b ? `${kind}:${a}:${b}` : `${kind}:${b}:${a}`;
}

function link(
  edges: Map<string, TrailEdge>,
  kind: TrailEdgeKind,
  from: string,
  to: string,
  weight = 1,
): void {
  if (from === to) return;
  const id = undirected(kind, from, to);
  const existing = edges.get(id);
  if (existing) {
    existing.weight += weight;
    return;
  }
  edges.set(id, { id, from: from < to ? from : to, to: from < to ? to : from, kind, weight });
}

function splitTopics(topics: string): string[] {
  return topics
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Pure: events + joined rows in, nodes/edges out. The journal never guesses
 * relationships on the client.
 */
export function deriveGraph(
  events: GraphEvent[],
  memoryRows: GraphMemory[],
  agentRows: GraphAgent[],
): { nodes: TrailNode[]; edges: TrailEdge[] } {
  const nodes = new Map<string, TrailNode>();
  const edges = new Map<string, TrailEdge>();
  const agentsById = new Map(agentRows.map((a) => [a.id, a]));
  const memoriesById = new Map(memoryRows.map((m) => [m.id, m]));

  const convoNodes = new Map<number, Set<string>>();
  const placeNodes = new Map<string, Set<string>>();
  const remember = (group: Map<string | number, Set<string>>, key: string | number, nodeId: string) => {
    const set = group.get(key) ?? new Set<string>();
    set.add(nodeId);
    group.set(key, set);
  };

  for (const event of events) {
    let landmarkId = event.landmarkId;
    const agent = event.agentId != null ? agentsById.get(event.agentId) : undefined;
    if (!landmarkId && agent?.landmarkId) landmarkId = agent.landmarkId;

    if (landmarkId) {
      const id = `landmark:${landmarkId}`;
      bump(nodes, id, "landmark", landmarkId, event.weight, event.id);
      remember(placeNodes, landmarkId, id);
      if (event.conversationId != null) remember(convoNodes, event.conversationId, id);
    }

    if (event.agentId != null && agent) {
      const id = `agent:${agent.id}`;
      bump(nodes, id, "agent", agent.name, event.weight, event.id);
      if (event.conversationId != null) remember(convoNodes, event.conversationId, id);
      if (landmarkId) remember(placeNodes, landmarkId, id);
    }

    const memory = event.memoryId != null ? memoriesById.get(event.memoryId) : undefined;
    if (memory) {
      const id = keywordId(memory.key);
      bump(nodes, id, "keyword", id.slice("keyword:".length), event.weight, event.id);
      if (event.conversationId != null) remember(convoNodes, event.conversationId, id);
      if (memory.sourceConversationId != null) remember(convoNodes, memory.sourceConversationId, id);
      if (landmarkId) remember(placeNodes, landmarkId, id);
      for (const topic of splitTopics(memory.topics)) {
        const topicId = `topic:${topic}`;
        bump(nodes, topicId, "topic", topic, Math.max(1, Math.floor(event.weight / 2)), event.id);
        link(edges, "same_conversation", id, topicId);
        if (event.conversationId != null) remember(convoNodes, event.conversationId, topicId);
        if (landmarkId) remember(placeNodes, landmarkId, topicId);
      }
    }
  }

  // Memories that somehow lack an event still seed keywords so the graph isn't empty
  // after a backfill race. Weights stay at 0 until an event touches them.
  for (const memory of memoryRows) {
    const id = keywordId(memory.key);
    if (!nodes.has(id)) bump(nodes, id, "keyword", id.slice("keyword:".length), 0, null);
    if (memory.sourceConversationId != null) remember(convoNodes, memory.sourceConversationId, id);
  }

  for (const [, group] of convoNodes) {
    const ids = [...group];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        link(edges, "same_conversation", ids[i], ids[j]);
      }
    }
  }

  for (const [, group] of placeNodes) {
    const ids = [...group];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        link(edges, "same_place", ids[i], ids[j]);
      }
    }
  }

  const landmarkVisits = events
    .map((e) => {
      const agent = e.agentId != null ? agentsById.get(e.agentId) : undefined;
      const landmarkId = e.landmarkId || agent?.landmarkId || null;
      return landmarkId ? { landmarkId, at: e.createdAt.getTime() } : null;
    })
    .filter((v): v is { landmarkId: string; at: number } => v != null)
    .sort((a, b) => a.at - b.at);

  let last: { landmarkId: string; at: number } | null = null;
  for (const visit of landmarkVisits) {
    if (last && last.landmarkId !== visit.landmarkId && visit.at - last.at <= TEMPORAL_WINDOW_MS) {
      link(edges, "temporal", `landmark:${last.landmarkId}`, `landmark:${visit.landmarkId}`);
    }
    last = visit;
  }

  const byKeyword = new Map<string, Set<TrailKind>>();
  for (const event of events) {
    if (event.kind !== "memory_l1" && event.kind !== "memory_l2") continue;
    const memory = event.memoryId != null ? memoriesById.get(event.memoryId) : undefined;
    if (!memory) continue;
    const id = keywordId(memory.key);
    const set = byKeyword.get(id) ?? new Set<TrailKind>();
    set.add(event.kind);
    byKeyword.set(id, set);
  }
  for (const [id, kinds] of byKeyword) {
    if (kinds.has("memory_l1") && kinds.has("memory_l2")) {
      const node = nodes.get(id);
      if (node) node.promoted = true;
    }
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => b.weight - a.weight),
    edges: [...edges.values()],
  };
}

async function recentDuplicate(input: RecordInput): Promise<typeof trailEvents.$inferSelect | null> {
  if (!DEDUPE_KINDS.has(input.kind) || input.sourceKey) return null;
  const db = getDb();
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const target =
    input.kind === "open_landmark"
      ? eq(trailEvents.landmarkId, input.landmarkId ?? "")
      : eq(trailEvents.agentId, input.agentId ?? 0);

  const rows = await db
    .select()
    .from(trailEvents)
    .where(
      and(eq(trailEvents.userId, input.userId), eq(trailEvents.kind, input.kind), target, gt(trailEvents.createdAt, since)),
    )
    .orderBy(desc(trailEvents.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function record(input: RecordInput): Promise<RecordResult> {
  if (input.sourceKey) {
    const existing = await getDb().query.trailEvents.findFirst({
      where: eq(trailEvents.sourceKey, input.sourceKey),
    });
    if (existing) return { id: existing.id, deduped: true };
  }

  const dup = await recentDuplicate(input);
  if (dup) return { id: dup.id, deduped: true };

  const [{ id }] = await getDb()
    .insert(trailEvents)
    .values({
      userId: input.userId,
      kind: input.kind,
      weight: TRAIL_WEIGHTS[input.kind],
      agentId: input.agentId ?? null,
      landmarkId: input.landmarkId ?? null,
      conversationId: input.conversationId ?? null,
      memoryId: input.memoryId ?? null,
      sourceKey: input.sourceKey ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .$returningId();
  return { id, deduped: false };
}

/** Fire-and-forget wrapper so a trail miss never fails the originating write. */
export function recordQuiet(input: RecordInput): void {
  void record(input).catch((err: unknown) => {
    console.error("[trail] record failed", err);
  });
}

export async function backfillUser(userId: number): Promise<number> {
  const db = getDb();
  const convos = await db.select().from(conversations).where(eq(conversations.userId, userId));
  const mems = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.subjectType, "user"),
        eq(memories.subjectId, userId),
        inArray(memories.level, ["L1", "L2"]),
        isNull(memories.deletedAt),
      ),
    );

  if (!convos.length && !mems.length) return 0;

  const agentIds = [...new Set(convos.map((c) => c.agentId))];
  const agentRows = agentIds.length
    ? await db.select().from(agents).where(inArray(agents.id, agentIds))
    : [];
  const agentById = new Map(agentRows.map((a) => [a.id, a]));
  const convoById = new Map(convos.map((c) => [c.id, c]));

  let written = 0;

  for (const convo of convos) {
    const result = await record({
      userId,
      kind: "open_chat",
      agentId: convo.agentId,
      landmarkId: agentById.get(convo.agentId)?.landmarkId ?? null,
      conversationId: convo.id,
      sourceKey: `convo:${convo.id}`,
      createdAt: convo.createdAt,
    });
    if (!result.deduped) written += 1;
  }

  if (convos.length) {
    const userMsgs = await db
      .select()
      .from(messages)
      .where(and(inArray(messages.conversationId, convos.map((c) => c.id)), eq(messages.fromKind, "user")));
    for (const msg of userMsgs) {
      const convo = convoById.get(msg.conversationId);
      if (!convo) continue;
      const result = await record({
        userId,
        kind: "chat_turn",
        agentId: convo.agentId,
        landmarkId: agentById.get(convo.agentId)?.landmarkId ?? null,
        conversationId: convo.id,
        sourceKey: `msg:${msg.id}`,
        createdAt: msg.createdAt,
      });
      if (!result.deduped) written += 1;
    }
  }

  for (const mem of mems) {
    const convo = mem.sourceConversationId != null ? convoById.get(mem.sourceConversationId) : undefined;
    const result = await record({
      userId,
      kind: mem.level === "L1" ? "memory_l1" : "memory_l2",
      agentId: convo?.agentId ?? null,
      landmarkId: convo ? (agentById.get(convo.agentId)?.landmarkId ?? null) : null,
      conversationId: mem.sourceConversationId,
      memoryId: mem.id,
      sourceKey: `mem:${mem.id}`,
      createdAt: mem.createdAt,
    });
    if (!result.deduped) written += 1;
  }

  return written;
}

export type MinedEvent = {
  id: number;
  kind: TrailKind;
  weight: number;
  agentId: number | null;
  agentName: string | null;
  agentSlug: string | null;
  landmarkId: string | null;
  conversationId: number | null;
  memoryId: number | null;
  memoryKey: string | null;
  memoryValue: string | null;
  createdAt: Date;
};

export async function mine(userId: number): Promise<{
  events: MinedEvent[];
  nodes: TrailNode[];
  edges: TrailEdge[];
}> {
  await backfillUser(userId);
  const db = getDb();
  const rows = await db
    .select()
    .from(trailEvents)
    .where(eq(trailEvents.userId, userId))
    .orderBy(desc(trailEvents.createdAt))
    .limit(MINE_LIMIT);

  const agentIds = [...new Set(rows.map((r) => r.agentId).filter((id): id is number => id != null))];
  const memoryIds = [...new Set(rows.map((r) => r.memoryId).filter((id): id is number => id != null))];

  const [agentRows, memoryRows] = await Promise.all([
    agentIds.length ? db.select().from(agents).where(inArray(agents.id, agentIds)) : Promise.resolve([]),
    memoryIds.length
      ? db
          .select()
          .from(memories)
          .where(and(inArray(memories.id, memoryIds), eq(memories.subjectType, "user")))
      : Promise.resolve([]),
  ]);

  const agentsById = new Map(agentRows.map((a) => [a.id, a]));
  const memoriesById = new Map(memoryRows.map((m) => [m.id, m]));

  const events: GraphEvent[] = rows.map((r) => ({
    id: r.id,
    kind: isTrailKind(r.kind) ? r.kind : "open_landmark",
    weight: r.weight,
    agentId: r.agentId,
    landmarkId: r.landmarkId,
    conversationId: r.conversationId,
    memoryId: r.memoryId,
    createdAt: r.createdAt,
  }));

  const graph = deriveGraph(
    events,
    memoryRows.map((m) => ({
      id: m.id,
      key: m.key,
      topics: m.topics,
      level: m.level,
      sourceConversationId: m.sourceConversationId,
    })),
    agentRows.map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      landmarkId: a.landmarkId,
    })),
  );

  return {
    events: events.map((e) => {
      const agent = e.agentId != null ? agentsById.get(e.agentId) : undefined;
      const memory = e.memoryId != null ? memoriesById.get(e.memoryId) : undefined;
      return {
        id: e.id,
        kind: e.kind,
        weight: e.weight,
        agentId: e.agentId,
        agentName: agent?.name ?? null,
        agentSlug: agent?.slug ?? null,
        landmarkId: e.landmarkId ?? agent?.landmarkId ?? null,
        conversationId: e.conversationId,
        memoryId: e.memoryId,
        memoryKey: memory?.key ?? null,
        memoryValue: memory?.value ?? null,
        createdAt: e.createdAt,
      };
    }),
    nodes: graph.nodes,
    edges: graph.edges,
  };
}
