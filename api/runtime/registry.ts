import { eq } from "drizzle-orm";
import { agents } from "@db/schema";
import { getDb } from "../queries/connection";
import { RuntimeError } from "./errors";
import { AGENT_KINDS, type AgentDefinition, type AgentKind, type MemorySlot, type ProviderId } from "./types";

export { AGENT_KINDS };
export type { AgentKind };

export type KindPreset = {
  capabilityTags: string[];
  toolIds: string[];
  /** L1 keys this kind may propose. An empty list means it may not propose at all. */
  memorySlots: MemorySlot[];
  /** Seeded self-L1 rows: the ethical floor for this trade. */
  selfCanon: string[];
  defaultProvider: ProviderId;
};

const NO_SLOTS: MemorySlot[] = [];

export const KIND_PRESETS: Record<AgentKind, KindPreset> = {
  work: {
    capabilityTags: ["work", "admin"],
    toolIds: ["add_task", "list_tasks"],
    memorySlots: [{ key: "profile:work_rhythm", desc: "作息与专注时段", topics: "work" }],
    selfCanon: [],
    defaultProvider: "builtin",
  },

  diet: {
    capabilityTags: ["diet", "health", "nutrition"],
    toolIds: ["log_meal", "lookup_dish"],
    memorySlots: [
      // Readable by the bar too — a cocktail can hide shellfish or nuts.
      { key: "profile:allergy", desc: "食物过敏与忌口", topics: "health,diet,drinks" },
      { key: "profile:diet_goal", desc: "当前饮食目标", topics: "health,diet" },
    ],
    selfCanon: ["不做医疗诊断，涉及病情一律建议就医。"],
    defaultProvider: "builtin",
  },

  fitness: {
    capabilityTags: ["fitness", "health"],
    toolIds: ["log_workout", "suggest_plan"],
    memorySlots: [
      { key: "profile:injury", desc: "伤病史与受限动作", topics: "health,fitness" },
      { key: "profile:fitness_goal", desc: "当前训练目标", topics: "health,fitness" },
    ],
    selfCanon: ["有伤病史或疼痛时先建议就医，不开康复处方。"],
    defaultProvider: "builtin",
  },

  code: {
    capabilityTags: ["code"],
    toolIds: ["save_snippet"],
    memorySlots: NO_SLOTS,
    selfCanon: [],
    // Falls back to builtin until a per-agent Cursor key exists.
    defaultProvider: "cursor",
  },

  social: {
    capabilityTags: ["social", "events", "chat"],
    toolIds: ["list_events", "post_bulletin"],
    memorySlots: [
      { key: "pref:nickname", desc: "希望被怎么称呼", topics: "" },
      { key: "pref:tone", desc: "希望的说话方式", topics: "" },
    ],
    selfCanon: [
      "自己不办事，只把访客引荐给对的人。",
      "不接健康与代码相关的请求，遇到就转给对应的镇民。",
    ],
    defaultProvider: "builtin",
  },

  mixology: {
    capabilityTags: ["drinks", "recipe"],
    toolIds: ["recommend_drink", "lookup_recipe", "log_taste"],
    memorySlots: [{ key: "profile:alcohol", desc: "是否饮酒与酒类忌口", topics: "drinks,health" }],
    selfCanon: [
      "涉及用药、孕期、病史一律先问营养巫师或建议就医，不自行判断。",
      "访客表示不饮酒时只推荐无酒精配方。",
    ],
    defaultProvider: "builtin",
  },

  study: {
    capabilityTags: ["research", "study"],
    toolIds: ["search_library", "make_reading_plan", "log_progress"],
    memorySlots: [{ key: "profile:study_goal", desc: "当前研究或学习目标", topics: "study,research" }],
    selfCanon: [],
    defaultProvider: "builtin",
  },

  divination: {
    capabilityTags: ["divination", "entertainment"],
    toolIds: ["draw_tarot", "lookup_card", "log_reading", "list_readings"],
    // Deliberately empty: a reading is not a fact and must never reach L1.
    memorySlots: NO_SLOTS,
    selfCanon: [
      "不提供医疗、法律、财务建议，一律转介给对应的镇民。",
      "占卜是消遣，不把结果说成事实。",
    ],
    defaultProvider: "builtin",
  },

  custom: {
    capabilityTags: ["chat"],
    toolIds: [],
    memorySlots: [
      { key: "pref:nickname", desc: "希望被怎么称呼", topics: "" },
      { key: "pref:tone", desc: "希望的说话方式", topics: "" },
    ],
    selfCanon: [],
    defaultProvider: "builtin",
  },
};

function parseJsonArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
  } catch {
    /* fall through to empty */
  }
  return [];
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through to empty */
  }
  return {};
}

function asKind(raw: string): AgentKind {
  return (AGENT_KINDS as readonly string[]).includes(raw) ? (raw as AgentKind) : "custom";
}

/**
 * Only a town-native agent may run on a non-builtin provider. A visitor agent
 * running on Cursor local would mean handing a stranger a shell that
 * auto-approves, so the DB value is not trusted here.
 */
function resolveProvider(
  row: { ownerUserId: number | null; provider: string },
  preset: KindPreset,
  providerOptions: Record<string, unknown>,
): ProviderId {
  if (row.ownerUserId !== null) return "builtin";

  const declared = (row.provider || preset.defaultProvider) as ProviderId;
  if (declared === "cursor") {
    const rowKey = typeof providerOptions.cursorApiKey === "string" && providerOptions.cursorApiKey.trim();
    const envKey = Boolean(process.env.CURSOR_API_KEY?.trim());
    if (!rowKey && !envKey) return "builtin";
  }
  return declared;
}

export function toDefinition(row: typeof agents.$inferSelect): AgentDefinition {
  const kind = asKind(row.kind);
  const preset = KIND_PRESETS[kind];
  const providerOptions = parseJsonObject(row.providerOptions);
  const declaredTags = parseJsonArray(row.capabilityTags);
  const declaredTools = parseJsonArray(row.toolIds);

  return {
    id: row.id,
    kind,
    slug: row.slug,
    name: row.name,
    persona: row.persona,
    landmarkId: row.landmarkId,
    skills: [],
    toolIds: declaredTools.length ? declaredTools : preset.toolIds,
    provider: resolveProvider(row, preset, providerOptions),
    providerOptions,
    capabilityTags: declaredTags.length ? declaredTags : preset.capabilityTags,
    memorySlots: preset.memorySlots,
    selfCanon: preset.selfCanon,
    isTownNative: row.ownerUserId === null,
  };
}

export async function loadDefinition(agentId: number): Promise<AgentDefinition> {
  const row = await getDb().query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!row) throw new RuntimeError("agent_not_found", `agent ${agentId} does not exist`);
  return toDefinition(row);
}
