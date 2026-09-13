import { relations } from "drizzle-orm";
import {
  users,
  authSessions,
  agents,
  conversations,
  messages,
  delegations,
  agentRuns,
  trailEvents,
  toolEvents,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(authSessions),
  agents: many(agents),
  conversations: many(conversations),
  trailEvents: many(trailEvents),
}));

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, {
    fields: [authSessions.userId],
    references: [users.id],
  }),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  owner: one(users, {
    fields: [agents.ownerUserId],
    references: [users.id],
  }),
  conversations: many(conversations),
  runs: many(agentRuns),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  agent: one(agents, {
    fields: [conversations.agentId],
    references: [agents.id],
  }),
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

/**
 * `memories.subjectId` is polymorphic (user or agent), so it gets no drizzle
 * relation — resolving it requires reading `subjectType` first. Query it through
 * `runtime/memory/store.ts`, which always pairs the two columns.
 */
export const agentRunsRelations = relations(agentRuns, ({ one }) => ({
  agent: one(agents, {
    fields: [agentRuns.agentId],
    references: [agents.id],
  }),
  user: one(users, {
    fields: [agentRuns.userId],
    references: [users.id],
  }),
}));

export const delegationsRelations = relations(delegations, ({ one }) => ({
  fromAgent: one(agents, {
    fields: [delegations.fromAgentId],
    references: [agents.id],
    relationName: "delegationFrom",
  }),
  toAgent: one(agents, {
    fields: [delegations.toAgentId],
    references: [agents.id],
    relationName: "delegationTo",
  }),
}));

export const trailEventsRelations = relations(trailEvents, ({ one }) => ({
  user: one(users, {
    fields: [trailEvents.userId],
    references: [users.id],
  }),
}));

export const toolEventsRelations = relations(toolEvents, ({ one }) => ({
  user: one(users, {
    fields: [toolEvents.userId],
    references: [users.id],
  }),
  agent: one(agents, {
    fields: [toolEvents.agentId],
    references: [agents.id],
  }),
}));
