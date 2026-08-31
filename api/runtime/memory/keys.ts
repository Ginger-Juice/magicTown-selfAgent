import { LIMITS } from "../limits";
import type { MemoryLevel, MemorySubject, SubjectType } from "../types";

export const MEMORY_LEVELS: readonly MemoryLevel[] = ["L1", "L2", "L3"];
export const SUBJECT_TYPES: readonly SubjectType[] = ["user", "agent"];

/** One row per conversation, overwritten in place. */
export const SESSION_ROLLING_KEY = "session:rolling";

/** `<prefix>:<slug>` — the prefix is what policy.ts gates on. */
const KEY_PATTERN = /^[a-z][a-z0-9_]{1,23}:[a-z0-9][a-z0-9_.-]{0,48}$/;

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function keyPrefix(key: string): string {
  const colon = key.indexOf(":");
  return colon === -1 ? "" : key.slice(0, colon + 1);
}

export function subjectCacheKey(subject: MemorySubject): string {
  return `${subject.type}:${subject.id}`;
}

/**
 * MySQL unique indexes treat every NULL as distinct, so the identity of a row
 * has to be flattened into one string column before it can be uniquely indexed.
 */
export function memoKey(
  subject: MemorySubject,
  conversationId: number | null | undefined,
  key: string,
): string {
  return `${subject.type}:${subject.id}:${conversationId ?? 0}:${key}`;
}

export function topicList(topics: string): string[] {
  return topics
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Empty topics means "anyone in town may read this". Otherwise the reader needs
 * at least one overlapping capability tag — this is what keeps the bartender
 * away from medical facts in the shared user profile.
 */
export function topicsAllow(rowTopics: string, capabilityTags: string[]): boolean {
  const wanted = topicList(rowTopics);
  if (wanted.length === 0) return true;
  const have = new Set(capabilityTags.map((t) => t.toLowerCase()));
  return wanted.some((t) => have.has(t));
}

export function defaultExpiry(level: MemoryLevel, now = new Date()): Date | null {
  // L1 is permanent by definition; L3 dies with its conversation.
  if (level !== "L2") return null;
  return new Date(now.getTime() + LIMITS.memoryL2TtlDays * 24 * 60 * 60 * 1000);
}

/** Truncates on a byte budget, leaving a visible marker so nothing looks whole. */
export function clampValue(value: string, maxBytes = LIMITS.memoryMaxValueBytes): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;

  const marker = "…（已截断）";
  const markerBytes = encoder.encode(marker).length;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, mid)).length + markerBytes <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return value.slice(0, low) + marker;
}
