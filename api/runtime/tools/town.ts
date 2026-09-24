import { z } from "zod";
import { defineTool } from "./registry";
import { asList, fail, ok, recall, recordKey, remember } from "./lib";
import { formatReadingArchive, uniqueReadingKey } from "../divination";
import {
  coachingPack,
  findMajorCard,
  findSpread,
  isPlateQuery,
  majorArcanaPack,
  platePack,
} from "../knowledge";
import {
  DISHES,
  RECIPES,
  TAROT_RANKS,
  TAROT_SUITS,
  findDish,
  findRecipe,
  normalize,
} from "./data";
import * as store from "../memory/store";
import type { ToolSpec } from "../types";

// ---------------------------------------------------------------------------
// 镇政厅 · work
// ---------------------------------------------------------------------------

const addTask = defineTool({
  id: "add_task",
  description: "把一件待办记到访客的任务板上。同名任务会覆盖旧的那条。",
  realAction: true,
  parameters: z.object({
    title: z.string().min(1).max(80).describe("任务标题，短句"),
    due: z.string().max(40).optional().describe("期限，原样记录，如「周五前」"),
    detail: z.string().max(400).optional(),
  }),
  async execute(args, ctx) {
    const value = [args.title, args.due && `期限：${args.due}`, args.detail]
      .filter(Boolean)
      .join("｜");
    return remember(ctx, { key: recordKey("task", args.title), value, topics: "work" });
  },
});

const listTasks = defineTool({
  id: "list_tasks",
  description: "列出访客任务板上还在的待办。",
  parameters: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  async execute(args, ctx) {
    const rows = await recall(ctx, "task");
    return ok({ count: rows.length, tasks: asList(rows, args.limit ?? 20) });
  },
});

// ---------------------------------------------------------------------------
// 坩埚底茶座 · diet
// ---------------------------------------------------------------------------

const logMeal = defineTool({
  id: "log_meal",
  description: "记录访客吃了什么。一天一餐次一条，重复记录会覆盖。",
  realAction: true,
  parameters: z.object({
    dish: z.string().min(1).max(80),
    slot: z.enum(["早餐", "午餐", "晚餐", "加餐"]).optional(),
    portion: z.string().max(40).optional().describe("份量，如「一碗」"),
  }),
  async execute(args, ctx) {
    const slot = args.slot ?? "加餐";
    const known = findDish(args.dish);
    const value = [
      `${slot}：${args.dish}`,
      args.portion,
      known && `约 ${known.kcal} kcal/100g`,
    ]
      .filter(Boolean)
      .join("｜");

    const outcome = await remember(ctx, {
      key: recordKey("meal", `${slot}-${args.dish}`),
      value,
      topics: "diet,health",
    });
    if (outcome.data && typeof outcome.data === "object" && "error" in outcome.data) return outcome;
    return ok({ recorded: true, dish: args.dish, slot, known: Boolean(known) });
  },
});

const lookupDish = defineTool({
  id: "lookup_dish",
  description:
    "查一道菜的粗略营养值，或健康餐盘原则（topic 填 plate）。只认镇上那本小册子，查不到就说查不到。",
  parameters: z.object({
    dish: z.string().min(1).max(80).optional().describe("菜名。查营养时填写"),
    topic: z.enum(["plate"]).optional().describe("填 plate 时返回健康餐盘原则，可以不传菜名"),
  }),
  async execute(args) {
    const plateQuery = args.dish ? isPlateQuery(args.dish) : false;
    const wantPlate = args.topic === "plate" || plateQuery;
    const dishQuery = args.dish && !plateQuery ? args.dish : undefined;
    if (!dishQuery && !wantPlate) {
      return fail("invalid_arguments", { detail: ["dish or topic=plate is required"] });
    }

    const knowledge = wantPlate ? platePack : undefined;
    if (!dishQuery) return ok({ topic: "plate", knowledge });

    const hit = findDish(dishQuery);
    if (!hit) {
      if (knowledge) {
        return ok({ topic: "plate", dish: { error: "not_found", query: dishQuery }, knowledge });
      }
      return fail("not_found", {
        query: dishQuery,
        known: DISHES.map((d) => d.name),
      });
    }
    return ok({
      name: hit.name,
      per100g: { kcal: hit.kcal, protein: hit.protein, carbs: hit.carbs, fat: hit.fat },
      note: hit.note ?? null,
      ...(knowledge ? { knowledge } : {}),
    });
  },
});

// ---------------------------------------------------------------------------
// 雾港旅店 · fitness
// ---------------------------------------------------------------------------

const logWorkout = defineTool({
  id: "log_workout",
  description: "记录一次训练。",
  realAction: true,
  parameters: z.object({
    activity: z.string().min(1).max(60),
    minutes: z.number().int().min(1).max(600).optional(),
    intensity: z.enum(["轻", "中", "大"]).optional(),
    note: z.string().max(200).optional(),
  }),
  async execute(args, ctx) {
    const value = [
      args.activity,
      args.minutes && `${args.minutes} 分钟`,
      args.intensity && `强度${args.intensity}`,
      args.note,
    ]
      .filter(Boolean)
      .join("｜");
    return remember(ctx, {
      key: recordKey("workout", args.activity),
      value,
      topics: "fitness,health",
    });
  },
});

const suggestPlan = defineTool({
  id: "suggest_plan",
  description: "根据访客最近记录的训练，给出下一周的分配，并附上新手力量原则。不下医疗判断。",
  parameters: z.object({
    goal: z.string().max(80).optional(),
    daysPerWeek: z.number().int().min(1).max(7).optional(),
  }),
  async execute(args, ctx) {
    const history = await recall(ctx, "workout");
    const days = args.daysPerWeek ?? 3;
    // The split is deterministic on purpose: the model writes the encouragement,
    // the tool only decides how many of each kind of day there should be.
    const strength = Math.max(1, Math.round(days * 0.4));
    const cardio = Math.max(1, Math.round(days * 0.4));
    const mobility = Math.max(0, days - strength - cardio);

    return ok({
      goal: args.goal ?? null,
      daysPerWeek: days,
      split: { strength, cardio, mobility },
      recentActivities: asList(history, 5).map((r) => r.value),
      caution: "有疼痛或旧伤先就医，这里不开康复处方。",
      knowledge: coachingPack,
    });
  },
});

// ---------------------------------------------------------------------------
// 符文工坊 · code
// ---------------------------------------------------------------------------

const saveSnippet = defineTool({
  id: "save_snippet",
  description: "把一段咒语稿（代码片段）收进访客的抽屉，标题相同会覆盖。",
  realAction: true,
  parameters: z.object({
    title: z.string().min(1).max(60),
    language: z.string().max(24).optional(),
    code: z.string().min(1).max(4000),
  }),
  async execute(args, ctx) {
    const value = `${args.language ?? "text"}\n${args.code}`;
    return remember(ctx, { key: recordKey("snippet", args.title), value, topics: "code" });
  },
});

// ---------------------------------------------------------------------------
// 夜枭酒馆 · social
// ---------------------------------------------------------------------------

const postBulletin = defineTool({
  id: "post_bulletin",
  description: "在访客的告示板上贴一张条子，记一件将要发生的事。",
  realAction: true,
  parameters: z.object({
    title: z.string().min(1).max(80),
    when: z.string().max(60).optional().describe("时间，原样记录"),
    detail: z.string().max(300).optional(),
  }),
  async execute(args, ctx) {
    const value = [args.title, args.when && `时间：${args.when}`, args.detail]
      .filter(Boolean)
      .join("｜");
    return remember(ctx, { key: recordKey("bulletin", args.title), value, topics: "events" });
  },
});

const listEvents = defineTool({
  id: "list_events",
  description: "念一遍访客告示板上还挂着的条子。",
  parameters: z.object({ limit: z.number().int().min(1).max(30).optional() }),
  async execute(args, ctx) {
    const rows = await recall(ctx, "bulletin");
    return ok({ count: rows.length, events: asList(rows, args.limit ?? 10) });
  },
});

// ---------------------------------------------------------------------------
// 夜枭酒馆 · mixology
// ---------------------------------------------------------------------------

const recommendDrink = defineTool({
  id: "recommend_drink",
  description: "按口味和是否含酒精挑一杯。访客说不喝酒时必须传 alcoholic=false。",
  parameters: z.object({
    alcoholic: z.boolean().describe("false 只返回无酒精配方"),
    profile: z.string().max(40).optional().describe("口味，如「清爽」「苦」「甜」"),
    avoid: z.array(z.string().max(20)).max(10).optional().describe("要避开的过敏原或配料"),
  }),
  async execute(args) {
    const avoid = (args.avoid ?? []).map(normalize);
    const wanted = args.profile ? normalize(args.profile) : null;

    const pool = RECIPES.filter((r) => r.alcoholic === args.alcoholic)
      .filter((r) => !r.allergens.some((a) => avoid.includes(normalize(a))))
      .filter((r) => !r.ingredients.some((i) => avoid.some((a) => normalize(i).includes(a))));

    const matched = wanted ? pool.filter((r) => r.profile.some((p) => normalize(p).includes(wanted))) : pool;
    const picks = (matched.length ? matched : pool).slice(0, 3);

    if (!picks.length) return fail("nothing_fits", { alcoholic: args.alcoholic, avoid });

    return ok({
      picks: picks.map((r) => ({ name: r.name, abv: r.abv, profile: r.profile, allergens: r.allergens })),
      relaxedProfile: wanted !== null && matched.length === 0,
    });
  },
});

const lookupRecipe = defineTool({
  id: "lookup_recipe",
  description: "查一杯酒的配方与做法。只认吧台那本册子。",
  parameters: z.object({ name: z.string().min(1).max(60) }),
  async execute(args) {
    const hit = findRecipe(args.name);
    if (!hit) return fail("not_found", { query: args.name, known: RECIPES.map((r) => r.name) });
    return ok({
      name: hit.name,
      alcoholic: hit.alcoholic,
      abv: hit.abv,
      ingredients: hit.ingredients,
      method: hit.method,
      allergens: hit.allergens,
    });
  },
});

const logTaste = defineTool({
  id: "log_taste",
  description: "记下访客对某杯酒的评价，下次好照着调。",
  realAction: true,
  parameters: z.object({
    drink: z.string().min(1).max(60),
    verdict: z.enum(["喜欢", "一般", "不喜欢"]),
    note: z.string().max(200).optional(),
  }),
  async execute(args, ctx) {
    const value = [`${args.drink}：${args.verdict}`, args.note].filter(Boolean).join("｜");
    return remember(ctx, { key: recordKey("taste", args.drink), value, topics: "drinks" });
  },
});

// ---------------------------------------------------------------------------
// 禁书塔 · study
// ---------------------------------------------------------------------------

const searchLibrary = defineTool({
  id: "search_library",
  description:
    "在访客自己存下的笔记、计划与进度里检索。这里没有外部书目，查不到就直说，不要编出处。",
  parameters: z.object({
    query: z.string().min(1).max(80),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  async execute(args, ctx) {
    const rows = await store.listLive({ type: "user", id: ctx.user.id }, ["L1", "L2"], {
      conversationId: null,
    });
    const q = normalize(args.query);
    const hits = rows
      .filter((r) => normalize(r.value).includes(q) || normalize(r.key).includes(q))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    if (!hits.length) return ok({ count: 0, hits: [], note: "馆内没有相关记录。" });
    return ok({ count: hits.length, hits: asList(hits, args.limit ?? 8) });
  },
});

const makeReadingPlan = defineTool({
  id: "make_reading_plan",
  description: "把一个学习目标拆成按周的阅读计划并存下来。",
  realAction: true,
  parameters: z.object({
    topic: z.string().min(1).max(80),
    weeks: z.number().int().min(1).max(26),
    hoursPerWeek: z.number().int().min(1).max(40).optional(),
  }),
  async execute(args, ctx) {
    const hours = args.hoursPerWeek ?? 4;
    const phases = [
      { name: "打底", share: 0.3 },
      { name: "精读", share: 0.45 },
      { name: "输出", share: 0.25 },
    ];
    let assigned = 0;
    const schedule = phases.map((p, i) => {
      const weeks = i === phases.length - 1 ? args.weeks - assigned : Math.max(1, Math.round(args.weeks * p.share));
      assigned += weeks;
      return { phase: p.name, weeks: Math.max(0, weeks) };
    });

    const value = `${args.topic}｜${args.weeks} 周 × ${hours}h｜${schedule
      .map((s) => `${s.phase}${s.weeks}周`)
      .join(" ")}`;
    const outcome = await remember(ctx, {
      key: recordKey("plan", args.topic),
      value,
      topics: "study,research",
    });
    if (outcome.data && typeof outcome.data === "object" && "error" in outcome.data) return outcome;
    return ok({ topic: args.topic, hoursPerWeek: hours, schedule });
  },
});

const logProgress = defineTool({
  id: "log_progress",
  description: "记一次学习进度。",
  realAction: true,
  parameters: z.object({
    topic: z.string().min(1).max(80),
    done: z.string().min(1).max(200),
    minutes: z.number().int().min(1).max(600).optional(),
  }),
  async execute(args, ctx) {
    const value = [args.done, args.minutes && `${args.minutes} 分钟`].filter(Boolean).join("｜");
    return remember(ctx, {
      key: recordKey("progress", `${args.topic}-${args.done}`),
      value,
      topics: "study,research",
    });
  },
});

// ---------------------------------------------------------------------------
// 斜塔巫师楼 · divination
// ---------------------------------------------------------------------------

function fullDeck() {
  const major = majorArcanaPack.cards.map((c) => ({ name: c.name, arcana: "大阿卡纳" as const }));
  const minor = TAROT_SUITS.flatMap((s) =>
    TAROT_RANKS.map((r) => ({ name: `${s.suit}${r}`, arcana: "小阿卡纳" as const })),
  );
  return [...major, ...minor];
}

const drawTarot = defineTool({
  id: "draw_tarot",
  description: "洗牌并抽牌。牌面由这里决定，解读由你来写——不要自己编牌。",
  parameters: z.object({
    count: z.number().int().min(1).max(5),
    spread: z.enum(["单张", "三张", "凯尔特十字简版"]).optional(),
    question: z.string().max(120).optional(),
  }),
  async execute(args) {
    const deck = fullDeck();
    const drawn: { name: string; arcana: string; reversed: boolean }[] = [];
    for (let i = 0; i < args.count; i++) {
      const index = Math.floor(Math.random() * deck.length);
      const [card] = deck.splice(index, 1);
      drawn.push({ ...card, reversed: Math.random() < 0.5 });
    }
    return ok({
      spread: args.spread ?? (args.count === 1 ? "单张" : "三张"),
      question: args.question ?? null,
      cards: drawn,
      reminder: "占卜是消遣，不是判决。",
    });
  },
});

const lookupCard = defineTool({
  id: "lookup_card",
  description:
    "查一张大阿卡纳的关键词，或一个牌阵的位置。词条来自镇上的大阿卡纳小册子。小阿卡纳只返回花色主题。",
  parameters: z.object({ name: z.string().min(1).max(30) }),
  async execute(args) {
    const q = normalize(args.name);
    const major = findMajorCard(args.name);
    if (major) {
      return ok({
        arcana: "大阿卡纳",
        id: major.id,
        name: major.name,
        upright: [...major.upright],
        reversed: [...major.reversed],
      });
    }
    const spread = findSpread(args.name);
    if (spread) {
      return ok({
        spread: spread.name,
        id: spread.id,
        positions: [...spread.positions],
        voiceRules: [...majorArcanaPack.voice_rules],
      });
    }
    const suit = TAROT_SUITS.find((s) => q.includes(normalize(s.suit)));
    if (suit) return ok({ arcana: "小阿卡纳", suit: suit.suit, theme: suit.theme });
    return fail("not_found", { query: args.name });
  },
});

const logReading = defineTool({
  id: "log_reading",
  description:
    "把这一次占卜完整归档：牌面、你的解读、访客的反馈。每次一档，不要把占卜写成事实。访客还没反馈时也可以先记，反馈补在下一次。",
  realAction: true,
  parameters: z.object({
    question: z.string().max(120).optional(),
    cards: z.array(z.string().max(40)).min(1).max(5),
    spread: z.string().max(24).optional(),
    interpretation: z.string().min(1).max(600),
    feedback: z.string().max(400).optional(),
  }),
  async execute(args, ctx) {
    const cards = args.cards.map((raw) => {
      const reversed = /逆/.test(raw);
      const name = raw.replace(/[（(]?(正|逆)[）)]?/g, "").trim() || raw.trim();
      return { name, reversed };
    });
    const value = formatReadingArchive({
      question: args.question?.trim() || null,
      cards,
      spread: args.spread ?? null,
      interpretation: args.interpretation,
      feedback: args.feedback?.trim() || null,
    });
    return remember(ctx, {
      key: uniqueReadingKey(`${args.cards.join(",")}:${args.question ?? ""}:${Date.now()}`),
      value,
      topics: "divination",
    });
  },
});

const listReadings = defineTool({
  id: "list_readings",
  description: "查阅这位访客过往的占卜档案（牌面、解读、反馈）。开新牌之前先看一眼。",
  parameters: z.object({}),
  async execute(_args, ctx) {
    const rows = await recall(ctx, "reading:");
    return ok({ readings: asList(rows, 12), count: rows.length });
  },
});

export const TOWN_TOOLS: ToolSpec[] = [
  addTask,
  listTasks,
  logMeal,
  lookupDish,
  logWorkout,
  suggestPlan,
  saveSnippet,
  postBulletin,
  listEvents,
  recommendDrink,
  lookupRecipe,
  logTaste,
  searchLibrary,
  makeReadingPlan,
  logProgress,
  drawTarot,
  lookupCard,
  logReading,
  listReadings,
];
