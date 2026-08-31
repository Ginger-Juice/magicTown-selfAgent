import { z } from "zod";
import { defineTool } from "./registry";
import { fail, ok } from "./lib";
import * as store from "../memory/store";
import type { ToolSpec } from "../types";

/**
 * The only way an agent can touch canon. Policy forces the row to `proposed`
 * no matter what is asked here, so the worst case is a note the visitor has to
 * dismiss.
 */
const proposeMemory = defineTool({
  id: "propose_memory",
  description:
    "把一件关于访客的长期事实提交给访客确认。只能用你被分配的槽位 key。不会立刻生效，访客点过才算数。",
  realAction: true,
  parameters: z.object({
    key: z.string().min(3).max(80).describe("必须是你的槽位 key，如 profile:allergy"),
    value: z.string().min(1).max(400),
    why: z.string().max(200).optional().describe("为什么现在提这条"),
  }),
  async execute(args, ctx) {
    const slot = ctx.definition.memorySlots.find((s) => s.key === args.key);
    if (!slot) {
      return fail("key_not_in_slots", {
        allowed: ctx.definition.memorySlots.map((s) => `${s.key}（${s.desc}）`),
      });
    }

    const result = await store.write(
      {
        subject: { type: "user", id: ctx.user.id },
        level: "L1",
        key: args.key,
        value: args.value,
        origin: "agent",
      },
      {
        slots: ctx.definition.memorySlots,
        proposedByAgentId: ctx.definition.id,
        sourceConversationId: ctx.conversationId,
        sourceRunId: ctx.runId,
      },
    );

    if (!result.ok) return fail("not_proposed", result.reason);

    ctx.notes.push({
      kind: "memory_proposal",
      body: `${ctx.definition.name} 想记住：${args.value}`,
      meta: { memoryId: result.id, key: args.key, why: args.why ?? null },
    });

    return ok({ proposed: true, memoryId: result.id, needsApproval: true });
  },
});

/**
 * Self-subject writes go through the de-identification gate in the store, so a
 * rejection here means the agent tried to keep something about one visitor.
 */
const rememberInsight = defineTool({
  id: "remember_insight",
  description:
    "记下一条你自己的通用经验。不能包含任何具体访客的姓名、联系方式或具体日期——那样会被拒绝。",
  realAction: true,
  parameters: z.object({
    key: z.string().min(3).max(80).describe("形如 craft:late_night"),
    value: z.string().min(1).max(400).describe("一句通识经验"),
    topics: z.string().max(120).optional(),
  }),
  async execute(args, ctx) {
    const result = await store.write(
      {
        subject: { type: "agent", id: ctx.definition.id },
        level: "L2",
        key: args.key,
        value: args.value,
        topics: args.topics ?? "",
        origin: "agent",
      },
      {
        slots: ctx.definition.memorySlots,
        deidentify: {
          displayName: ctx.user.displayName,
          email: ctx.user.email,
          userId: ctx.user.id,
        },
        proposedByAgentId: ctx.definition.id,
        sourceConversationId: ctx.conversationId,
        sourceRunId: ctx.runId,
      },
    );

    if (!result.ok) {
      return fail("not_recorded", {
        reason: result.reason,
        hint: result.reason.startsWith("deidentify:")
          ? "这条带上了访客的个人信息。改写成不指向任何人的说法再试。"
          : undefined,
      });
    }
    return ok({ recorded: true, memoryId: result.id });
  },
});

const forgetInsight = defineTool({
  id: "forget_insight",
  description: "划掉一条你自己的经验。铁律（L1）划不掉，那得访客自己来。",
  realAction: true,
  parameters: z.object({ memoryId: z.number().int().positive() }),
  async execute(args, ctx) {
    const result = await store.forget(args.memoryId, {
      origin: "agent",
      subject: { type: "agent", id: ctx.definition.id },
    });
    if (!result.ok) return fail("not_forgotten", result.reason);
    return ok({ forgotten: true, memoryId: args.memoryId });
  },
});

export const MEMORY_TOOLS: ToolSpec[] = [proposeMemory, rememberInsight, forgetInsight];
