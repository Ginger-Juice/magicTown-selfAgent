import { mkdir } from "node:fs/promises";
import path from "node:path";
import { raceAbort, throwIfAborted } from "../abort";
import { LIMITS } from "../limits";
import { formatTraceNote } from "../trajectory";
import type { AgentDefinition, RunContext } from "../types";
import type { Provider, ProviderChunk, ProviderRunInput } from "./types";
import {
  cursorStoreRoot,
  loadCursorAgentId,
  parseMcpServers,
  prepareCursorWorkspace,
  readCursorApiKey,
  saveCursorAgentId,
  townBridgeTools,
} from "./cursor-kit";

const DEFAULT_MODEL = "composer-2.5";

type SdkModule = typeof import("@cursor/sdk");

async function loadSdk(): Promise<SdkModule> {
  return import("@cursor/sdk");
}

function latestUserText(ctx: RunContext, input: ProviderRunInput): string {
  if (ctx.userMessage.trim()) return ctx.userMessage;
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i];
    if (message.role === "user" && message.content.trim()) return message.content;
  }
  return input.messages.at(-1) && "content" in input.messages.at(-1)!
    ? String((input.messages.at(-1) as { content: string }).content)
    : "";
}

function pushTraceNote(ctx: RunContext): void {
  if (!ctx.trace.length) return;
  if (ctx.notes.some((n) => n.kind === "tool_trace")) return;
  const note = formatTraceNote(ctx.trace);
  ctx.notes.push({ kind: "tool_trace", body: note.body, meta: { calls: note.calls } });
}

async function* streamRun(
  definition: AgentDefinition,
  ctx: RunContext,
  input: ProviderRunInput,
): AsyncIterable<ProviderChunk> {
  const apiKey = readCursorApiKey(definition);
  if (!apiKey) {
    yield { type: "error", message: "cursor_key_missing", retryable: false };
    return;
  }

  const cwd = await prepareCursorWorkspace(ctx);
  const model =
    typeof definition.providerOptions.cursorModel === "string" && definition.providerOptions.cursorModel
      ? definition.providerOptions.cursorModel
      : DEFAULT_MODEL;

  const { Agent, JsonlLocalAgentStore } = await loadSdk();
  throwIfAborted(input.signal);

  const storeDir = path.join(cursorStoreRoot(ctx.user.id, definition.slug), "store");
  await mkdir(storeDir, { recursive: true });
  const mcpServers = parseMcpServers(definition.providerOptions.mcpServers);
  const createOptions = {
    apiKey,
    model: { id: model },
    systemPrompt: input.system,
    mcpServers,
    local: {
      cwd,
      settingSources: ["project"] as Array<"project">,
      customTools: townBridgeTools(ctx),
      store: new JsonlLocalAgentStore(storeDir),
      autoReview: true,
    },
  } as unknown as Parameters<SdkModule["Agent"]["create"]>[0];

  const savedId = await loadCursorAgentId(ctx.user.id, definition.slug);
  let agent: Awaited<ReturnType<SdkModule["Agent"]["create"]>>;
  if (savedId) {
    try {
      agent = await raceAbort(Agent.resume(savedId, createOptions), input.signal);
    } catch {
      agent = await raceAbort(Agent.create(createOptions), input.signal);
    }
  } else {
    agent = await raceAbort(Agent.create(createOptions), input.signal);
  }

  await saveCursorAgentId(ctx.user.id, definition.slug, agent.agentId);

  try {
    const run = await raceAbort(agent.send(latestUserText(ctx, input), { local: { force: true } }), input.signal);
    const abort = () => {
      if (run.supports("cancel")) void run.cancel();
    };
    input.signal?.addEventListener("abort", abort, { once: true });

    try {
      for await (const event of run.stream()) {
        throwIfAborted(input.signal);
        if (event.type === "assistant") {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) yield { type: "text", delta: block.text };
          }
        }
        if (event.type === "usage" && event.usage) {
          yield {
            type: "usage",
            inputTokens: event.usage.inputTokens ?? 0,
            outputTokens: event.usage.outputTokens ?? 0,
          };
        }
      }

      const result = await raceAbort(run.wait(), input.signal);
      if (result.status === "error") {
        yield { type: "error", message: `cursor run ${result.id} failed`, retryable: false };
      }
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }
  } finally {
    pushTraceNote(ctx);
    await agent[Symbol.asyncDispose]();
  }
}

export function resolveCursorProvider(definition: AgentDefinition, ctx?: RunContext): Provider | null {
  if (definition.kind !== "code" || !definition.isTownNative) return null;
  if (!readCursorApiKey(definition)) return null;
  if (!ctx) return null;

  return {
    id: "cursor",
    modelId: `cursor:${typeof definition.providerOptions.cursorModel === "string" && definition.providerOptions.cursorModel
      ? definition.providerOptions.cursorModel
      : DEFAULT_MODEL}`,
    async *run(input: ProviderRunInput): AsyncIterable<ProviderChunk> {
      try {
        yield* streamRun(definition, ctx, {
          ...input,
          maxOutputTokens: input.maxOutputTokens ?? LIMITS.maxOutputTokens,
        });
      } catch (err) {
        const { CursorAgentError } = await loadSdk();
        if (err instanceof CursorAgentError) {
          yield { type: "error", message: err.message, retryable: err.isRetryable };
          return;
        }
        throw err;
      }
    },
  };
}
