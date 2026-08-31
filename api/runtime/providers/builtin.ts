import { LIMITS } from "../limits";
import { RuntimeError } from "../errors";
import { resolveModel, type ResolvedModel } from "./catalog";
import type { ModelMessage } from "../types";
import type { Provider, ProviderChunk, ProviderRunInput } from "./types";

type WireMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

function toWire(messages: ModelMessage[]): WireMessage[] {
  return messages.map((m) => {
    switch (m.role) {
      case "assistant":
        return {
          role: "assistant" as const,
          content: m.content || null,
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.callId,
                  type: "function" as const,
                  function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
                })),
              }
            : {}),
        };
      case "tool":
        return { role: "tool" as const, content: m.content, tool_call_id: m.callId };
      default:
        return { role: m.role, content: m.content };
    }
  });
}

/** Accumulates `delta.tool_calls[]` fragments, which arrive split by `index`. */
type PartialCall = { id: string; name: string; args: string };

function parseArgs(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    // A malformed argument blob is the model's problem to fix on the next step,
    // so surface it as data rather than throwing the whole turn away.
    return { __unparsed: trimmed };
  }
}

async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
        newline = buffer.indexOf("\n");
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith("data:")) yield tail.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}

export function createBuiltinProvider(resolved: ResolvedModel): Provider {
  const { baseUrl, apiKey, model } = resolved;

  return {
    id: "builtin",
    modelId: resolved.id,

    async *run(input: ProviderRunInput): AsyncIterable<ProviderChunk> {
      if (!apiKey) {
        throw new RuntimeError(
          "no_credentials",
          `${resolved.vendor.prefix}_API_KEY is not configured`,
        );
      }

      const body = {
        model,
        stream: true,
        max_tokens: input.maxOutputTokens ?? LIMITS.maxOutputTokens,
        messages: [{ role: "system", content: input.system }, ...toWire(input.messages)],
        ...(input.tools.length
          ? {
              tools: input.tools.map((t) => ({
                type: "function",
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                },
              })),
              tool_choice: "auto",
            }
          : {}),
      };

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: input.signal,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new RuntimeError(
          "provider_failed",
          `${resolved.vendor.label} request failed: ${message}`,
          true,
        );
      }

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw new RuntimeError(
          "provider_failed",
          `${resolved.vendor.label} responded ${response.status}: ${detail.slice(0, 400)}`,
          response.status >= 500 || response.status === 429,
        );
      }

      const partials = new Map<number, PartialCall>();

      for await (const payload of readSse(response.body)) {
        if (!payload || payload === "[DONE]") continue;

        let event: unknown;
        try {
          event = JSON.parse(payload);
        } catch {
          continue; // keep-alive or a comment frame
        }

        const choice = (
          event as {
            choices?: {
              delta?: {
                content?: string | null;
                tool_calls?: {
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }[];
              };
              finish_reason?: string | null;
            }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          }
        ).choices?.[0];

        const usage = (event as { usage?: { prompt_tokens?: number; completion_tokens?: number } })
          .usage;
        if (usage) {
          yield {
            type: "usage",
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
          };
        }
        if (!choice) continue;

        const delta = choice.delta;
        if (delta?.content) yield { type: "text", delta: delta.content };

        for (const fragment of delta?.tool_calls ?? []) {
          const index = fragment.index ?? 0;
          const existing = partials.get(index) ?? { id: "", name: "", args: "" };
          partials.set(index, {
            id: fragment.id ?? existing.id,
            name: fragment.function?.name ?? existing.name,
            args: existing.args + (fragment.function?.arguments ?? ""),
          });
        }

        // Arguments are only complete once the choice finishes.
        if (choice.finish_reason) {
          for (const [index, call] of [...partials.entries()].sort((a, b) => a[0] - b[0])) {
            if (!call.name) continue;
            yield {
              type: "tool_call",
              callId: call.id || `call_${index}`,
              name: call.name,
              args: parseArgs(call.args),
            };
          }
          partials.clear();
        }
      }
    },
  };
}

/** Null object so a missing key degrades to a readable message, not a crash. */
export function createUnconfiguredProvider(): Provider {
  return {
    id: "unconfigured",
    // eslint-disable-next-line require-yield
    async *run(): AsyncIterable<ProviderChunk> {
      throw new RuntimeError(
        "no_credentials",
        "没有配置任何模型厂商的 key；在 .env 里填一个再来叫醒镇民",
      );
    },
  };
}

/**
 * `requested` is whatever the conversation is pinned to. The catalog handles
 * falling back, so an unknown or de-configured choice still gets a working
 * provider rather than an error.
 */
export function resolveBuiltinProvider(requested?: string | null): Provider {
  const resolved = resolveModel(requested);
  return resolved ? createBuiltinProvider(resolved) : createUnconfiguredProvider();
}
