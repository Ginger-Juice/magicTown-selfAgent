import type { z } from "zod";
import type { Provider } from "./providers/types";

/**
 * Eight town-native kinds plus `custom` for visitor-registered agents.
 * Declared here rather than in api/agents.ts so the runtime stays importable
 * without pulling in the tRPC layer.
 */
export const AGENT_KINDS = [
  "fitness",
  "work",
  "diet",
  "code",
  "social",
  "mixology",
  "study",
  "divination",
  "custom",
] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export type ProviderId = "builtin" | "cursor" | "codex";

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export type SubjectType = "user" | "agent";
export type MemoryLevel = "L1" | "L2" | "L3";
export type MemoryStatus = "active" | "proposed" | "rejected";
export type MemoryOrigin = "user" | "agent" | "system";

export type MemorySubject = { type: SubjectType; id: number };

/**
 * An L1 slot the agent is allowed to *propose*. Fixed enumeration rather than a
 * glob so the model can't invent `profile:allergy` and `profile:allergies` as
 * two rows it will never reconcile.
 */
export type MemorySlot = {
  key: string;
  desc: string;
  /** Comma separated. Empty means every agent may read the resulting row. */
  topics: string;
};

export type MemoryView = {
  id: number;
  level: MemoryLevel;
  key: string;
  value: string;
  topics: string;
  status: MemoryStatus;
  origin: MemoryOrigin;
  pinned: boolean;
  hits: number;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export type Skill = {
  id: string;
  /** Matched case-insensitively against the turn's user message. */
  useWhen: string[];
  notFor?: string[];
  body: string;
};

export type AgentDefinition = {
  id: number;
  kind: AgentKind;
  slug: string;
  name: string;
  /** Free text from the agents table. Visitor-authored for custom agents. */
  persona: string;
  landmarkId: string | null;
  skills: Skill[];
  toolIds: string[];
  provider: ProviderId;
  providerOptions: Record<string, unknown>;
  /** A2A gate, and the read filter against user memory `topics`. */
  capabilityTags: string[];
  memorySlots: MemorySlot[];
  /** Seeded self-L1 rows for this kind, e.g. "no medical diagnosis". */
  selfCanon: string[];
  isTownNative: boolean;
};

// ---------------------------------------------------------------------------
// Messages and tools
// ---------------------------------------------------------------------------

export type ToolCall = { callId: string; name: string; args: unknown };

export type ModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; content: string };

/**
 * Tools return a result plus an optional patch for the next user turn. They
 * never write conversation prose themselves — that stays the model's job.
 */
export type StepOutcome = {
  data: unknown;
  nextPrompt?: string;
  shouldExit?: boolean;
};

export type ToolSpec = {
  id: string;
  description: string;
  parameters: z.ZodType;
  /**
   * Real actions are the only thing that counts as "the agent actually did
   * something" for void-ball accounting.
   */
  realAction?: boolean;
  execute(args: unknown, ctx: RunContext): Promise<StepOutcome>;
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export type SystemNoteKind =
  | "handoff"
  | "memory_proposal"
  | "void_ball"
  | "delegation_sent"
  | "notice"
  | "tool_trace";

/**
 * Side channel from the runtime back to the caller. The caller persists these
 * as `fromKind: 'system'` messages, which is how "a handoff must be visible"
 * ends up enforced by the data layer rather than by UI convention.
 */
export type SystemNote = {
  kind: SystemNoteKind;
  body: string;
  meta?: Record<string, unknown>;
};

export type TraceEntry = {
  step: number;
  tool: string;
  allowed: boolean;
  reason?: string;
  ms: number;
  callId?: string;
  args?: unknown;
  result?: unknown;
};

export type RunRequest = {
  agentId: number;
  userId: number;
  conversationId: number | null;
  userMessage: string;
  /** `vendor:model`. Overrides the kind's default provider when set. */
  model?: string | null;
  /** 0 for a visitor turn, 1 for an agent answering an envelope. */
  depth?: number;
  signal?: AbortSignal;
};

export type RunUser = {
  id: number;
  displayName: string;
  email: string;
};

export type RunContext = {
  definition: AgentDefinition;
  user: RunUser;
  conversationId: number | null;
  /** The visitor line that started this turn. */
  userMessage: string;
  depth: number;
  runId: number | null;
  provider: Provider;
  signal: AbortSignal;
  startedAt: number;
  /** Rendered by memory/digest.ts during beforeTurn. */
  memoryBlocks: { self: string; user: string };
  /** Rows that made it into the prompt, credited a hit in afterTurn. */
  memoryUsedIds?: number[];
  /** Prepended to the transcript; the rolling L3 summary. */
  sessionSummary: string;
  trace: TraceEntry[];
  notes: SystemNote[];
  toolCallCount: number;
  realActions: string[];
  envelopesCreated: number;
  /** Tests inject this so the loop can be traced without a database. */
  recordToolEvent?(event: {
    type: "tool/call" | "tool/result";
    callId: string;
    step: number;
    payload: Record<string, unknown>;
  }): Promise<void>;
};

export type RunResult = {
  finalText: string;
  /** `vendor:model` that actually answered, after any fallback. */
  modelId: string | null;
  steps: number;
  envelopesCreated: number;
  notes: SystemNote[];
  trace: TraceEntry[];
  usage: { inputTokens: number; outputTokens: number };
  runId: number | null;
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export type ToolVerdict = { allowed: boolean; reason?: string };

export type EnvelopeType = "ask" | "tell" | "handoff";

export type EnvelopeSummary = {
  id: number;
  type: EnvelopeType;
  fromAgentId: number;
  toAgentId: number;
  toAgentName: string;
  userId: number;
  conversationId: number | null;
  depth: number;
  prompt: string;
};

export type HookBus = {
  beforeTurn(ctx: RunContext): Promise<void>;
  beforeTool(ctx: RunContext, call: ToolCall): Promise<ToolVerdict>;
  afterTool(ctx: RunContext, call: ToolCall, outcome: StepOutcome): Promise<void>;
  afterTurn(ctx: RunContext, finalText: string): Promise<void>;
  onHandoff(ctx: RunContext, envelope: EnvelopeSummary): Promise<void>;
  onError(ctx: RunContext, err: unknown): Promise<void>;
};
