/**
 * Small hand-kept reference tables. They exist so `lookup_*` tools answer from
 * something checkable instead of from the model's imagination; a miss returns
 * `not_found` rather than a guess.
 */

export type Dish = {
  name: string;
  aliases: string[];
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  note?: string;
};

export const DISHES: Dish[] = [
  { name: "白米饭", aliases: ["米饭", "rice"], kcal: 116, protein: 2.6, carbs: 25.9, fat: 0.3, note: "每 100 克熟重" },
  { name: "全麦面包", aliases: ["whole wheat bread"], kcal: 246, protein: 9.6, carbs: 44, fat: 3.6 },
  { name: "鸡胸肉", aliases: ["chicken breast"], kcal: 133, protein: 24.6, carbs: 0, fat: 3.6, note: "去皮，每 100 克" },
  { name: "鸡蛋", aliases: ["egg"], kcal: 144, protein: 13.3, carbs: 2.8, fat: 8.8, note: "一个约 50 克" },
  { name: "三文鱼", aliases: ["salmon"], kcal: 208, protein: 20, carbs: 0, fat: 13 },
  { name: "豆腐", aliases: ["tofu"], kcal: 82, protein: 8.1, carbs: 4.2, fat: 3.7 },
  { name: "牛奶", aliases: ["milk"], kcal: 54, protein: 3, carbs: 3.4, fat: 3.2, note: "全脂，每 100 毫升" },
  { name: "拿铁", aliases: ["latte"], kcal: 75, protein: 4, carbs: 7, fat: 3.5, note: "中杯全脂，未加糖浆" },
  { name: "西兰花", aliases: ["broccoli"], kcal: 34, protein: 2.8, carbs: 7, fat: 0.4 },
  { name: "牛肉面", aliases: ["beef noodles"], kcal: 480, protein: 24, carbs: 62, fat: 14, note: "一碗约 550 克，含汤" },
  { name: "香蕉", aliases: ["banana"], kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
  { name: "燕麦", aliases: ["oats", "oatmeal"], kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9, note: "干重" },
];

export type Recipe = {
  name: string;
  aliases: string[];
  alcoholic: boolean;
  /** Rough finished-drink strength; 0 for a mocktail. */
  abv: number;
  profile: string[];
  ingredients: string[];
  method: string;
  allergens: string[];
};

export const RECIPES: Recipe[] = [
  {
    name: "金汤力",
    aliases: ["gin tonic", "gin and tonic"],
    alcoholic: true,
    abv: 10,
    profile: ["清爽", "苦"],
    ingredients: ["金酒 50ml", "汤力水 150ml", "青柠角 1 块"],
    method: "高球杯加满冰，先倒金酒再沿杯壁注入汤力水，青柠挤汁后投入。",
    allergens: [],
  },
  {
    name: "威士忌酸",
    aliases: ["whiskey sour"],
    alcoholic: true,
    abv: 20,
    profile: ["酸", "浓郁"],
    ingredients: ["波本 50ml", "柠檬汁 25ml", "糖浆 15ml", "蛋白 15ml（可省）"],
    method: "无冰摇匀起泡，加冰再摇，双重过滤入杯。",
    allergens: ["蛋"],
  },
  {
    name: "尼格罗尼",
    aliases: ["negroni"],
    alcoholic: true,
    abv: 24,
    profile: ["苦", "浓郁"],
    ingredients: ["金酒 30ml", "金巴利 30ml", "甜味美思 30ml"],
    method: "古典杯加大冰块，直调搅匀，橙皮喷油。",
    allergens: [],
  },
  {
    name: "莫吉托",
    aliases: ["mojito"],
    alcoholic: true,
    abv: 12,
    profile: ["清爽", "甜", "香草"],
    ingredients: ["白朗姆 50ml", "青柠汁 25ml", "糖浆 15ml", "薄荷叶 10 片", "苏打水补满"],
    method: "薄荷与糖浆轻压出香，加朗姆与青柠，填碎冰搅匀，补苏打水。",
    allergens: [],
  },
  {
    name: "无酒精莫吉托",
    aliases: ["virgin mojito", "nojito"],
    alcoholic: false,
    abv: 0,
    profile: ["清爽", "甜", "香草"],
    ingredients: ["青柠汁 25ml", "糖浆 15ml", "薄荷叶 10 片", "苏打水补满"],
    method: "同莫吉托，去掉朗姆，苏打水多补 50ml。",
    allergens: [],
  },
  {
    name: "接骨木气泡",
    aliases: ["elderflower fizz"],
    alcoholic: false,
    abv: 0,
    profile: ["花香", "清爽"],
    ingredients: ["接骨木花糖浆 20ml", "柠檬汁 15ml", "苏打水 150ml"],
    method: "高球杯加冰，直调，柠檬片装饰。",
    allergens: [],
  },
  {
    name: "咸狗",
    aliases: ["salty dog"],
    alcoholic: true,
    abv: 12,
    profile: ["酸", "咸"],
    ingredients: ["伏特加 45ml", "西柚汁 120ml", "杯口盐边"],
    method: "杯口抹盐，加冰直调。",
    allergens: [],
  },
  {
    name: "杏仁酸",
    aliases: ["amaretto sour"],
    alcoholic: true,
    abv: 15,
    profile: ["甜", "酸", "坚果"],
    ingredients: ["杏仁利口酒 45ml", "柠檬汁 25ml", "糖浆 10ml"],
    method: "摇匀，滤入古典杯，柠檬皮装饰。",
    allergens: ["坚果"],
  },
];

export const TAROT_MAJOR = [
  { n: 0, name: "愚者", upright: "起步、天真、放手一搏", reversed: "鲁莽、逃避、准备不足" },
  { n: 1, name: "魔术师", upright: "资源到位、主动、创造", reversed: "空谈、操弄、力气用错地方" },
  { n: 2, name: "女祭司", upright: "直觉、静观、尚未揭晓", reversed: "忽视内心、秘密外泄" },
  { n: 3, name: "皇后", upright: "滋养、丰盛、感官", reversed: "过度依赖、停滞" },
  { n: 4, name: "皇帝", upright: "秩序、边界、掌控", reversed: "僵硬、专断" },
  { n: 5, name: "教皇", upright: "传统、指导、体系", reversed: "教条、反叛" },
  { n: 6, name: "恋人", upright: "选择、结合、价值排序", reversed: "犹疑、失衡" },
  { n: 7, name: "战车", upright: "推进、意志、方向感", reversed: "失控、方向不明" },
  { n: 8, name: "力量", upright: "温柔的坚持、驯服", reversed: "自我怀疑、耗竭" },
  { n: 9, name: "隐士", upright: "独处、寻找答案、内省", reversed: "孤立、拒绝求助" },
  { n: 10, name: "命运之轮", upright: "转机、周期、时机", reversed: "阻滞、重复旧局" },
  { n: 11, name: "正义", upright: "权衡、因果、公正", reversed: "偏颇、逃避责任" },
  { n: 12, name: "倒吊人", upright: "换个角度、暂停、交付", reversed: "无谓牺牲、拖延" },
  { n: 13, name: "死神", upright: "结束与转化、清理", reversed: "抗拒改变、悬而未决" },
  { n: 14, name: "节制", upright: "调和、耐心、比例", reversed: "过度、失衡" },
  { n: 15, name: "恶魔", upright: "执着、诱惑、被绑住", reversed: "松绑、看清依赖" },
  { n: 16, name: "高塔", upright: "突变、旧结构崩塌", reversed: "延后的崩塌、勉强维持" },
  { n: 17, name: "星星", upright: "希望、疗愈、指引", reversed: "失望、信心动摇" },
  { n: 18, name: "月亮", upright: "迷雾、不安、潜意识", reversed: "拨云见月、误会澄清" },
  { n: 19, name: "太阳", upright: "明朗、活力、被看见", reversed: "短暂的阴天、过度乐观" },
  { n: 20, name: "审判", upright: "召唤、清算、重新出发", reversed: "自责、听不见召唤" },
  { n: 21, name: "世界", upright: "完成、整合、圆满", reversed: "差一步、收尾乏力" },
] as const;

export const TAROT_SUITS = [
  { suit: "权杖", theme: "行动与热情" },
  { suit: "圣杯", theme: "情感与关系" },
  { suit: "宝剑", theme: "思考与冲突" },
  { suit: "星币", theme: "现实与资源" },
] as const;

export const TAROT_RANKS = [
  "王牌", "二", "三", "四", "五", "六", "七", "八", "九", "十", "侍从", "骑士", "王后", "国王",
] as const;

export function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export function findDish(query: string): Dish | undefined {
  const q = normalize(query);
  return (
    DISHES.find((d) => normalize(d.name) === q || d.aliases.some((a) => normalize(a) === q)) ??
    DISHES.find((d) => normalize(d.name).includes(q) || d.aliases.some((a) => normalize(a).includes(q)))
  );
}

export function findRecipe(query: string): Recipe | undefined {
  const q = normalize(query);
  return (
    RECIPES.find((r) => normalize(r.name) === q || r.aliases.some((a) => normalize(a) === q)) ??
    RECIPES.find((r) => normalize(r.name).includes(q) || r.aliases.some((a) => normalize(a).includes(q)))
  );
}
