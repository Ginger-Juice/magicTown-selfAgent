import type { ModelMessage } from "../types";

export type JsonSchemaTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ProviderChunk =
  | { type: "text"; delta: string }
  | { type: "tool_call"; callId: string; name: string; args: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; message: string; retryable: boolean };

export type ProviderRunInput = {
  system: string;
  messages: ModelMessage[];
  tools: JsonSchemaTool[];
  signal: AbortSignal;
  /** Distillation overrides this to keep summary calls cheap. */
  maxOutputTokens?: number;
};

/**
 * The only contract that crosses a provider boundary. Kept deliberately thin so
 * swapping the builtin fetch client for an SDK touches exactly one file.
 */
export interface Provider {
  readonly id: string;
  /** `vendor:model`, recorded on the run so a bad answer can be traced back. */
  readonly modelId?: string;
  run(input: ProviderRunInput): AsyncIterable<ProviderChunk>;
}
