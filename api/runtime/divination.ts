/**
 * Magic-house readings are entertainment, never canon. They still have to be
 * filed every time: the cards that came up, the interpretation given, and the
 * visitor's reaction afterwards.
 */

export const PENDING_READING_KEY = "session:pending_reading";
export const READING_KEY_PREFIX = "reading:";

export type DrawnCard = {
  name: string;
  reversed: boolean;
};

export type DrawnSpread = {
  question: string | null;
  cards: DrawnCard[];
  spread: string | null;
};

export type PendingReading = DrawnSpread & {
  interpretation: string;
};

export type ReadingArchive = PendingReading & {
  feedback: string | null;
};

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function formatCards(cards: DrawnCard[]): string {
  return cards.map((c) => `${c.name}${c.reversed ? "(逆)" : "(正)"}`).join("、");
}

export function formatReadingArchive(reading: ReadingArchive): string {
  return [
    reading.question ? `问：${reading.question}` : null,
    reading.cards.length ? `牌：${formatCards(reading.cards)}` : null,
    reading.spread ? `阵：${reading.spread}` : null,
    reading.interpretation ? `解读：${reading.interpretation.trim()}` : null,
    reading.feedback ? `反馈：${reading.feedback.trim()}` : "反馈：尚未开口",
  ]
    .filter(Boolean)
    .join("｜");
}

/** A fresh row per reading so a second draw of the same question is not an overwrite. */
export function uniqueReadingKey(seed: string, at = Date.now()): string {
  const stamp = new Date(at).toISOString().replace(/[-:]/g, "").slice(0, 13).toLowerCase();
  return `reading:${stamp}.${fnv1a(seed).slice(0, 8)}`;
}

export function parseDrawnSpread(data: unknown): DrawnSpread | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as {
    cards?: unknown;
    question?: unknown;
    spread?: unknown;
    error?: unknown;
  };
  if (raw.error || !Array.isArray(raw.cards) || raw.cards.length === 0) return null;
  const cards: DrawnCard[] = [];
  for (const card of raw.cards) {
    if (!card || typeof card !== "object") return null;
    const name = (card as { name?: unknown }).name;
    if (typeof name !== "string" || !name.trim()) return null;
    cards.push({ name: name.trim(), reversed: Boolean((card as { reversed?: unknown }).reversed) });
  }
  return {
    cards,
    question: typeof raw.question === "string" && raw.question.trim() ? raw.question.trim() : null,
    spread: typeof raw.spread === "string" ? raw.spread : null,
  };
}

export type ArchiveDecision =
  | { action: "noop" }
  | { action: "clear" }
  | { action: "stash"; pending: PendingReading }
  | { action: "archive"; archive: ReadingArchive; stash: PendingReading | null };

/**
 * One turn of the magic-house ledger. Draw → stash interpretation; next visitor
 * line is treated as feedback and filed. `log_reading` on the same turn wins
 * so the model can still write the archive itself.
 */
export function decideArchiveAction(input: {
  kind: string;
  drew: DrawnSpread | null;
  loggedThisTurn: boolean;
  pending: PendingReading | null;
  userMessage: string;
  interpretation: string;
}): ArchiveDecision {
  if (input.kind !== "divination") return { action: "noop" };

  if (input.loggedThisTurn) return { action: "clear" };

  const interpretation = input.interpretation.trim();
  const feedback = input.userMessage.trim() || null;

  if (input.drew) {
    const stash: PendingReading = {
      ...input.drew,
      interpretation: interpretation || "（解读写在对话里）",
    };
    if (input.pending) {
      return {
        action: "archive",
        archive: { ...input.pending, feedback },
        stash,
      };
    }
    return { action: "stash", pending: stash };
  }

  if (input.pending) {
    return {
      action: "archive",
      archive: { ...input.pending, feedback },
      stash: null,
    };
  }

  return { action: "noop" };
}

export const DIVINATION_ARCHIVE_RULES = [
  "魔法小屋的记事规矩：",
  "- 每次占卜必须先调用 draw_tarot 抽牌，禁止自己编牌。",
  "- 解读只是镜子，不是事实，永远不要写成铁律。",
  "- 访客对这次解读开口之后，调用 log_reading，把牌面、你的解读、对方的反馈一并归档。",
  "- 开新牌之前先用 list_readings 看一眼往期档案，避免把同一套故事讲两遍。",
].join("\n");
