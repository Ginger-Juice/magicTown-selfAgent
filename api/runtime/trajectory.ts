import { getDb } from "../queries/connection";
import { toolEvents } from "@db/schema";
import { truncatePayload, WORKSPACE_LIMITS } from "./workspace";
import type { RunContext, StepOutcome, ToolCall } from "./types";

export type ToolLogType = "tool/call" | "tool/result";

export type ToolLogEvent = {
  type: ToolLogType;
  callId: string;
  step: number;
  payload: Record<string, unknown>;
};

export async function persistToolEvent(ctx: RunContext, event: ToolLogEvent): Promise<void> {
  if (ctx.recordToolEvent) {
    await ctx.recordToolEvent(event);
    return;
  }
  if (ctx.runId == null) return;
  try {
    await getDb().insert(toolEvents).values({
      runId: ctx.runId,
      conversationId: ctx.conversationId,
      userId: ctx.user.id,
      agentId: ctx.definition.id,
      type: event.type,
      callId: event.callId,
      step: event.step,
      payload: JSON.stringify(truncatePayload(event.payload, WORKSPACE_LIMITS.payloadChars)),
    });
  } catch (err) {
    console.error("[runtime] tool event persist failed", err);
  }
}

export function callPayload(call: ToolCall): Record<string, unknown> {
  return {
    name: call.name,
    arguments: truncatePayload(call.args ?? {}),
  };
}

export function resultPayload(
  call: ToolCall,
  outcome: StepOutcome,
  extra: { allowed: boolean; reason?: string; ms: number },
): Record<string, unknown> {
  const data = outcome.data as { error?: string; denied?: string } | null;
  const denied = !extra.allowed || Boolean(data && typeof data === "object" && (data.denied || data.error));
  return {
    name: call.name,
    isError: denied,
    denied: !extra.allowed,
    errorCode: extra.reason ?? data?.denied ?? data?.error,
    result: truncatePayload(outcome.data),
    ms: extra.ms,
  };
}

export function formatTraceNote(trace: RunContext["trace"]): { body: string; calls: unknown[] } {
  const lines = trace.map((entry) => {
    const mark = entry.allowed ? "成" : "拒";
    return `${mark} ${entry.tool} ${entry.ms}ms${entry.reason ? `（${entry.reason}）` : ""}`;
  });
  return {
    body: `这一轮动过的手：\n${lines.join("\n")}`,
    calls: trace.map((entry) => ({
      callId: entry.callId,
      tool: entry.tool,
      allowed: entry.allowed,
      reason: entry.reason,
      ms: entry.ms,
      args: entry.args,
      result: entry.result,
    })),
  };
}
