import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import type { AgentKind } from "./types";

export const HANDS_TOOL_IDS = ["file_read", "file_write", "file_patch", "code_run"] as const;
export type HandsToolId = (typeof HANDS_TOOL_IDS)[number];

export const HANDS_KINDS = new Set<AgentKind>(["code", "study"]);

export const WORKSPACE_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxFiles: 200,
  maxFileBytes: 256 * 1024,
  payloadChars: 4_000,
  codeRunMs: 15_000,
  codeRunOutChars: 10_000,
} as const;

type Seed = { dirs: string[]; readme: string };

const SEEDS: Partial<Record<AgentKind, Seed>> = {
  code: {
    dirs: ["src", "out"],
    readme: [
      "符文工坊台面。工具里的 path 一律相对这里，例如 src/hello.py。",
      "改稿写进 src/；code_run 的产物只放 out/。",
      "不要把密钥写进这里。收进抽屉用 save_snippet，不要镜像成文件。",
      "",
    ].join("\n"),
  },
  study: {
    dirs: ["catalog", "plans", "progress", "sources"],
    readme: [
      "禁书塔馆藏草稿。工具里的 path 一律相对这里。",
      "catalog/ 摘录与提纲；plans/ 阅读计划工作稿；progress/ 进度草稿；sources/ 原文。",
      "查访客长期记忆用 search_library。这里的文件不是铁律，不能当 L1。",
      "",
    ].join("\n"),
  },
};

export function isHandsTool(name: string): name is HandsToolId {
  return (HANDS_TOOL_IDS as readonly string[]).includes(name);
}

export function mayUseHands(input: { isTownNative: boolean; kind: AgentKind }): boolean {
  return input.isTownNative && HANDS_KINDS.has(input.kind);
}

export function workspaceBase(): string {
  const override = process.env.WORKSPACE_ROOT?.trim();
  return override ? path.resolve(override) : path.resolve(process.cwd(), ".data", "workspaces");
}

export function workspaceRoot(userId: number, slug: string): string {
  return path.resolve(workspaceBase(), `u${userId}`, slug);
}

export function isInside(root: string, candidate: string): boolean {
  const normRoot = path.resolve(root);
  const normCand = path.resolve(candidate);
  const rel = path.relative(normRoot, normCand);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export type ResolvedPath = { ok: true; abs: string; rel: string } | { ok: false; error: string };

/**
 * Resolves a visitor-supplied path against the workspace. Absolute paths,
 * drive letters, and anything that walks out (including via symlink) fail.
 */
export async function resolveInside(root: string, relPath: string): Promise<ResolvedPath> {
  const trimmed = (relPath || ".").trim() || ".";
  const unified = trimmed.replace(/\\/g, "/");
  if (path.isAbsolute(unified) || /^[a-zA-Z]:/.test(unified)) {
    return { ok: false, error: "path_outside_workspace" };
  }
  if (unified.split("/").some((part) => part === "..")) {
    return { ok: false, error: "path_outside_workspace" };
  }

  const abs = path.resolve(root, unified);
  if (!isInside(root, abs)) return { ok: false, error: "path_outside_workspace" };

  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    rootReal = path.resolve(root);
  }

  try {
    const real = await realpath(abs);
    if (!isInside(rootReal, real)) return { ok: false, error: "path_outside_workspace" };
    return { ok: true, abs: real, rel: path.relative(rootReal, real) || "." };
  } catch {
    // File does not exist yet (writes). Jail the longest existing ancestor.
    let cursor = path.dirname(abs);
    while (isInside(root, cursor)) {
      try {
        const ancestor = await realpath(cursor);
        if (!isInside(rootReal, ancestor)) return { ok: false, error: "path_outside_workspace" };
        const rest = path.relative(cursor, abs);
        const joined = path.resolve(ancestor, rest);
        if (!isInside(rootReal, joined)) return { ok: false, error: "path_outside_workspace" };
        return { ok: true, abs: joined, rel: path.relative(rootReal, joined) || "." };
      } catch {
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
    }
    if (!isInside(rootReal, abs)) return { ok: false, error: "path_outside_workspace" };
    return { ok: true, abs, rel: path.relative(rootReal, abs) || "." };
  }
}

export async function ensureWorkspace(userId: number, slug: string, kind: AgentKind): Promise<string> {
  const root = workspaceRoot(userId, slug);
  await mkdir(root, { recursive: true });
  const seed = SEEDS[kind];
  if (!seed) return root;
  for (const dir of seed.dirs) {
    await mkdir(path.join(root, dir), { recursive: true });
  }
  const readme = path.join(root, "README.md");
  try {
    await readFile(readme);
  } catch {
    await writeFile(readme, seed.readme, "utf8");
  }
  return root;
}

export async function measureWorkspace(root: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  async function walk(dir: string): Promise<void> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) {
        files += 1;
        bytes += (await stat(next)).size;
      }
    }
  }
  await walk(root);
  return { files, bytes };
}

export function truncatePayload(value: unknown, max = WORKSPACE_LIMITS.payloadChars): unknown {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (raw.length <= max) return value;
  const cut = `${raw.slice(0, max)}…[truncated ${raw.length - max}]`;
  return typeof value === "string" ? cut : { truncated: true, preview: cut };
}

export function handsPrompt(kind: AgentKind): string | null {
  if (kind === "code") {
    return [
      "你的手：工作区是一块只属于当前访客的工坊台面。path 一律相对根目录。",
      "顶层：README.md、src/（改稿）、out/（运行产物）。",
      "读文件用 file_read，改文件用 file_write / file_patch，跑脚本用 code_run（cwd 钉在工作区）。",
      "没有成功的工具结果，不要声称已经读过、改过或跑过。无行动，不记忆。",
      "save_snippet 只收抽屉，不写进工作区。",
    ].join("\n");
  }
  if (kind === "study") {
    return [
      "你的手：工作区是当前访客在禁书塔的馆藏草稿。path 一律相对根目录。",
      "顶层：README.md、catalog/、plans/、progress/、sources/。",
      "查访客长期记忆用 search_library；查或改馆里文稿用 file_read / file_write / file_patch。需要演算用 code_run。",
      "没有成功的工具结果，不要声称已经读过或写过。馆藏文件不是铁律。",
    ].join("\n");
  }
  return null;
}
