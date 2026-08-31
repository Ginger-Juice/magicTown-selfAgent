import { clampValue, defaultExpiry, isValidKey, memoKey } from "./keys";
import type {
  MemoryLevel,
  MemoryOrigin,
  MemorySlot,
  MemoryStatus,
  MemorySubject,
} from "../types";

export type WriteRequest = {
  subject: MemorySubject;
  level: MemoryLevel;
  key: string;
  value: string;
  origin: MemoryOrigin;
  conversationId?: number | null;
  topics?: string;
  pinned?: boolean;
  /** Ignored for agent-authored L1 — see below. */
  status?: MemoryStatus;
};

export type NormalizedWrite = {
  subjectType: MemorySubject["type"];
  subjectId: number;
  level: MemoryLevel;
  key: string;
  memoKey: string;
  value: string;
  topics: string;
  status: MemoryStatus;
  origin: MemoryOrigin;
  pinned: boolean;
  conversationId: number | null;
  expiresAt: Date | null;
};

export type WriteDecision =
  | { allowed: true; write: NormalizedWrite }
  | { allowed: false; reason: string };

export type PolicyContext = {
  /** L1 keys this agent may propose. Empty means it has no proposal rights. */
  slots: MemorySlot[];
};

function deny(reason: string): WriteDecision {
  return { allowed: false, reason };
}

/**
 * The single choke point for every write. Distillation and the A2A worker
 * bypass the tool layer entirely, so putting these rules anywhere else would
 * leave those paths ungoverned.
 */
export function decideWrite(req: WriteRequest, ctx: PolicyContext): WriteDecision {
  if (!isValidKey(req.key)) return deny("invalid_key");
  if (!req.value.trim()) return deny("empty_value");

  const isAgentSubject = req.subject.type === "agent";

  // An agent subject has no column able to name a visitor, and a session
  // belongs to a conversation which belongs to one user — so neither fits.
  const conversationId = isAgentSubject ? null : (req.conversationId ?? null);
  if (isAgentSubject && req.level === "L3") return deny("agent_subject_has_no_session");
  if (req.level === "L3" && conversationId === null) return deny("l3_requires_conversation");

  let status: MemoryStatus = req.status ?? "active";
  let topics = req.topics ?? "";
  let pinned = req.pinned ?? false;

  if (req.level === "L1") {
    if (req.origin === "system") return deny("system_cannot_write_canon");

    if (req.origin === "agent") {
      const slot = ctx.slots.find((s) => s.key === req.key);
      if (!ctx.slots.length) return deny("no_proposal_rights");
      if (!slot) return deny("key_not_in_slots");
      // Forced regardless of what the caller asked for: only a human promotes
      // something to canon.
      status = "proposed";
      topics = req.topics ?? slot.topics;
    }

    if (req.origin === "user") {
      status = req.status === "rejected" ? "rejected" : "active";
      pinned = req.pinned ?? true;
    }
  }

  if (req.level === "L2") {
    if (status === "proposed") return deny("insights_need_no_approval");
    status = status === "rejected" ? "rejected" : "active";
  }

  if (req.level === "L3" && req.origin !== "system") {
    return deny("l3_is_runtime_only");
  }

  return {
    allowed: true,
    write: {
      subjectType: req.subject.type,
      subjectId: req.subject.id,
      level: req.level,
      key: req.key,
      memoKey: memoKey(req.subject, conversationId, req.key),
      value: clampValue(req.value.trim()),
      topics,
      status,
      origin: req.origin,
      pinned,
      conversationId,
      expiresAt: defaultExpiry(req.level),
    },
  };
}

/** An agent may soft-delete its own insights but never a canon row. */
export function canForget(level: MemoryLevel, origin: MemoryOrigin): boolean {
  if (origin === "user") return true;
  return level === "L2" || level === "L3";
}
