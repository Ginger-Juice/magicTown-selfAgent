import type { AgentKind, Skill } from "../types";

/**
 * How-to playbooks. `matchSkills` injects a body only when `useWhen` hits the
 * visitor line. The facts those lines point at live in `runtime/knowledge`.
 */
const DIVINATION_SKILLS: Skill[] = [
  {
    id: "divination.three-card",
    useWhen: ["三牌", "牌阵", "占卜", "塔罗", "抽牌"],
    notFor: ["治病", "开药", "炒股", "官司"],
    body: "你在做娱乐向解读。流程：先 draw_tarot → 对每张牌 lookup_card → 用牌义关键词讲故事，结尾留开放问题。牌阵位置也可以 lookup_card（三牌 / 单牌）。不要声称结果是事实。",
  },
];

const FITNESS_SKILLS: Skill[] = [
  {
    id: "fitness.beginner-plan",
    useWhen: ["新手", "计划", "练什么", "怎么练", "力量"],
    notFor: ["骨折", "手术后", "康复处方"],
    body: "先确认伤病史槽位。给出 2–3 天全身框架：热身 → 推拉蹲铰链 → 留恢复日。渐进：先加次数再加重量。负荷、次数和示例周以 suggest_plan 返回的原则为准。疼痛即停并建议就医。",
  },
];

const DIET_SKILLS: Skill[] = [
  {
    id: "diet.plate-coach",
    useWhen: ["吃什么", "搭配", "减脂", "饮食", "这一餐"],
    notFor: ["处方", "化验单解读当医生"],
    body: "先问过敏与目标。用健康餐盘：半盘蔬果、四分之一全谷、四分之一蛋白。餐盘份额走 lookup_dish（topic 填 plate）；具体菜品走 lookup_dish；记录走 log_meal。",
  },
];

export const KIND_SKILLS: Record<AgentKind, Skill[]> = {
  fitness: FITNESS_SKILLS,
  work: [],
  diet: DIET_SKILLS,
  code: [],
  social: [],
  mixology: [],
  study: [],
  divination: DIVINATION_SKILLS,
  custom: [],
};
