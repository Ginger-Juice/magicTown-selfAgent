import { NOOP_HOOKS } from "../hooks/bus";
import type { Provider, ProviderChunk } from "../providers/types";
import type { AgentDefinition, HookBus, RunContext, ToolVerdict } from "../types";

/**
 * Replays a script of chunk batches, one batch per provider call. The last
 * batch repeats forever, which is how the max-steps test keeps the loop fed.
 */
export function scriptedProvider(script: ProviderChunk[][]): Provider {
  let call = 0;
  return {
    id: "scripted",
    async *run(): AsyncIterable<ProviderChunk> {
      const batch = script[Math.min(call, script.length - 1)] ?? [];
      call += 1;
      for (const chunk of batch) yield chunk;
    },
  };
}

export function text(delta: string): ProviderChunk {
  return { type: "text", delta };
}

export function toolCall(name: string, args: unknown = {}, callId = `c_${name}`): ProviderChunk {
  return { type: "tool_call", callId, name, args };
}

export function makeDefinition(patch: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 1,
    kind: "diet",
    slug: "diet",
    name: "营养巫师",
    persona: "坩埚底茶座的营养巫师。",
    landmarkId: "coffee",
    skills: [],
    toolIds: [],
    provider: "builtin",
    providerOptions: {},
    capabilityTags: ["diet", "health"],
    memorySlots: [],
    selfCanon: [],
    isTownNative: true,
    ...patch,
  };
}

export function makeContext(provider: Provider, patch: Partial<RunContext> = {}): RunContext {
  return {
    definition: makeDefinition(),
    user: { id: 7, displayName: "Ada", email: "ada@example.com" },
    conversationId: 1,
    userMessage: "",
    depth: 0,
    runId: null,
    provider,
    signal: new AbortController().signal,
    startedAt: Date.now(),
    memoryBlocks: { self: "", user: "" },
    sessionSummary: "",
    trace: [],
    notes: [],
    toolCallCount: 0,
    realActions: [],
    envelopesCreated: 0,
    ...patch,
  };
}

export const passthroughHooks: HookBus = NOOP_HOOKS;

export function denyingHooks(deny: (name: string) => ToolVerdict | null): HookBus {
  return {
    ...NOOP_HOOKS,
    async beforeTool(_ctx, call) {
      return deny(call.name) ?? { allowed: true };
    },
  };
}
