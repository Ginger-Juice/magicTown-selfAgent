/**
 * Factual cheat sheets. Tools read these on demand. They do not belong in
 * persona or selfCanon, and they are not copied into the system prompt.
 */
import majorArcanaPack from "./divination/major-arcana.zh.json";
import coachingPack from "./fitness/coaching-basics.zh.json";
import platePack from "./diet/healthy-plate.zh.json";

export { majorArcanaPack, coachingPack, platePack };

export type MajorCard = (typeof majorArcanaPack.cards)[number];
export type TarotSpread = (typeof majorArcanaPack.spreads)[number];

function norm(text: string): string {
  return text.trim().toLowerCase();
}

/** Exact name first, then a name that contains the query. */
export function findMajorCard(query: string): MajorCard | undefined {
  const q = norm(query);
  if (!q) return undefined;
  return (
    majorArcanaPack.cards.find(c => norm(c.name) === q) ??
    majorArcanaPack.cards.find(c => norm(c.name).includes(q))
  );
}

const SPREAD_ALIASES: Record<string, readonly string[]> = {
  single: ["单牌", "单张"],
  three: ["三牌", "三张", "三牌阵"],
};

export function findSpread(query: string): TarotSpread | undefined {
  const q = norm(query);
  if (!q) return undefined;
  return majorArcanaPack.spreads.find(spread => {
    if (norm(spread.name) === q || norm(spread.id) === q) return true;
    return (SPREAD_ALIASES[spread.id] ?? []).some(alias => norm(alias) === q);
  });
}

const PLATE_QUERIES = new Set(["plate", "健康餐盘", "餐盘", "搭配原则"]);

export function isPlateQuery(query: string): boolean {
  return PLATE_QUERIES.has(norm(query));
}
