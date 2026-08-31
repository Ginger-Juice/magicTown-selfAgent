import { createHookBus, type Hook } from "./bus";
import { defaultGuards } from "./guards";
import { memoryHook } from "./memory";
import type { HookBus } from "../types";

/**
 * Single place where the hook chain is assembled. Order matters for
 * `beforeTool`: cheap structural checks first, so an obviously bad call never
 * reaches the expensive ones. Memory goes last because it is the only hook
 * that touches the database.
 */
export function buildHooks(extra: Hook[] = []): HookBus {
  return createHookBus([...defaultGuards(), ...extra, memoryHook]);
}

export { createHookBus, defaultGuards, memoryHook };
export type { Hook };
