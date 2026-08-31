export type RuntimeErrorCode =
  | "no_credentials"
  | "provider_failed"
  | "provider_bad_response"
  | "agent_busy"
  | "agent_not_found"
  | "depth_exceeded"
  | "memory_policy"
  | "memory_deidentify"
  | "memory_full"
  | "aborted";

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly retryable: boolean;

  constructor(code: RuntimeErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function isRuntimeError(err: unknown): err is RuntimeError {
  return err instanceof RuntimeError;
}

/** `agent_busy` is expected under double-submit, so callers surface it gently. */
export function agentBusy(agentId: number, userId: number): RuntimeError {
  return new RuntimeError(
    "agent_busy",
    `agent ${agentId} already has a turn running for user ${userId}`,
  );
}
