import { RuntimeError } from "./errors";
import { LIMITS } from "./limits";
import { toJsonSchemaTools } from "./tools/registry";
import type { ProviderChunk } from "./providers/types";
import type {
  HookBus,
  ModelMessage,
  RunContext,
  StepOutcome,
  ToolCall,
  ToolSpec,
} from "./types";

export type LoopInput = {
  ctx: RunContext;
  hooks: HookBus;
  tools: ToolSpec[];
  system: string;
  messages: ModelMessage[];
};

export type LoopOutcome = {
  finalText: string;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
};

type DrainResult = {
  text: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
};

async function drain(stream: AsyncIterable<ProviderChunk>): Promise<DrainResult> {
  let text = "";
  const toolCalls: ToolCall[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };

  for await (const chunk of stream) {
    switch (chunk.type) {
      case "text":
        text += chunk.delta;
        break;
      case "tool_call":
        toolCalls.push({ callId: chunk.callId, name: chunk.name, args: chunk.args });
        break;
      case "usage":
        usage.inputTokens += chunk.inputTokens;
        usage.outputTokens += chunk.outputTokens;
        break;
      case "error":
        throw new RuntimeError("provider_failed", chunk.message, chunk.retryable);
    }
  }

  return { text, toolCalls, usage };
}

function toolResultMessage(call: ToolCall, data: unknown): ModelMessage {
  let content: string;
  try {
    content = typeof data === "string" ? data : JSON.stringify(data ?? null);
  } catch {
    content = '{"error":"unserializable_result"}';
  }
  return { role: "tool", callId: call.callId, name: call.name, content };
}

/**
 * The whole model loop. Deliberately thin: it owns turn-taking and nothing else.
 * Permission lives in hooks, side effects live in tools, prose lives in the model.
 */
export async function runLoop(input: LoopInput): Promise<LoopOutcome> {
  const { ctx, hooks, tools, system } = input;
  const byId = new Map(tools.map((t) => [t.id, t]));
  const schemas = toJsonSchemaTools(tools);
  const messages: ModelMessage[] = [...input.messages];

  const usage = { inputTokens: 0, outputTokens: 0 };
  let finalText = "";
  let steps = 0;

  for (let step = 1; step <= LIMITS.maxSteps; step++) {
    steps = step;

    if (Date.now() - ctx.startedAt > LIMITS.wallClockMs) {
      ctx.notes.push({
        kind: "notice",
        body: "这一轮想得太久，先停在这里。",
        meta: { reason: "wall_clock" },
      });
      break;
    }

    const result = await drain(
      ctx.provider.run({ system, messages, tools: schemas, signal: ctx.signal }),
    );
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;

    if (result.toolCalls.length === 0) {
      finalText = result.text;
      break;
    }

    // Keep the text that came alongside the calls; models often narrate first.
    if (result.text.trim()) finalText = result.text;
    messages.push({
      role: "assistant",
      content: result.text,
      toolCalls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      const startedAt = Date.now();
      let outcome: StepOutcome;
      let allowed = true;
      let reason: string | undefined;

      if (ctx.toolCallCount >= LIMITS.maxToolCallsPerTurn) {
        allowed = false;
        reason = "tool_budget_exhausted";
        outcome = { data: { denied: reason } };
      } else {
        const spec = byId.get(call.name);
        if (!spec) {
          allowed = false;
          reason = "unknown_tool";
          outcome = { data: { error: reason, available: [...byId.keys()] } };
        } else {
          const verdict = await hooks.beforeTool(ctx, call);
          allowed = verdict.allowed;
          reason = verdict.reason;
          if (!allowed) {
            // A denial is fed back so the model can pick another route.
            outcome = { data: { denied: verdict.reason ?? "not_allowed" } };
          } else {
            ctx.toolCallCount += 1;
            outcome = await spec.execute(call.args, ctx);
            if (spec.realAction) ctx.realActions.push(spec.id);
          }
        }
      }

      await hooks.afterTool(ctx, call, outcome);
      ctx.trace.push({
        step,
        tool: call.name,
        allowed,
        reason,
        ms: Date.now() - startedAt,
      });

      messages.push(toolResultMessage(call, outcome.data));
      if (outcome.nextPrompt) messages.push({ role: "user", content: outcome.nextPrompt });
      if (outcome.shouldExit) return { finalText, steps, usage };
    }

    if (step === LIMITS.maxSteps) {
      ctx.notes.push({
        kind: "notice",
        body: "这一轮来回太多次了，先给你一个阶段性的答复。",
        meta: { reason: "max_steps" },
      });
    }
  }

  return { finalText, steps, usage };
}
