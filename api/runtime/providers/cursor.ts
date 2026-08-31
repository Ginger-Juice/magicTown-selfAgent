import { LIMITS } from "../limits";
import type { AgentDefinition } from "../types";
import type { Provider, ProviderChunk, ProviderRunInput } from "./types";

const DEFAULT_MODEL = "composer-2.5";

type CursorOptions = {
  apiKey: string;
  model: string;
  cwd: string;
};

/**
 * Reads the per-agent config. The key comes from the agent row rather than
 * global env on purpose: a Cursor key belongs to whoever staffed that agent,
 * and one shared team key driving `local` mode would hand every visitor a
 * shell that auto-approves.
 */
function readOptions(definition: AgentDefinition): CursorOptions | null {
  const opts = definition.providerOptions;
  const apiKey = opts.cursorApiKey;
  if (typeof apiKey !== "string" || !apiKey.trim()) return null;

  const cwd = typeof opts.cursorCwd === "string" && opts.cursorCwd ? opts.cursorCwd : process.cwd();
  const model =
    typeof opts.cursorModel === "string" && opts.cursorModel ? opts.cursorModel : DEFAULT_MODEL;

  return { apiKey: apiKey.trim(), model, cwd };
}

/**
 * Loaded on first use rather than at import time: the SDK is large, ships its
 * own optional native deps, and is marked external in the API bundle, so a
 * town with no Cursor-staffed agent should never touch it.
 */
async function loadSdk() {
  return import("@cursor/sdk");
}

function flatten(input: ProviderRunInput): string {
  return [
    input.system,
    ...input.messages.map((m) =>
      m.role === "user"
        ? `访客：${m.content}`
        : m.role === "assistant"
          ? `你：${m.content}`
          : m.content,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A Cursor agent brings its own tools and runs them itself, so this provider
 * never emits `tool_call` — the loop sees one step of text and stops. That is
 * the intended shape: the workshop's tooling is Cursor's, not the town's.
 */
async function* streamRun(
  options: CursorOptions,
  input: ProviderRunInput,
): AsyncIterable<ProviderChunk> {
  const { Agent } = await loadSdk();

  await using agent = await Agent.create({
    apiKey: options.apiKey,
    model: { id: options.model },
    // Explicit even though it is the default: omitting it silently picks local,
    // and that is not a thing to discover later.
    local: { cwd: options.cwd },
  });

  const run = await agent.send(flatten(input));

  const abort = () => {
    if (run.supports("cancel")) void run.cancel();
  };
  input.signal?.addEventListener("abort", abort, { once: true });

  try {
    for await (const event of run.stream()) {
      if (event.type !== "assistant") continue;
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          yield { type: "text", delta: block.text };
        }
      }
    }

    // A run that started and then failed is a different animal from one that
    // never started; only the latter throws.
    const result = await run.wait();
    if (result.status === "error") {
      yield { type: "error", message: `cursor run ${result.id} failed`, retryable: false };
    }
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}

export function resolveCursorProvider(definition: AgentDefinition): Provider | null {
  // The rune workshop is the only building wired for this.
  if (definition.kind !== "code" || !definition.isTownNative) return null;

  const options = readOptions(definition);
  if (!options) return null;

  return {
    id: "cursor",
    async *run(input: ProviderRunInput): AsyncIterable<ProviderChunk> {
      try {
        yield* streamRun(options, {
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
