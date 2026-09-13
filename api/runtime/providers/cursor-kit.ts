import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { A2A_TOOLS } from "../tools/a2a";
import { MEMORY_TOOLS } from "../tools/memory";
import { TOWN_TOOLS } from "../tools/town";
import { persistToolEvent, resultPayload } from "../trajectory";
import { ensureWorkspace, workspaceBase } from "../workspace";
import type { AgentDefinition, RunContext, ToolSpec } from "../types";

export const CURSOR_BRIDGE_TOOL_IDS = [
  "save_snippet",
  "propose_memory",
  "remember_insight",
  "forget_insight",
  "ask_agent",
  "tell_agent",
  "list_town",
] as const;

const BRIDGE_TOOLS: ToolSpec[] = [...TOWN_TOOLS, ...MEMORY_TOOLS, ...A2A_TOOLS].filter((t) =>
  (CURSOR_BRIDGE_TOOL_IDS as readonly string[]).includes(t.id),
);

export type CursorMcpServers = Record<string, Record<string, unknown>>;

export type CursorSkillSeed = { name: string; body: string };

export function cursorStoreRoot(userId: number, slug: string): string {
  return path.resolve(workspaceBase(), "..", "cursor-agents", `u${userId}`, slug);
}

export function parseMcpServers(raw: unknown): CursorMcpServers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CursorMcpServers = {};
  for (const [name, cfg] of Object.entries(raw as Record<string, unknown>)) {
    if (!name.trim() || !cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
    out[name.trim()] = cfg as Record<string, unknown>;
  }
  return out;
}

export function parseSkillSeeds(raw: unknown): CursorSkillSeed[] {
  if (!Array.isArray(raw)) return [];
  const out: CursorSkillSeed[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = String((item as { name?: unknown }).name ?? "").trim();
    const body = String((item as { body?: unknown }).body ?? "");
    if (!name || !body.trim()) continue;
    out.push({ name: name.replace(/[^\w.-]+/g, "-").slice(0, 40), body });
  }
  return out;
}

export function readCursorApiKey(definition: AgentDefinition): string | null {
  const fromRow = definition.providerOptions.cursorApiKey;
  if (typeof fromRow === "string" && fromRow.trim()) return fromRow.trim();
  if (definition.isTownNative && definition.kind === "code") {
    const fromEnv = process.env.CURSOR_API_KEY?.trim();
    if (fromEnv) return fromEnv;
  }
  return null;
}

async function writeIfMissing(file: string, contents: string): Promise<void> {
  try {
    await readFile(file);
  } catch {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, "utf8");
  }
}

const HOOK_SCRIPT = `let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { payload = {}; }
  const command = String(payload.command ?? "");
  const blocked = /\\b(rm\\s+-rf|format\\s+[c-z]:|del\\s+\\/s)\\b/i.test(command)
    || /(?:^|[\\s"'=])(?:[a-zA-Z]:\\\\|\\/etc\\/|\\/windows\\/)/i.test(command);
  const verdict = blocked
    ? { permission: "deny", agent_message: "这条命令会摸到工坊外面或太危险，换一条相对工作区的。" }
    : { permission: "allow" };
  process.stdout.write(JSON.stringify(verdict));
});
`;

const DEFAULT_SKILL = [
  "---",
  "name: workshop",
  "description: 符文工坊台面规矩。访客工作区相对路径、收抽屉、不要碰本机盘符。",
  "---",
  "",
  "path 一律相对当前工作区。改稿放 src/，运行产物放 out/。",
  "长期事实用 propose_memory（要访客点头）；手艺用 remember_insight；代码片段用 save_snippet。",
  "找别的镇民用 ask_agent / tell_agent / list_town，正文 @ 无效。",
  "不要探测访客本机磁盘。扩展 MCP 写进 .cursor/mcp.json 或 providerOptions.mcpServers。",
  "",
].join("\n");

const AGENTS_MD = [
  "这是当前访客的符文工坊工作区。",
  "项目级 skill / hook / MCP 都在 .cursor/ 下，改文件即生效（下一轮 reload）。",
  "",
].join("\n");

export async function seedCursorProject(
  cwd: string,
  definition: AgentDefinition,
): Promise<void> {
  await mkdir(path.join(cwd, ".cursor", "hooks"), { recursive: true });
  await mkdir(path.join(cwd, ".cursor", "skills", "workshop"), { recursive: true });

  await writeIfMissing(path.join(cwd, "AGENTS.md"), AGENTS_MD);
  await writeIfMissing(path.join(cwd, ".cursor", "hooks", "before-shell.mjs"), HOOK_SCRIPT);
  await writeIfMissing(
    path.join(cwd, ".cursor", "hooks.json"),
    `${JSON.stringify(
      {
        version: 1,
        hooks: {
          beforeShellExecution: [
            { command: "node hooks/before-shell.mjs", failClosed: true, timeout: 8 },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeIfMissing(
    path.join(cwd, ".cursor", "mcp.json"),
    `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
  );
  await writeIfMissing(path.join(cwd, ".cursor", "skills", "workshop", "SKILL.md"), DEFAULT_SKILL);

  for (const skill of definition.skills) {
    const slug = skill.id.replace(/[^\w.-]+/g, "-").slice(0, 40) || "skill";
    await writeIfMissing(
      path.join(cwd, ".cursor", "skills", slug, "SKILL.md"),
      `---\nname: ${slug}\ndescription: ${skill.useWhen.join(", ") || slug}\n---\n\n${skill.body.trim()}\n`,
    );
  }
  for (const skill of parseSkillSeeds(definition.providerOptions.skills)) {
    await writeIfMissing(path.join(cwd, ".cursor", "skills", skill.name, "SKILL.md"), skill.body);
  }

  const extraMcp = parseMcpServers(definition.providerOptions.mcpServers);
  if (Object.keys(extraMcp).length) {
    const mcpFile = path.join(cwd, ".cursor", "mcp.json");
    let existing: CursorMcpServers = {};
    try {
      const parsed = JSON.parse(await readFile(mcpFile, "utf8")) as { mcpServers?: CursorMcpServers };
      existing = parseMcpServers(parsed.mcpServers);
    } catch {
      existing = {};
    }
    const merged = { ...existing, ...extraMcp };
    await writeFile(mcpFile, `${JSON.stringify({ mcpServers: merged }, null, 2)}\n`, "utf8");
  }
}

export async function prepareCursorWorkspace(ctx: RunContext): Promise<string> {
  const override =
    typeof ctx.definition.providerOptions.cursorCwd === "string"
      ? ctx.definition.providerOptions.cursorCwd.trim()
      : "";
  const cwd = override || (await ensureWorkspace(ctx.user.id, ctx.definition.slug, ctx.definition.kind));
  await seedCursorProject(cwd, ctx.definition);
  return cwd;
}

export async function loadCursorAgentId(userId: number, slug: string): Promise<string | null> {
  try {
    const raw = (await readFile(path.join(cursorStoreRoot(userId, slug), "agent-id.txt"), "utf8")).trim();
    return raw || null;
  } catch {
    return null;
  }
}

export async function saveCursorAgentId(userId: number, slug: string, agentId: string): Promise<void> {
  const dir = cursorStoreRoot(userId, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "agent-id.txt"), `${agentId}\n`, "utf8");
}

export function townBridgeTools(ctx: RunContext): Record<string, {
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}> {
  const tools: Record<string, {
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (args: Record<string, unknown>) => Promise<string>;
  }> = {};

  for (const spec of BRIDGE_TOOLS) {
    const schema = z.toJSONSchema(spec.parameters, { io: "input" }) as Record<string, unknown>;
    const { $schema: _schema, ...parameters } = schema;
    tools[spec.id] = {
      description: spec.description,
      inputSchema: parameters,
      async execute(args) {
        const startedAt = Date.now();
        await persistToolEvent(ctx, {
          type: "tool/call",
          callId: `cursor_${spec.id}_${startedAt}`,
          step: ctx.trace.length + 1,
          payload: { name: spec.id, arguments: args },
        });
        const outcome = await spec.execute(args, ctx);
        if (spec.realAction) ctx.realActions.push(spec.id);
        const ms = Date.now() - startedAt;
        const payload = resultPayload(
          { callId: `cursor_${spec.id}`, name: spec.id, args },
          outcome,
          { allowed: true, ms },
        );
        await persistToolEvent(ctx, {
          type: "tool/result",
          callId: `cursor_${spec.id}_${startedAt}`,
          step: ctx.trace.length + 1,
          payload,
        });
        ctx.trace.push({
          step: ctx.trace.length + 1,
          tool: spec.id,
          allowed: true,
          ms,
          callId: `cursor_${spec.id}_${startedAt}`,
          args,
          result: payload.result,
        });
        return typeof outcome.data === "string" ? outcome.data : JSON.stringify(outcome.data ?? null);
      },
    };
  }
  return tools;
}
