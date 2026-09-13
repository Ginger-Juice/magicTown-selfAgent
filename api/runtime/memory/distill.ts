import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { conversations, messages, users } from "@db/schema";
import { getDb } from "../../queries/connection";
import { LIMITS } from "../limits";
import { loadDefinition } from "../registry";
import { archiveIdlePending } from "../hooks/divination";
import { renderForDistill, type StoredMessage } from "../transcript";
import { resolveBuiltinProvider } from "../providers/builtin";
import * as store from "./store";
import type { Provider } from "../providers/types";
import type { AgentDefinition } from "../types";

/**
 * Both prompts ask for plain lines rather than JSON: the output is written to a
 * text column and shown to the visitor, so a parse failure would be a worse
 * outcome than a slightly untidy sentence.
 */
const COMPRESS_PROMPT = `你在压缩一段对话，供之后继续对话时参考。
只写事实与已达成的结论，不要评论，不要重复寒暄。
控制在 200 字以内，用陈述句，一行一件事。`;

const DISTILL_PROMPT = (definition: AgentDefinition) => {
  const extra =
    definition.kind === "divination"
      ? [
          "这是魔法小屋的对话。每次占卜已经单独归档（牌面、解读、反馈），USER 部分不要再复述某次抽牌。",
          "只记访客稳定的偏好，比如喜欢哪种牌阵、不爱听太凶的说法。占卜不是事实，不要写成铁律口吻。",
        ].join("\n")
      : "";
  return `你是${definition.name}。
刚结束一次与访客的对话。请分两部分回答，各自另起一行，没有内容就写「无」。
${extra}

USER: 关于这位访客的、下次仍然成立的偏好或事实，最多 3 条，每条一行，以「- 」开头。
SELF: 关于你这门手艺的通用经验，最多 2 条，每条一行，以「- 」开头。
SELF 部分绝对不能出现访客的姓名、称呼、联系方式或任何具体日期——写成对任何访客都成立的说法。`;
};

async function complete(provider: Provider, system: string, user: string): Promise<string> {
  let text = "";
  for await (const chunk of provider.run({
    system,
    messages: [{ role: "user", content: user }],
    tools: [],
    maxOutputTokens: LIMITS.distillMaxOutputTokens,
    signal: AbortSignal.timeout(LIMITS.wallClockMs),
  })) {
    if (chunk.type === "text") text += chunk.delta;
    if (chunk.type === "error") throw new Error(chunk.message);
  }
  return text.trim();
}

/**
 * Folds the overflow head of a transcript into the rolling L3 row. Called
 * lazily after a turn, so a conversation that goes quiet simply keeps whatever
 * summary it had.
 */
export async function compressSession(input: {
  conversationId: number;
  userId: number;
  overflow: StoredMessage[];
  provider?: Provider;
}): Promise<boolean> {
  if (!input.overflow.length) return false;

  const provider = input.provider ?? resolveBuiltinProvider();
  const previous = await store.readSession(input.conversationId, input.userId);
  const body = [
    previous && `已有摘要：\n${previous}`,
    `新增对话：\n${renderForDistill(input.overflow)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const summary = await complete(provider, COMPRESS_PROMPT, body);
    if (!summary) return false;
    await store.writeSession(input.conversationId, input.userId, summary);
    return true;
  } catch (err) {
    console.error("[distill] session compression failed", err);
    return false;
  }
}

export type DistilledLines = { user: string[]; self: string[] };

/**
 * Splits the two-section reply. Anything outside a recognised section is
 * dropped rather than guessed at.
 */
export function parseDistilled(text: string): DistilledLines {
  const out: DistilledLines = { user: [], self: [] };
  let section: keyof DistilledLines | null = null;

  const take = (into: keyof DistilledLines, value: string) => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== "无") out[into].push(trimmed);
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const header = /^(USER|SELF)[:：]/i.exec(line);
    if (header) {
      section = header[1].toUpperCase() === "USER" ? "user" : "self";
      const inline = line.slice(header[0].length).trim();
      if (inline.startsWith("- ")) take(section, inline.slice(2));
      continue;
    }
    if (!section || !line.startsWith("- ")) continue;
    take(section, line.slice(2));
  }

  out.user = out.user.slice(0, 3);
  out.self = out.self.slice(0, 2);
  return out;
}

function insightKey(prefix: string, index: number, seed: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}:${hash.toString(36)}${index}`;
}

/**
 * The L3 to L2 promotion. Self-subject lines pass through the store's
 * de-identification gate, so a rejected line is simply lost — which is the
 * intended trade.
 */
export async function distillConversation(input: {
  conversationId: number;
  provider?: Provider;
}): Promise<{ userWritten: number; selfWritten: number } | null> {
  const db = getDb();
  const convo = await db.query.conversations.findFirst({
    where: eq(conversations.id, input.conversationId),
  });
  if (!convo) return null;

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convo.id))
    .orderBy(asc(messages.id));

  const transcript = renderForDistill(rows);
  if (!transcript.trim()) {
    await markDigested(convo.id);
    return { userWritten: 0, selfWritten: 0 };
  }

  const [definition, visitor] = await Promise.all([
    loadDefinition(convo.agentId),
    db.query.users.findFirst({ where: eq(users.id, convo.userId) }),
  ]);

  if (definition.kind === "divination") {
    try {
      await archiveIdlePending(convo.id, convo.userId);
    } catch (err) {
      console.error("[distill] leftover reading archive failed", err);
    }
  }

  const provider = input.provider ?? resolveBuiltinProvider();

  let parsed: DistilledLines;
  try {
    parsed = parseDistilled(await complete(provider, DISTILL_PROMPT(definition), transcript));
  } catch (err) {
    console.error("[distill] conversation distillation failed", err);
    return null;
  }

  let userWritten = 0;
  for (const [i, value] of parsed.user.entries()) {
    const result = await store.write(
      {
        subject: { type: "user", id: convo.userId },
        level: "L2",
        key: insightKey("insight", i, value),
        value,
        origin: "system",
      },
      { slots: definition.memorySlots, sourceConversationId: convo.id },
    );
    if (result.ok) userWritten += 1;
  }

  let selfWritten = 0;
  for (const [i, value] of parsed.self.entries()) {
    const result = await store.write(
      {
        subject: { type: "agent", id: definition.id },
        level: "L2",
        key: insightKey("craft", i, value),
        value,
        origin: "system",
      },
      {
        slots: definition.memorySlots,
        deidentify: {
          displayName: visitor?.displayName ?? "",
          email: visitor?.email ?? "",
          userId: convo.userId,
          transcript,
        },
        sourceConversationId: convo.id,
      },
    );
    if (result.ok) selfWritten += 1;
  }

  await markDigested(convo.id);
  return { userWritten, selfWritten };
}

async function markDigested(conversationId: number): Promise<void> {
  await getDb()
    .update(conversations)
    .set({ digestedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

/**
 * Finds conversations that have gone quiet long enough to be worth distilling.
 * There is no cron here, so this is driven by `boot.ts` on an interval and by
 * the next turn that happens to touch the table.
 */
export async function findIdleConversations(limit = 5): Promise<number[]> {
  const cutoff = new Date(Date.now() - LIMITS.idleDistillMs);
  const rows = await getDb()
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        lt(conversations.updatedAt, cutoff),
        or(isNull(conversations.digestedAt), lt(conversations.digestedAt, conversations.updatedAt)),
        sql`EXISTS (SELECT 1 FROM messages m WHERE m.conversationId = ${conversations.id})`,
      ),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function sweepIdleConversations(): Promise<number> {
  const ids = await findIdleConversations();
  let done = 0;
  for (const id of ids) {
    try {
      if (await distillConversation({ conversationId: id })) done += 1;
    } catch (err) {
      console.error(`[distill] sweep failed for conversation ${id}`, err);
    }
  }
  return done;
}
