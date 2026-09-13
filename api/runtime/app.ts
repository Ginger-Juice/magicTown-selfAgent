import { createRuntime, type Runtime, type RuntimeDeps } from "./index";
import { ToolRegistry } from "./tools/registry";
import { TOWN_TOOLS } from "./tools/town";
import { MEMORY_TOOLS } from "./tools/memory";
import { A2A_TOOLS } from "./tools/a2a";
import { HANDS_TOOLS } from "./tools/hands";
import { HANDS_TOOL_IDS, mayUseHands } from "./workspace";
import { divinationArchiveHook, type Hook } from "./hooks";
import type { AgentDefinition, ToolSpec } from "./types";

/**
 * Framework tools every agent gets, on top of whatever its kind declares.
 * `propose_memory` is listed for all of them because policy already denies it
 * to any kind without slots — the tool answers with the reason, which is more
 * useful to the model than the tool silently not existing.
 */
const ALWAYS_ON_TOOLS = [
  "propose_memory",
  "remember_insight",
  "forget_insight",
  "ask_agent",
  "tell_agent",
  "handoff",
  "list_town",
];

const registry = new ToolRegistry().register(...TOWN_TOOLS, ...MEMORY_TOOLS, ...A2A_TOOLS, ...HANDS_TOOLS);

export function townToolRegistry(): ToolRegistry {
  return registry;
}

export function toolsFor(definition: AgentDefinition): ToolSpec[] {
  const extra = mayUseHands(definition) ? [...HANDS_TOOL_IDS] : [];
  return registry.resolve(definition.toolIds, [...ALWAYS_ON_TOOLS, ...extra]);
}

function townHooks(): Hook[] {
  return [divinationArchiveHook];
}

let cached: Runtime | null = null;

/**
 * The town's single wired runtime. Tests build their own with `createRuntime`
 * so they never touch the registry or the network.
 */
export function getTownRuntime(): Runtime {
  if (!cached) cached = createRuntime(buildDeps());
  return cached;
}

function buildDeps(): RuntimeDeps {
  return { hooks: townHooks(), tools: toolsFor };
}

/** Exposed for tests and for hot reload in dev. */
export function resetTownRuntime(): void {
  cached = null;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    resetTownRuntime();
  });
}
