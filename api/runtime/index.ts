import { and, eq } from "drizzle-orm";
import { agentRuns, users } from "@db/schema";
import { getDb } from "../queries/connection";
import { agentBusy, RuntimeError } from "./errors";
import { LIMITS } from "./limits";
import { runLoop } from "./loop";
import { buildHooks } from "./hooks";
import { buildSystemPrompt } from "./prompt";
import { loadDefinition } from "./registry";
import { loadTranscript, withSessionSummary } from "./transcript";
import { compressSession } from "./memory/distill";
import { resolveBuiltinProvider } from "./providers/builtin";
import { resolveCursorProvider } from "./providers/cursor";
import type { Hook } from "./hooks";
import type { Provider } from "./providers/types";
import type {
  AgentDefinition,
  ModelMessage,
  RunContext,
  RunRequest,
  RunResult,
  RunUser,
  ToolSpec,
} from "./types";

function isDuplicateKey(err: unknown): boolean {
  const code = (err as { code?: string; errno?: number } | null)?.code;
  const errno = (err as { errno?: number } | null)?.errno;
  return code === "ER_DUP_ENTRY" || errno === 1062 || /duplicate entry/i.test(String(err));
}

/**
 * An explicit choice always wins. Only when the visitor has expressed no
 * preference does the agent's own kind get to pick — otherwise picking a model
 * in the rune workshop would silently do nothing.
 */
function resolveProvider(definition: AgentDefinition, model?: string | null): Provider {
  if (!model && definition.provider === "cursor") {
    const cursor = resolveCursorProvider(definition);
    if (cursor) return cursor;
  }
  return resolveBuiltinProvider(model);
}

async function loadUser(userId: number): Promise<RunUser> {
  const row = await getDb().query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) throw new RuntimeError("agent_not_found", `user ${userId} does not exist`);
  return { id: row.id, displayName: row.displayName, email: row.email };
}

/**
 * Single-flight per (agent, user). MySQL unique indexes permit many NULLs, so a
 * running turn parks its key in `lockKey` and clears it on finish — which works
 * without the interactive transactions the planetscale driver lacks.
 */
async function acquireRun(
  agentId: number,
  userId: number,
  conversationId: number | null,
  depth: number,
): Promise<number> {
  const db = getDb();
  try {
    const [{ id }] = await db
      .insert(agentRuns)
      .values({
        agentId,
        userId,
        conversationId,
        depth,
        status: "running",
        lockKey: `${agentId}:${userId}`,
      })
      .$returningId();
    return id;
  } catch (err) {
    if (isDuplicateKey(err)) throw agentBusy(agentId, userId);
    throw err;
  }
}

async function releaseRun(
  runId: number,
  patch: {
    status: "done" | "failed";
    steps?: number;
    inputTokens?: number;
    outputTokens?: number;
    trace?: unknown;
    error?: string;
  },
): Promise<void> {
  await getDb()
    .update(agentRuns)
    .set({
      status: patch.status,
      lockKey: null,
      steps: patch.steps ?? 0,
      inputTokens: patch.inputTokens ?? 0,
      outputTokens: patch.outputTokens ?? 0,
      trace: patch.trace ? JSON.stringify(patch.trace) : null,
      error: patch.error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(agentRuns.id, runId));
}

/**
 * Clears a lock left behind by a crashed process. Cheap enough to call before
 * giving up on `agent_busy`, and avoids a stuck agent needing manual surgery.
 */
export async function reapStaleLock(agentId: number, userId: number): Promise<boolean> {
  const db = getDb();
  const stale = await db.query.agentRuns.findFirst({
    where: and(eq(agentRuns.lockKey, `${agentId}:${userId}`), eq(agentRuns.status, "running")),
  });
  if (!stale) return false;
  if (Date.now() - stale.startedAt.getTime() < LIMITS.wallClockMs * 2) return false;
  await releaseRun(stale.id, { status: "failed", error: "abandoned" });
  return true;
}

export type RuntimeDeps = {
  hooks?: Hook[];
  /** Resolved per agent, because the tool set is part of the kind's contract. */
  tools?: (definition: AgentDefinition) => ToolSpec[];
  /** Overridden in tests to avoid touching the network. */
  provider?: Provider;
};

export type Runtime = {
  run(request: RunRequest): Promise<RunResult>;
};

export function createRuntime(deps: RuntimeDeps = {}): Runtime {
  return {
    async run(request: RunRequest): Promise<RunResult> {
      const depth = request.depth ?? 0;
      if (depth > LIMITS.maxDepth) {
        throw new RuntimeError("depth_exceeded", `depth ${depth} exceeds ${LIMITS.maxDepth}`);
      }

      const [definition, user] = await Promise.all([
        loadDefinition(request.agentId),
        loadUser(request.userId),
      ]);

      let runId: number;
      try {
        runId = await acquireRun(definition.id, user.id, request.conversationId, depth);
      } catch (err) {
        if (err instanceof RuntimeError && err.code === "agent_busy") {
          const reaped = await reapStaleLock(definition.id, user.id);
          if (!reaped) throw err;
          runId = await acquireRun(definition.id, user.id, request.conversationId, depth);
        } else {
          throw err;
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LIMITS.wallClockMs);
      if (request.signal) {
        request.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      const ctx: RunContext = {
        definition,
        user,
        conversationId: request.conversationId,
        depth,
        runId,
        provider: deps.provider ?? resolveProvider(definition, request.model),
        signal: controller.signal,
        startedAt: Date.now(),
        memoryBlocks: { self: "", user: "" },
        sessionSummary: "",
        trace: [],
        notes: [],
        toolCallCount: 0,
        realActions: [],
        envelopesCreated: 0,
      };

      const hooks = buildHooks(deps.hooks ?? []);

      try {
        await hooks.beforeTurn(ctx);

        const history = request.conversationId
          ? await loadTranscript(request.conversationId)
          : { messages: [] as ModelMessage[], overflow: [], total: 0 };

        const messages = withSessionSummary(ctx.sessionSummary, history.messages);
        const system = buildSystemPrompt({
          definition,
          userMessage: request.userMessage,
          memoryBlocks: ctx.memoryBlocks,
        });

        const outcome = await runLoop({
          ctx,
          hooks,
          tools: deps.tools?.(definition) ?? [],
          system,
          messages,
        });

        await hooks.afterTurn(ctx, outcome.finalText);

        // Lazy rolling compression: only pays the extra model call on the turn
        // that actually pushed messages out of the window.
        if (request.conversationId && history.overflow.length) {
          void compressSession({
            conversationId: request.conversationId,
            userId: user.id,
            overflow: history.overflow,
          });
        }

        await releaseRun(runId, {
          status: "done",
          steps: outcome.steps,
          inputTokens: outcome.usage.inputTokens,
          outputTokens: outcome.usage.outputTokens,
          trace: ctx.trace,
        });

        return {
          finalText: outcome.finalText,
          modelId: ctx.provider.modelId ?? null,
          steps: outcome.steps,
          envelopesCreated: ctx.envelopesCreated,
          notes: ctx.notes,
          trace: ctx.trace,
          usage: outcome.usage,
          runId,
        };
      } catch (err) {
        await hooks.onError(ctx, err);
        await releaseRun(runId, {
          status: "failed",
          steps: ctx.trace.length,
          trace: ctx.trace,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
