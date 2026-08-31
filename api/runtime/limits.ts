/** Every hard ceiling in the runtime lives here so none of them hide in a call site. */
export const LIMITS = {
  // Loop
  maxSteps: 8,
  maxToolCallsPerTurn: 12,
  maxDepth: 1,
  wallClockMs: 60_000,
  maxOutputTokens: 2048,

  // A2A
  pingPongWarn: 2,
  pingPongBlock: 4,
  pingPongWindowMs: 2 * 60_000,
  envelopeTtlMs: 10 * 60_000,
  envelopeMaxAttempts: 2,

  // Transcript
  transcriptKeepTurns: 12,
  summaryMaxTokens: 300,

  // Memory
  memoryDigestTokens: 600,
  memoryPeerDigestTokens: 200,
  memoryMaxL1PerSubject: 40,
  memoryMaxL2PerSubject: 120,
  memoryMaxValueBytes: 2048,
  memoryL2TtlDays: 180,
  idleDistillMs: 30 * 60_000,
  sweeperIntervalMs: 5 * 60_000,
  distillMaxOutputTokens: 400,
} as const;

/**
 * The 600 token digest budget, split four ways. Self blocks are small because
 * the agent's persona already carries most of its identity.
 */
export const MEMORY_BUDGET = {
  selfL1: 80,
  selfL2: 120,
  userL1: 200,
  userL2: 200,
} as const;

/**
 * Rough CJK-aware token estimate. Only ever used for budgeting the digest, so
 * being off by 20% costs a few tokens, not correctness.
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x2e80 && code <= 0x9fff) cjk++;
  }
  const rest = text.length - cjk;
  return Math.ceil(cjk * 0.75 + rest / 4);
}
