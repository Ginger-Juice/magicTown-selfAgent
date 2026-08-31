import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, isNull } from "drizzle-orm";
import { createRouter, publicQuery, authedProcedure } from "./middleware";
import { getDb } from "./queries/connection";
import { agents, conversations, delegations, memories, messages } from "@db/schema";
import * as store from "./runtime/memory/store";
import { getTownRuntime } from "./runtime/app";
import { publicCatalog, townDefaultId } from "./runtime/providers/catalog";
import { drainEnvelopes } from "./runtime/a2a/worker";
import { RuntimeError } from "./runtime/errors";
import { AGENT_KINDS, KIND_PRESETS } from "./runtime/registry";
import type { AgentKind, SystemNote } from "./runtime/types";

export { AGENT_KINDS };
export type { AgentKind };

/** Every town-native slug is reserved; `custom` stays open for visitors. */
const RESERVED_SLUGS = new Set<string>(
  AGENT_KINDS.filter((kind) => kind !== "custom"),
);

type TownAgentSeed = {
  kind: AgentKind;
  slug: string;
  name: string;
  persona: string;
  landmarkId: string;
};

/**
 * Behaviour (tools, capability tags, memory slots, ethical floor) lives in
 * runtime/registry.ts. This list only decides which rows exist and where they
 * stand, so the two never drift apart.
 */
const TOWN_AGENTS: TownAgentSeed[] = [
  {
    kind: "work",
    slug: "work",
    name: "书记官",
    persona:
      "镇政厅的书记官。把大事拆成小纸条，桌面永远整齐，从不让一件事沉进档案堆里。说话简短、有条理。",
    landmarkId: "town-hall",
  },
  {
    kind: "diet",
    slug: "diet",
    name: "营养巫师",
    persona:
      "坩埚底茶座的营养巫师。记录三餐但从不说教，清楚一杯甜饮是消遣而不是一餐。语气温和，务实。",
    landmarkId: "coffee",
  },
  {
    kind: "fitness",
    slug: "fitness",
    name: "晨练教练",
    persona:
      "雾港旅店的晨练教练。安排散步、水边慢跑和飞天课前的热身。像个有耐心的老教练，不催不逼。",
    landmarkId: "hotel",
  },
  {
    kind: "code",
    slug: "code",
    name: "符文匠",
    persona:
      "符文工坊的匠人。把咒语稿一行行拆开看，改坏了就重刻一块。说话直接，先问清楚要什么再动手。",
    landmarkId: "design-lab",
  },
  {
    kind: "social",
    slug: "social",
    name: "夜枭酒保",
    persona:
      "夜枭酒馆的酒保。认识镇上每一个人，知道谁在哪栋楼、谁擅长什么。自己不办事，但总能把你引荐给对的人。",
    landmarkId: "livehouse",
  },
  {
    kind: "mixology",
    slug: "mixology",
    name: "调酒师",
    persona:
      "夜枭酒馆的调酒师。先问口味再问心情，无酒精的配方和烈酒一样上心。对配料一板一眼，绝不含糊。",
    landmarkId: "livehouse",
  },
  {
    kind: "study",
    slug: "study",
    name: "禁书塔馆长",
    persona:
      "禁书塔的馆长。检索、比对、给出处，从不凭印象回答。顶层那扇窗关着，别问。",
    landmarkId: "library",
  },
  {
    kind: "divination",
    slug: "divination",
    name: "驻塔巫师",
    persona:
      "斜塔巫师楼的驻塔巫师。摊开塔罗牌讲故事，把牌面当成一面镜子而不是判决书。神秘但坦率。",
    landmarkId: "magic-house",
  },
];

function parseToolIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function publicAgent(row: typeof agents.$inferSelect) {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    kind: row.kind,
    slug: row.slug,
    name: row.name,
    persona: row.persona,
    toolIds: parseToolIds(row.toolIds),
    capabilityTags: parseToolIds(row.capabilityTags),
    landmarkId: row.landmarkId,
    createdAt: row.createdAt,
  };
}

/** Idempotent by slug, so adding a resident never needs a migration. */
async function ensureTownAgents() {
  const db = getDb();
  for (const seed of TOWN_AGENTS) {
    const existing = await db.query.agents.findFirst({
      where: eq(agents.slug, seed.slug),
    });
    if (existing) continue;
    const preset = KIND_PRESETS[seed.kind];
    await db.insert(agents).values({
      ownerUserId: null,
      kind: seed.kind,
      slug: seed.slug,
      name: seed.name,
      persona: seed.persona,
      toolIds: JSON.stringify(preset.toolIds),
      capabilityTags: JSON.stringify(preset.capabilityTags),
      provider: preset.defaultProvider,
      providerOptions: "{}",
      landmarkId: seed.landmarkId,
    });
  }
}

const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{2,24}$/, { message: "invalid_handle" });

/**
 * Runtime notes become `system` rows so a handoff or a memory proposal is
 * visible in the transcript itself, not just in whatever UI happens to render.
 */
async function persistNotes(
  conversationId: number,
  agentId: number,
  notes: SystemNote[],
): Promise<void> {
  if (!notes.length) return;
  const db = getDb();
  for (const note of notes) {
    await db.insert(messages).values({
      conversationId,
      fromKind: "system",
      fromUserId: null,
      fromAgentId: agentId,
      body: note.body,
      meta: JSON.stringify({ kind: note.kind, ...(note.meta ?? {}) }),
    });
  }
}

function describeFailure(err: unknown): string {
  if (err instanceof RuntimeError) {
    switch (err.code) {
      case "no_credentials":
        return "镇上的通讯水晶还没接好（.env 里一个模型 key 都没填），居民暂时说不出话。";
      case "provider_failed":
        return "通讯水晶忽明忽暗，这次没接通，稍后再试。";
      case "depth_exceeded":
        return "这件事转了太多手，先停下来。";
      default:
        return "刚才出了点岔子，这句话没能送到。";
    }
  }
  return "刚才出了点岔子，这句话没能送到。";
}

export const agentRouter = createRouter({
  listTown: publicQuery.query(async () => {
    await ensureTownAgents();
    const rows = await getDb()
      .select()
      .from(agents)
      .where(isNull(agents.ownerUserId))
      .orderBy(agents.id);
    return rows.map(publicAgent);
  }),

  listMine: authedProcedure.query(async ({ ctx }) => {
    const row = await getDb().query.agents.findFirst({
      where: eq(agents.ownerUserId, ctx.user.id),
    });
    return row ? publicAgent(row) : null;
  }),

  register: authedProcedure
    .input(
      z.object({
        kind: z.enum(AGENT_KINDS),
        handle: handleSchema,
        name: z.string().trim().min(1).max(80),
        persona: z.string().trim().min(1).max(2000),
        landmarkId: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (RESERVED_SLUGS.has(input.handle)) {
        throw new TRPCError({ code: "CONFLICT", message: "slug_reserved" });
      }
      const db = getDb();
      const mine = await db.query.agents.findFirst({
        where: eq(agents.ownerUserId, ctx.user.id),
      });
      if (mine) {
        throw new TRPCError({ code: "CONFLICT", message: "already_registered" });
      }
      const slug = `u${ctx.user.id}-${input.handle}`;
      const taken = await db.query.agents.findFirst({
        where: eq(agents.slug, slug),
      });
      if (taken) {
        throw new TRPCError({ code: "CONFLICT", message: "slug_taken" });
      }
      const preset = KIND_PRESETS[input.kind as AgentKind];
      const [{ id }] = await db
        .insert(agents)
        .values({
          ownerUserId: ctx.user.id,
          kind: input.kind,
          slug,
          name: input.name,
          persona: input.persona,
          toolIds: JSON.stringify(preset.toolIds),
          capabilityTags: JSON.stringify(preset.capabilityTags),
          // Visitor agents never leave builtin; registry.ts re-checks this.
          provider: "builtin",
          providerOptions: "{}",
          landmarkId: input.landmarkId ?? null,
        })
        .$returningId();
      const row = await db.query.agents.findFirst({ where: eq(agents.id, id) });
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return publicAgent(row);
    }),

  get: authedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const row = await getDb().query.agents.findFirst({
        where: eq(agents.id, input.id),
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return publicAgent(row);
    }),

  /** Model ids and labels only — never a key. Empty `models` means nothing is configured. */
  listModels: publicQuery.query(() => ({
    models: publicCatalog(),
    defaultId: townDefaultId(),
  })),

  setConversationModel: authedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        model: z.string().trim().max(64).nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const convo = await db.query.conversations.findFirst({
        where: eq(conversations.id, input.conversationId),
      });
      if (!convo || convo.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });

      const model = input.model || null;
      if (model && !publicCatalog().some((m) => m.id === model)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "model_unavailable" });
      }

      await db
        .update(conversations)
        .set({ model })
        .where(eq(conversations.id, convo.id));
      return { conversationId: convo.id, model };
    }),

  openConversation: authedProcedure
    .input(
      z.object({
        agentId: z.number().int().positive(),
        model: z.string().trim().max(64).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, input.agentId),
      });
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      const existing = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.agentId, input.agentId),
          eq(conversations.userId, ctx.user.id),
        ),
      });
      if (existing) {
        // An older thread with no pin inherits the town default the first time
        // it is reopened, without overwriting a choice the visitor already made.
        if (!existing.model && input.model) {
          await db
            .update(conversations)
            .set({ model: input.model })
            .where(eq(conversations.id, existing.id));
          return { ...existing, model: input.model };
        }
        return existing;
      }
      const [{ id }] = await db
        .insert(conversations)
        .values({
          agentId: input.agentId,
          userId: ctx.user.id,
          title: agent.name,
          model: input.model || null,
        })
        .$returningId();
      const row = await db.query.conversations.findFirst({
        where: eq(conversations.id, id),
      });
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    }),

  listMessages: authedProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const convo = await db.query.conversations.findFirst({
        where: eq(conversations.id, input.conversationId),
      });
      if (!convo || convo.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, convo.id))
        .orderBy(messages.id);
    }),

  sendMessage: authedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        body: z.string().trim().min(1).max(4000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const convo = await db.query.conversations.findFirst({
        where: eq(conversations.id, input.conversationId),
      });
      if (!convo || convo.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await db.insert(messages).values({
        conversationId: convo.id,
        fromKind: "user",
        fromUserId: ctx.user.id,
        fromAgentId: null,
        body: input.body,
      });

      let envelopesCreated = 0;
      try {
        const result = await getTownRuntime().run({
          agentId: convo.agentId,
          userId: ctx.user.id,
          conversationId: convo.id,
          userMessage: input.body,
          model: convo.model,
        });
        envelopesCreated = result.envelopesCreated;

        const reply = result.finalText.trim();
        if (reply) {
          await db.insert(messages).values({
            conversationId: convo.id,
            fromKind: "agent",
            fromUserId: null,
            fromAgentId: convo.agentId,
            body: reply,
          });
        }
        await persistNotes(convo.id, convo.agentId, result.notes);

        // Deliver right away rather than waiting for the sweeper; the frontend
        // is already polling because it saw a non-zero envelope count.
        if (envelopesCreated > 0) {
          void drainEnvelopes(getTownRuntime(), envelopesCreated).catch((err: unknown) => {
            console.error("[agents] envelope delivery failed", err);
          });
        }
      } catch (err) {
        // A busy agent is a double-submit, not a failure worth writing down.
        if (err instanceof RuntimeError && err.code === "agent_busy") {
          throw new TRPCError({ code: "CONFLICT", message: "agent_busy" });
        }
        await db.insert(messages).values({
          conversationId: convo.id,
          fromKind: "system",
          body: describeFailure(err),
          meta: JSON.stringify({ kind: "notice", failed: true }),
        });
      }

      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, convo.id))
        .orderBy(messages.id);
      return { messages: rows, envelopesCreated };
    }),

  delegate: authedProcedure
    .input(
      z.object({
        fromAgentId: z.number().int().positive(),
        toAgentId: z.number().int().positive(),
        conversationId: z.number().int().positive().optional(),
        prompt: z.string().trim().min(1).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.fromAgentId === input.toAgentId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "same_agent" });
      }
      const db = getDb();
      const [from, to] = await Promise.all([
        db.query.agents.findFirst({ where: eq(agents.id, input.fromAgentId) }),
        db.query.agents.findFirst({ where: eq(agents.id, input.toAgentId) }),
      ]);
      if (!from || !to) throw new TRPCError({ code: "NOT_FOUND" });
      const [{ id }] = await db
        .insert(delegations)
        .values({
          fromAgentId: from.id,
          toAgentId: to.id,
          conversationId: input.conversationId ?? null,
          userId: ctx.user.id,
          status: "pending",
          prompt: input.prompt,
        })
        .$returningId();
      return db.query.delegations.findFirst({ where: eq(delegations.id, id) });
    }),

  listDelegations: authedProcedure.query(async ({ ctx }) => {
    return getDb()
      .select()
      .from(delegations)
      .where(eq(delegations.userId, ctx.user.id))
      .orderBy(desc(delegations.id));
  }),

  /**
   * The visitor's own drawer. Agent-subject rows are deliberately not exposed
   * here — those belong to the agent and contain no visitor data by contract.
   */
  listMemories: authedProcedure.query(async ({ ctx }) => {
    const rows = await store.listForUser({ type: "user", id: ctx.user.id });
    return rows.map((row) => ({
      id: row.id,
      level: row.level,
      key: row.key,
      value: row.value,
      topics: row.topics,
      status: row.status,
      origin: row.origin,
      pinned: row.pinned,
      updatedAt: row.updatedAt,
    }));
  }),

  upsertMemory: authedProcedure
    .input(
      z.object({
        level: z.enum(["L1", "L2"]),
        key: z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9_]{1,23}:[a-z0-9][a-z0-9_.-]{0,48}$/, { message: "invalid_key" }),
        value: z.string().trim().min(1).max(2000),
        topics: z.string().trim().max(190).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await store.write(
        {
          subject: { type: "user", id: ctx.user.id },
          level: input.level,
          key: input.key,
          value: input.value,
          topics: input.topics,
          origin: "user",
        },
        { slots: [] },
      );
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.reason });
      return { id: result.id, status: result.status };
    }),

  resolveProposal: authedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        accept: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const row = await getDb().query.memories.findFirst({
        where: eq(memories.id, input.id),
      });
      if (!row || row.subjectType !== "user" || row.subjectId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (row.status !== "proposed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "not_a_proposal" });
      }
      await store.setStatus(row.id, input.accept ? "active" : "rejected");
      return { id: row.id, status: input.accept ? "active" : "rejected" };
    }),

  forgetMemory: authedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const result = await store.forget(input.id, {
        origin: "user",
        subject: { type: "user", id: ctx.user.id },
      });
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND", message: result.reason });
      return { id: input.id };
    }),
});
