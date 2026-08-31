import type { AgentDefinition, Skill } from "./types";

function matchSkills(skills: Skill[], userMessage: string): Skill[] {
  const haystack = userMessage.toLowerCase();
  return skills.filter((skill) => {
    if (skill.notFor?.some((n) => haystack.includes(n.toLowerCase()))) return false;
    return skill.useWhen.some((w) => haystack.includes(w.toLowerCase()));
  });
}

function identity(def: AgentDefinition): string {
  const where = def.landmarkId ? `你常驻在小镇的 ${def.landmarkId}。` : "你在小镇里没有固定驻点。";
  return [
    `你是「${def.name}」，魔法小镇的一位居民。${where}`,
    "不变约束：",
    "- 你只能说自己真正做过的事。没有调用工具，就不要声称已经办好、已经记下、已经问过别人。",
    "- 不知道就说不知道，不要编造小镇里不存在的人、店、规定。",
    "- 用访客说话的语言回应。",
    // The ethical floor for this trade. Sits in the identity block because it
    // outranks anything persona or memory can say.
    ...def.selfCanon.map((line) => `- ${line}`),
  ].join("\n");
}

function a2aRules(): string {
  return [
    "找别人帮忙的规矩：",
    "- 想请别的居民办事，只能调用 ask_agent / tell_agent / handoff 工具，正文里 @ 某人没有任何效果。",
    "- 工具调用成功之后才算寄出。在那之前不要对访客说「我已经问过了」。",
    "- 对方的回信会稍后送达，不要替对方编造答复。",
  ].join("\n");
}

export type PromptInput = {
  definition: AgentDefinition;
  userMessage: string;
  memoryBlocks: { self: string; user: string };
};

/**
 * Order is load-bearing: the first four sections are byte-stable across a
 * conversation and the volatile user memory is pushed last, so the provider's
 * prefix cache can actually hit.
 */
export function buildSystemPrompt(input: PromptInput): string {
  const { definition, userMessage, memoryBlocks } = input;
  const sections: string[] = [identity(definition)];

  if (definition.persona.trim()) sections.push(definition.persona.trim());
  if (memoryBlocks.self.trim()) sections.push(memoryBlocks.self.trim());

  const skills = matchSkills(definition.skills, userMessage);
  for (const skill of skills) sections.push(skill.body.trim());

  if (memoryBlocks.user.trim()) sections.push(memoryBlocks.user.trim());

  sections.push(a2aRules());

  if (definition.memorySlots.length) {
    const slots = definition.memorySlots.map((s) => `- ${s.key}：${s.desc}`).join("\n");
    sections.push(
      [
        "关于长期记忆：",
        "- 听到值得长期记住的重要事实时，用 propose_memory 提议，只能用下面这些槽位：",
        slots,
        "- 提议之后要等访客点头才算生效，不要当作已经记下。",
        "- 一般的经历总结用 remember_insight，不需要访客确认。",
      ].join("\n"),
    );
  } else {
    sections.push(
      "关于长期记忆：你没有提议长期事实的权限，只能用 remember_insight 记一般的经历总结。",
    );
  }

  return sections.join("\n\n");
}
