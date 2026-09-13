import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "./registry";
import { fail, ok } from "./lib";
import {
  WORKSPACE_LIMITS,
  ensureWorkspace,
  measureWorkspace,
  mayUseHands,
  resolveInside,
} from "../workspace";
import type { RunContext, ToolSpec } from "../types";

const pathArg = z.string().min(1).max(400);

async function bench(ctx: RunContext) {
  if (!mayUseHands(ctx.definition)) return { error: "hands_not_allowed" as const, root: null };
  const root = await ensureWorkspace(ctx.user.id, ctx.definition.slug, ctx.definition.kind);
  return { error: null, root };
}

function sanitizeEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    COMSPEC: process.env.COMSPEC,
  };
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[truncated ${text.length - max}]`;
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: sanitizeEnv(),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = clip(stdout + chunk.toString("utf8"), WORKSPACE_LIMITS.codeRunOutChars);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = clip(stderr + chunk.toString("utf8"), WORKSPACE_LIMITS.codeRunOutChars);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

const fileRead = defineTool({
  id: "file_read",
  description: "读工作区里的一个文件或列出一个目录。path 相对工作区根。",
  parameters: z.object({
    path: pathArg,
    start: z.number().int().min(1).optional(),
    count: z.number().int().min(1).max(400).optional(),
  }),
  async execute(args, ctx) {
    const opened = await bench(ctx);
    if (opened.error || !opened.root) return fail(opened.error ?? "hands_not_allowed");
    const resolved = await resolveInside(opened.root, args.path);
    if (!resolved.ok) return fail(resolved.error);

    try {
      const info = await stat(resolved.abs);
      if (info.isDirectory()) {
        const entries = await readdir(resolved.abs, { withFileTypes: true });
        return ok({
          path: resolved.rel.replaceAll("\\", "/"),
          kind: "directory",
          entries: await Promise.all(
            entries.map(async (entry) => {
              const child = path.join(resolved.abs, entry.name);
              const size = entry.isFile() ? (await stat(child)).size : 0;
              return {
                name: entry.name,
                kind: entry.isDirectory() ? "directory" : "file",
                bytes: size,
              };
            }),
          ),
        });
      }
      const raw = await readFile(resolved.abs, "utf8");
      const lines = raw.split(/\r?\n/);
      const start = args.start ?? 1;
      const count = args.count ?? 200;
      const slice = lines.slice(start - 1, start - 1 + count);
      const numbered = slice.map((line, i) => `${String(start + i).padStart(4, " ")}|${line}`).join("\n");
      return ok({
        path: resolved.rel.replaceAll("\\", "/"),
        kind: "file",
        start,
        totalLines: lines.length,
        content: numbered,
      });
    } catch {
      return fail("not_found", { path: args.path });
    }
  },
});

const fileWrite = defineTool({
  id: "file_write",
  description: "在工作区创建或改写一个文件。path 相对工作区根。",
  realAction: true,
  parameters: z.object({
    path: pathArg,
    content: z.string().max(WORKSPACE_LIMITS.maxFileBytes),
    mode: z.enum(["overwrite", "append"]).optional(),
  }),
  async execute(args, ctx) {
    const opened = await bench(ctx);
    if (opened.error || !opened.root) return fail(opened.error ?? "hands_not_allowed");
    const resolved = await resolveInside(opened.root, args.path);
    if (!resolved.ok) return fail(resolved.error);

    const mode = args.mode ?? "overwrite";
    let next = args.content;
    if (mode === "append") {
      try {
        next = (await readFile(resolved.abs, "utf8")) + args.content;
      } catch {
        next = args.content;
      }
    }
    if (Buffer.byteLength(next, "utf8") > WORKSPACE_LIMITS.maxFileBytes) {
      return fail("file_too_large", { maxBytes: WORKSPACE_LIMITS.maxFileBytes });
    }

    const usage = await measureWorkspace(opened.root);
    const extra = Buffer.byteLength(next, "utf8");
    if (usage.files + 1 > WORKSPACE_LIMITS.maxFiles) return fail("workspace_full", { maxFiles: WORKSPACE_LIMITS.maxFiles });
    if (usage.bytes + extra > WORKSPACE_LIMITS.maxBytes) return fail("workspace_full", { maxBytes: WORKSPACE_LIMITS.maxBytes });

    await mkdir(path.dirname(resolved.abs), { recursive: true });
    await writeFile(resolved.abs, next, "utf8");
    return ok({ written: true, path: resolved.rel.replaceAll("\\", "/"), bytes: Buffer.byteLength(next, "utf8") });
  },
});

const filePatch = defineTool({
  id: "file_patch",
  description: "把工作区文件里一段唯一的原文换成新文。不唯一就失败，先 file_read 再改。",
  realAction: true,
  parameters: z.object({
    path: pathArg,
    old_content: z.string().min(1),
    new_content: z.string(),
  }),
  async execute(args, ctx) {
    const opened = await bench(ctx);
    if (opened.error || !opened.root) return fail(opened.error ?? "hands_not_allowed");
    const resolved = await resolveInside(opened.root, args.path);
    if (!resolved.ok) return fail(resolved.error);

    let raw: string;
    try {
      raw = await readFile(resolved.abs, "utf8");
    } catch {
      return fail("not_found", { path: args.path });
    }

    const parts = raw.split(args.old_content);
    if (parts.length === 1) return fail("patch_not_found");
    if (parts.length > 2) return fail("patch_not_unique", { matches: parts.length - 1 });

    const next = parts.join(args.new_content);
    if (Buffer.byteLength(next, "utf8") > WORKSPACE_LIMITS.maxFileBytes) {
      return fail("file_too_large", { maxBytes: WORKSPACE_LIMITS.maxFileBytes });
    }
    await writeFile(resolved.abs, next, "utf8");
    return ok({ patched: true, path: resolved.rel.replaceAll("\\", "/") });
  },
});

const codeRun = defineTool({
  id: "code_run",
  description: "在工作区里跑一段 python 或 powershell。cwd 钉死工作区，产物请写到 out/。",
  realAction: true,
  parameters: z.object({
    script: z.string().min(1).max(20_000),
    type: z.enum(["python", "powershell"]).optional(),
    timeout: z.number().int().min(1).max(60).optional(),
  }),
  async execute(args, ctx) {
    const opened = await bench(ctx);
    if (opened.error || !opened.root) return fail(opened.error ?? "hands_not_allowed");

    const kind = args.type ?? "python";
    const timeoutMs = Math.min((args.timeout ?? 15) * 1000, WORKSPACE_LIMITS.codeRunMs);
    const stamp = `run-${Date.now()}`;
    const rel = kind === "python" ? path.join("out", `${stamp}.py`) : path.join("out", `${stamp}.ps1`);
    const resolved = await resolveInside(opened.root, rel);
    if (!resolved.ok) return fail(resolved.error);
    await mkdir(path.dirname(resolved.abs), { recursive: true });
    await writeFile(resolved.abs, args.script, "utf8");

    try {
      const ran =
        kind === "python"
          ? await runProcess(process.platform === "win32" ? "py" : "python", ["-3", resolved.abs], opened.root, timeoutMs).catch(
              async () => runProcess("python", [resolved.abs], opened.root, timeoutMs),
            )
          : await runProcess(
              "powershell",
              ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", resolved.abs],
              opened.root,
              timeoutMs,
            );

      return ok({
        timedOut: ran.timedOut,
        exitCode: ran.code,
        stdout: ran.stdout,
        stderr: ran.stderr,
        scriptPath: rel.replaceAll("\\", "/"),
      });
    } catch (err) {
      return fail("exec_failed", { message: err instanceof Error ? err.message : String(err) });
    }
  },
});

export const HANDS_TOOLS: ToolSpec[] = [fileRead, fileWrite, filePatch, codeRun];
