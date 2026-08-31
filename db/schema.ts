import {
  mysqlTable,
  bigint,
  int,
  varchar,
  mediumtext,
  timestamp,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Drizzle's `serial()` emits `serial AUTO_INCREMENT`, which MariaDB rejects.
 * This is the same type (unsigned bigint, autoincrement) without the alias.
 */
const serialId = () =>
  bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey();

export const wishes = mysqlTable("wishes", {
  id: serialId(),
  text: varchar("text", { length: 120 }).notNull(),
  accent: varchar("accent", { length: 9 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Wish = typeof wishes.$inferSelect;
export type InsertWish = typeof wishes.$inferInsert;

export const postcards = mysqlTable("postcards", {
  id: serialId(),
  message: varchar("message", { length: 280 }).notNull(),
  signature: varchar("signature", { length: 60 }).notNull(),
  doodle: varchar("doodle", { length: 20 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Postcard = typeof postcards.$inferSelect;
export type InsertPostcard = typeof postcards.$inferInsert;

export const newsletterSubs = mysqlTable("newsletter_subs", {
  id: serialId(),
  email: varchar("email", { length: 190 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type NewsletterSub = typeof newsletterSubs.$inferSelect;
export type InsertNewsletterSub = typeof newsletterSubs.$inferInsert;

export const footprints = mysqlTable(
  "footprints",
  {
    id: serialId(),
    ip: varchar("ip", { length: 45 }).notNull(),
    day: varchar("day", { length: 10 }).notNull(), // YYYY-MM-DD, UTC
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("footprints_ip_day_unique").on(table.ip, table.day)],
);

export type Footprint = typeof footprints.$inferSelect;
export type InsertFootprint = typeof footprints.$inferInsert;

export const applePhotos = mysqlTable("apple_photos", {
  id: serialId(),
  date: varchar("date", { length: 10 }).notNull().unique(), // YYYY-MM-DD
  description: varchar("description", { length: 500 }).notNull().default(""),
  image: mediumtext("image").notNull(), // base64 data URL
  video: mediumtext("video"), // base64 data URL for live-photo motion
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
});

export type ApplePhoto = typeof applePhotos.$inferSelect;
export type InsertApplePhoto = typeof applePhotos.$inferInsert;

/** Town visitor account — required before talking to / registering an agent. */
export const users = mysqlTable("users", {
  id: serialId(),
  email: varchar("email", { length: 190 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  displayName: varchar("displayName", { length: 60 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const authSessions = mysqlTable(
  "auth_sessions",
  {
    id: serialId(),
    userId: int("userId").notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("auth_sessions_user_idx").on(table.userId)],
);

export type AuthSession = typeof authSessions.$inferSelect;

/**
 * Town-native agents have `ownerUserId = null` (fitness / work / diet).
 * A visitor may register at most one agent (`ownerUserId` unique when set).
 */
export const agents = mysqlTable(
  "agents",
  {
    id: serialId(),
    ownerUserId: int("ownerUserId"),
    kind: varchar("kind", { length: 32 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull().unique(),
    name: varchar("name", { length: 80 }).notNull(),
    persona: mediumtext("persona").notNull(),
    toolIds: mediumtext("toolIds").notNull(),
    landmarkId: varchar("landmarkId", { length: 64 }),
    /** builtin | cursor | codex. Never trusted for owned agents — see runtime/registry.ts. */
    provider: varchar("provider", { length: 16 }).notNull().default("builtin"),
    providerOptions: mediumtext("providerOptions").notNull().default("{}"),
    capabilityTags: mediumtext("capabilityTags").notNull().default("[]"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
  },
  (table) => [index("agents_kind_idx").on(table.kind), index("agents_owner_idx").on(table.ownerUserId)],
);

export type Agent = typeof agents.$inferSelect;
export type InsertAgent = typeof agents.$inferInsert;

export const conversations = mysqlTable(
  "conversations",
  {
    id: serialId(),
    agentId: int("agentId").notNull(),
    userId: int("userId").notNull(),
    title: varchar("title", { length: 120 }),
    /** `vendor:model` the visitor picked. Null means the town default. */
    model: varchar("model", { length: 64 }),
    /** Watermark for L3 -> L2 distillation. Owed when updatedAt > digestedAt. */
    digestedAt: timestamp("digestedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("conversations_agent_user_unique").on(table.agentId, table.userId),
    index("conversations_user_idx").on(table.userId),
  ],
);

export type Conversation = typeof conversations.$inferSelect;

export const messages = mysqlTable(
  "messages",
  {
    id: serialId(),
    conversationId: int("conversationId").notNull(),
    fromKind: varchar("fromKind", { length: 16 }).notNull(), // user | agent | system
    fromUserId: int("fromUserId"),
    fromAgentId: int("fromAgentId"),
    body: mediumtext("body").notNull(),
    /** JSON. `kind` drives UI: handoff | memory_proposal | void_ball | tool_trace. */
    meta: mediumtext("meta"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("messages_conversation_idx").on(table.conversationId)],
);

export type Message = typeof messages.$inferSelect;

/**
 * Two memory subjects, three levels each.
 *
 * `subjectType = 'user'` rows are shared across every agent, filtered by `topics`.
 * `subjectType = 'agent'` rows hold de-identified craft knowledge only — there is
 * deliberately no column able to point at a user, which is the hardest of the three
 * de-identification gates.
 */
export const memories = mysqlTable(
  "memories",
  {
    id: serialId(),
    subjectType: varchar("subjectType", { length: 8 }).notNull(), // user | agent
    subjectId: int("subjectId").notNull(),
    level: varchar("level", { length: 4 }).notNull(), // L1 | L2 | L3
    conversationId: int("conversationId"), // L3 only; forced null for agent subjects
    key: varchar("key", { length: 80 }).notNull(),
    /** `${subjectType}:${subjectId}:${conversationId ?? 0}:${key}` — MySQL unique indexes allow many NULLs. */
    memoKey: varchar("memoKey", { length: 160 }).notNull(),
    value: mediumtext("value").notNull(),
    /** Comma separated. Empty = every agent may read it. */
    topics: varchar("topics", { length: 190 }).notNull().default(""),
    status: varchar("status", { length: 12 }).notNull().default("active"), // active | proposed | rejected
    origin: varchar("origin", { length: 8 }).notNull().default("agent"), // user | agent | system
    pinned: boolean("pinned").notNull().default(false),
    proposedByAgentId: int("proposedByAgentId"),
    sourceConversationId: int("sourceConversationId"),
    sourceRunId: int("sourceRunId"),
    hits: int("hits").notNull().default(0),
    lastUsedAt: timestamp("lastUsedAt"),
    expiresAt: timestamp("expiresAt"), // L1 never expires
    deletedAt: timestamp("deletedAt"), // forget is a soft delete
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("memories_key_unique").on(table.memoKey),
    index("memories_subject_idx").on(table.subjectType, table.subjectId, table.level),
    index("memories_status_idx").on(table.status),
  ],
);

export type Memory = typeof memories.$inferSelect;
export type InsertMemory = typeof memories.$inferInsert;

export const delegations = mysqlTable(
  "delegations",
  {
    id: serialId(),
    fromAgentId: int("fromAgentId").notNull(),
    toAgentId: int("toAgentId").notNull(),
    conversationId: int("conversationId"),
    userId: int("userId").notNull(),
    status: varchar("status", { length: 16 }).notNull(), // pending | done | failed | expired
    type: varchar("type", { length: 16 }).notNull().default("ask"), // ask | tell | handoff
    depth: int("depth").notNull().default(0),
    attempts: int("attempts").notNull().default(0),
    expiresAt: timestamp("expiresAt"),
    /** Reply is written back after this message in the originating conversation. */
    originMessageId: int("originMessageId"),
    lastError: mediumtext("lastError"),
    prompt: mediumtext("prompt").notNull(),
    reply: mediumtext("reply"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().onUpdateNow(),
  },
  (table) => [
    index("delegations_to_status_idx").on(table.toAgentId, table.status),
    index("delegations_status_expires_idx").on(table.status, table.expiresAt),
  ],
);

export type Delegation = typeof delegations.$inferSelect;

/**
 * One row per turn. Doubles as the single-flight lock: `lockKey` is unique and
 * MySQL permits many NULLs, so a running turn holds `${agentId}:${userId}` and
 * clears it on finish. Needed because the planetscale driver has no transactions.
 */
export const agentRuns = mysqlTable(
  "agent_runs",
  {
    id: serialId(),
    agentId: int("agentId").notNull(),
    userId: int("userId").notNull(),
    conversationId: int("conversationId"),
    depth: int("depth").notNull().default(0),
    status: varchar("status", { length: 16 }).notNull(), // running | done | failed
    lockKey: varchar("lockKey", { length: 64 }),
    steps: int("steps").notNull().default(0),
    inputTokens: int("inputTokens").notNull().default(0),
    outputTokens: int("outputTokens").notNull().default(0),
    trace: mediumtext("trace"),
    error: mediumtext("error"),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    finishedAt: timestamp("finishedAt"),
  },
  (table) => [uniqueIndex("agent_runs_lock_unique").on(table.lockKey)],
);

export type AgentRun = typeof agentRuns.$inferSelect;
