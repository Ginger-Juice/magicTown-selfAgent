import { RuntimeError } from "./errors";

export function turnAborted(): RuntimeError {
  return new RuntimeError("aborted", "turn aborted", true);
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw turnAborted();
}

/** Rejects when `signal` aborts. Caller must `dispose` if the other side won the race. */
export function watchAbort(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
  let onAbort: (() => void) | undefined;
  const promise = new Promise<never>((_, reject) => {
    onAbort = () => reject(turnAborted());
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return {
    promise,
    dispose() {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * Lets a hanging provider / DB call lose to the wall-clock abort, even when the
 * underlying work ignores `signal`. The loser keeps running in the background.
 */
export async function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  const watch = watchAbort(signal);
  try {
    return await Promise.race([promise, watch.promise]);
  } finally {
    watch.dispose();
  }
}
