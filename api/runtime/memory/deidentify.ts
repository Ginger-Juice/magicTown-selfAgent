export type DeidentifyContext = {
  displayName: string;
  email: string;
  userId: number;
  /** Raw conversation text, mined for names the visitor introduced themselves by. */
  transcript?: string;
};

export type DeidentifyResult = { ok: true } | { ok: false; reason: string };

const SELF_INTRO_PATTERNS = [
  /我叫([^\s，。,.!?！？、"'']{1,6})/g,
  /叫我([^\s，。,.!?！？、"'']{1,6})/g,
  /我是([^\s，。,.!?！？、"'']{1,6})/g,
  /(?:my name is|i'm|i am|call me)\s+([A-Za-z][A-Za-z'-]{1,20})/gi,
];

/** `叫我阿满就好` hands back `阿满就好` unless the politeness is trimmed off. */
const TRAILING_PARTICLES = /(就好了?|就行了?|即可|好了|吧|呀|啦|哦|喔|嘛|哈|了)$/;

const DATE_PATTERNS = [
  /\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?/,
  /\d{4}\s*[-/年]\s*\d{1,2}\s*月?(?![\d])/,
  /\d{1,2}\s*月\s*\d{1,2}\s*日/,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
];

function hasLatin(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

/**
 * CJK has no word boundaries, so latin needles get `\b` and everything else
 * falls back to substring matching.
 */
function mentions(haystack: string, needle: string): boolean {
  const trimmed = needle.trim();
  if (trimmed.length < 2) return false;
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = trimmed.toLowerCase();

  if (!hasLatin(trimmed)) return lowerHay.includes(lowerNeedle);

  const escaped = lowerNeedle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(lowerHay);
}

export function selfIntroducedNames(transcript: string): string[] {
  const found = new Set<string>();
  for (const pattern of SELF_INTRO_PATTERNS) {
    // Patterns are module-level and global, so the lastIndex must be reset.
    pattern.lastIndex = 0;
    let match = pattern.exec(transcript);
    while (match) {
      const name = match[1]?.trim().replace(TRAILING_PARTICLES, "");
      if (name && name.length >= 2) found.add(name);
      match = pattern.exec(transcript);
    }
  }
  return [...found];
}

/**
 * The mechanical gate on agent-subject writes. Anything that could tie a piece
 * of craft knowledge back to one visitor is rejected outright — a dropped
 * insight costs nothing, a leaked fact is an incident.
 */
export function check(value: string, ctx: DeidentifyContext): DeidentifyResult {
  const text = value.trim();
  if (!text) return { ok: false, reason: "empty" };

  if (mentions(text, ctx.displayName)) {
    return { ok: false, reason: "contains_display_name" };
  }

  const localPart = ctx.email.split("@")[0] ?? "";
  if (localPart.length >= 3 && mentions(text, localPart)) {
    return { ok: false, reason: "contains_email_local_part" };
  }
  if (ctx.email && mentions(text, ctx.email)) {
    return { ok: false, reason: "contains_email" };
  }

  // Deliberately blunt: a bare visitor id is rare enough in general advice that
  // dropping the occasional false positive beats reasoning about context.
  if (new RegExp(`(^|[^0-9])${ctx.userId}([^0-9]|$)`).test(text)) {
    return { ok: false, reason: "contains_user_id" };
  }

  for (const name of selfIntroducedNames(ctx.transcript ?? "")) {
    if (mentions(text, name)) return { ok: false, reason: "contains_self_introduced_name" };
  }

  for (const pattern of DATE_PATTERNS) {
    if (pattern.test(text)) return { ok: false, reason: "contains_concrete_date" };
  }

  return { ok: true };
}
