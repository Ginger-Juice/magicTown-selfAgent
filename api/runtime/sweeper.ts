import { LIMITS } from "./limits";
import { purgeExpired } from "./memory/store";
import { sweepIdleConversations } from "./memory/distill";
import { expireStale } from "./a2a/envelope";
import { drainEnvelopes } from "./a2a/worker";
import { getTownRuntime } from "./app";

/**
 * There is no cron in this deployment, so the two background chores ride on a
 * plain interval inside the API process. Both are idempotent and skip work when
 * there is none, so a second process starting up only costs a query.
 */
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function sweep(): Promise<void> {
  // Overlapping sweeps would distil the same conversation twice.
  if (running) return;
  running = true;
  try {
    // Envelopes first: a stuck errand is the one a visitor is actually waiting on.
    const expired = await expireStale();
    const delivered = await drainEnvelopes(getTownRuntime());
    const distilled = await sweepIdleConversations();
    const purged = await purgeExpired();
    if (delivered || expired || distilled || purged) {
      console.log(
        `[runtime] sweep: delivered ${delivered}, expired ${expired}, distilled ${distilled}, purged ${purged}`,
      );
    }
  } catch (err) {
    console.error("[runtime] sweep failed", err);
  } finally {
    running = false;
  }
}

export function startSweeper(): void {
  if (timer) return;
  timer = setInterval(() => void sweep(), LIMITS.sweeperIntervalMs);
  // Never hold the process open for a chore.
  timer.unref?.();
}

export function stopSweeper(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
