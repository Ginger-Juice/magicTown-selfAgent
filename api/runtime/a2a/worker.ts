import { eq } from "drizzle-orm";
import { agents, messages } from "@db/schema";
import { getDb } from "../../queries/connection";
import { RuntimeError } from "../errors";
import * as envelope from "./envelope";
import type { ClaimedEnvelope } from "./envelope";
import type { Runtime } from "../index";

/**
 * The envelope prompt is deliberately framed as a note from a colleague, not
 * as a visitor turn: the recipient must not start addressing the sender as if
 * they were the person sitting in the conversation.
 */
function renderErrand(from: string, row: ClaimedEnvelope): string {
  const opener =
    row.type === "handoff"
      ? `${from}把一位访客交接给你，附言如下。请直接接手，不要再转回去。`
      : row.type === "tell"
        ? `${from}给你带了个口信，不需要回信。`
        : `${from}托人问你一件事，请直接回答。`;

  return `<errand from="${from}" type="${row.type}">\n${opener}\n\n${row.prompt}\n</errand>`;
}

async function writeReply(row: ClaimedEnvelope, fromName: string, body: string): Promise<void> {
  if (!row.conversationId) return;
  await getDb()
    .insert(messages)
    .values({
      conversationId: row.conversationId,
      fromKind: "agent",
      fromUserId: null,
      fromAgentId: row.toAgentId,
      body,
      meta: JSON.stringify({ kind: "envelope_reply", envelopeId: row.id, from: fromName }),
    });
}

async function writeNotice(row: ClaimedEnvelope, body: string): Promise<void> {
  if (!row.conversationId) return;
  await getDb()
    .insert(messages)
    .values({
      conversationId: row.conversationId,
      fromKind: "system",
      fromUserId: null,
      fromAgentId: row.toAgentId,
      body,
      meta: JSON.stringify({ kind: "notice", envelopeId: row.id }),
    });
}

export async function deliverOne(runtime: Runtime): Promise<boolean> {
  const row = await envelope.claimNext();
  if (!row) return false;

  const db = getDb();
  const [from, to] = await Promise.all([
    db.query.agents.findFirst({ where: eq(agents.id, row.fromAgentId) }),
    db.query.agents.findFirst({ where: eq(agents.id, row.toAgentId) }),
  ]);

  if (!from || !to) {
    await envelope.fail(row.id, "agent_missing");
    return true;
  }

  try {
    const result = await runtime.run({
      agentId: row.toAgentId,
      userId: row.userId,
      conversationId: row.conversationId,
      userMessage: renderErrand(from.name, row),
      depth: row.depth,
    });

    const reply = result.finalText.trim();
    await envelope.complete(row.id, reply);

    // A `tell` is a one-way note; posting a reply for it would put words in
    // the conversation that nobody asked for.
    if (reply && row.type !== "tell") await writeReply(row, from.name, reply);
    return true;
  } catch (err) {
    // A busy recipient is a scheduling problem, not a failure — put it back.
    if (err instanceof RuntimeError && err.code === "agent_busy") {
      await envelope.fail(row.id, "recipient_busy");
      return true;
    }

    const verdict = await envelope.fail(row.id, err instanceof Error ? err.message : String(err));
    if (verdict === "gave_up") {
      await writeNotice(row, `${to.name}那边没能回上话，这张条子先作废了。`);
    }
    return true;
  }
}

/** Drains at most `limit` envelopes, stopping early when the box is empty. */
export async function drainEnvelopes(runtime: Runtime, limit = 5): Promise<number> {
  let delivered = 0;
  for (let i = 0; i < limit; i++) {
    if (!(await deliverOne(runtime))) break;
    delivered += 1;
  }
  return delivered;
}
