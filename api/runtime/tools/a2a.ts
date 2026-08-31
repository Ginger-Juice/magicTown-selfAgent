import { z } from "zod";
import { defineTool } from "./registry";
import { fail, ok } from "./lib";
import * as envelope from "../a2a/envelope";
import type { EnvelopeType, RunContext, StepOutcome, ToolSpec } from "../types";

const recipient = z
  .string()
  .min(1)
  .max(40)
  .describe("对方的代号、名字或能力标签，如 diet 或 营养巫师");

async function send(
  ctx: RunContext,
  type: EnvelopeType,
  to: string,
  prompt: string,
): Promise<StepOutcome> {
  const target = await envelope.findRecipient(to, ctx.definition.id);
  if (!target) {
    return fail("no_such_agent", {
      query: to,
      directory: await envelope.listTownDirectory(ctx.definition.id),
    });
  }

  const result = await envelope.post({
    fromAgentId: ctx.definition.id,
    toAgentId: target.id,
    userId: ctx.user.id,
    conversationId: ctx.conversationId,
    type,
    prompt,
    depth: ctx.depth,
  });

  if (!result.ok) return fail("not_sent", result.reason);

  ctx.envelopesCreated += 1;
  ctx.notes.push({
    kind: type === "handoff" ? "handoff" : "delegation_sent",
    body:
      type === "handoff"
        ? `${ctx.definition.name} 把这件事交给了${target.name}。`
        : `${ctx.definition.name} 给${target.name}递了张条子。`,
    meta: { envelopeId: result.envelope.id, toAgentId: target.id, type },
  });

  return {
    data: {
      sent: true,
      to: target.name,
      envelopeId: result.envelope.id,
      // Surfaced so the model can tell the visitor a reply is coming later
      // rather than pretending it already has one.
      replyArrivesLater: type !== "tell",
      warning: result.warned ? "你们最近来回得有点频繁了。" : undefined,
    },
    // A handoff means this agent is done talking; anything else would step on
    // the resident who just took over.
    shouldExit: type === "handoff",
  };
}

const askAgent = defineTool({
  id: "ask_agent",
  description:
    "向另一位镇民提问，回信稍后送达。你不会立刻拿到答案，不要替对方编造答复。",
  realAction: true,
  parameters: z.object({
    to: recipient,
    question: z.string().min(1).max(1000),
  }),
  async execute(args, ctx) {
    return send(ctx, "ask", args.to, args.question);
  },
});

const tellAgent = defineTool({
  id: "tell_agent",
  description: "给另一位镇民留个口信，不需要回信。",
  realAction: true,
  parameters: z.object({
    to: recipient,
    message: z.string().min(1).max(1000),
  }),
  async execute(args, ctx) {
    return send(ctx, "tell", args.to, args.message);
  },
});

const handoff = defineTool({
  id: "handoff",
  description:
    "把整件事交给更合适的镇民接手。调用之后你这一轮就结束了，不要再补话。",
  realAction: true,
  parameters: z.object({
    to: recipient,
    context: z.string().min(1).max(1000).describe("交接说明：访客想要什么，你已经做到哪一步"),
  }),
  async execute(args, ctx) {
    return send(ctx, "handoff", args.to, args.context);
  },
});

const listTown = defineTool({
  id: "list_town",
  description: "看看镇上还有谁、各自擅长什么。找人之前先查这个，别猜代号。",
  parameters: z.object({}),
  async execute(_args, ctx) {
    return ok({ residents: await envelope.listTownDirectory(ctx.definition.id) });
  },
});

export const A2A_TOOLS: ToolSpec[] = [askAgent, tellAgent, handoff, listTown];
