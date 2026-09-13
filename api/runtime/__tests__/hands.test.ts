import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HANDS_TOOLS } from "../tools/hands";
import { toolsFor } from "../app";
import { makeContext, makeDefinition, scriptedProvider } from "./helpers";
import { WORKSPACE_LIMITS } from "../workspace";

const byId = Object.fromEntries(HANDS_TOOLS.map((t) => [t.id, t]));

function codeCtx() {
  return makeContext(scriptedProvider([[]]), {
    definition: makeDefinition({ kind: "code", slug: "code", name: "符文匠" }),
  });
}

describe("hands tools", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `town-hands-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.WORKSPACE_ROOT = root;
  });

  afterEach(async () => {
    delete process.env.WORKSPACE_ROOT;
    await rm(root, { recursive: true, force: true });
  });

  it("reads and writes relative to the visitor workspace", async () => {
    const ctx = codeCtx();
    const written = await byId.file_write.execute({ path: "src/hello.txt", content: "alpha\nbeta\n" }, ctx);
    expect(written.data).toMatchObject({ written: true, path: "src/hello.txt" });

    const read = await byId.file_read.execute({ path: "src/hello.txt" }, ctx);
    expect(read.data).toMatchObject({ kind: "file", totalLines: 3 });
    expect(String((read.data as { content: string }).content)).toContain("alpha");
  });

  it("fails a patch when the old text is not unique", async () => {
    const ctx = codeCtx();
    await byId.file_write.execute({ path: "src/dup.txt", content: "foo\nfoo\n" }, ctx);
    const outcome = await byId.file_patch.execute(
      { path: "src/dup.txt", old_content: "foo", new_content: "bar" },
      ctx,
    );
    expect(outcome.data).toMatchObject({ error: "patch_not_unique" });
  });

  it("patches when the old text appears once", async () => {
    const ctx = codeCtx();
    await byId.file_write.execute({ path: "src/once.txt", content: "hello town\n" }, ctx);
    const outcome = await byId.file_patch.execute(
      { path: "src/once.txt", old_content: "town", new_content: "workshop" },
      ctx,
    );
    expect(outcome.data).toMatchObject({ patched: true });
    const read = await byId.file_read.execute({ path: "src/once.txt" }, ctx);
    expect(String((read.data as { content: string }).content)).toContain("workshop");
  });

  it("times out a hanging script and truncates a flood of stdout", async () => {
    const ctx = codeCtx();
    const hung = await byId.code_run.execute(
      { type: "powershell", timeout: 1, script: "Start-Sleep -Seconds 20" },
      ctx,
    );
    expect(hung.data).toMatchObject({ timedOut: true });

    const flood = await byId.code_run.execute(
      { type: "powershell", timeout: 10, script: "Write-Output ('x' * 20000)" },
      ctx,
    );
    const stdout = String((flood.data as { stdout: string }).stdout);
    expect(stdout.length).toBeLessThanOrEqual(WORKSPACE_LIMITS.codeRunOutChars + 40);
    expect(stdout).toContain("[truncated");
  });

  it("refuses hands when the resident is not town-native code or study", async () => {
    const diet = makeContext(scriptedProvider([[]]), {
      definition: makeDefinition({ kind: "diet", slug: "diet" }),
    });
    const outcome = await byId.file_read.execute({ path: "README.md" }, diet);
    expect(outcome.data).toMatchObject({ error: "hands_not_allowed" });
  });
});

describe("toolsFor hands injection", () => {
  it("gives only town-native code and study the computer tools", () => {
    const ids = (def: ReturnType<typeof makeDefinition>) => toolsFor(def).map((t) => t.id);
    expect(ids(makeDefinition({ kind: "code", slug: "code", toolIds: ["save_snippet"] }))).toEqual(
      expect.arrayContaining(["file_read", "file_write", "file_patch", "code_run"]),
    );
    expect(ids(makeDefinition({ kind: "study", slug: "study", toolIds: ["search_library"] }))).toEqual(
      expect.arrayContaining(["file_read", "code_run"]),
    );
    expect(ids(makeDefinition({ kind: "diet", slug: "diet", toolIds: ["log_meal"] }))).not.toEqual(
      expect.arrayContaining(["file_read"]),
    );
    expect(
      ids(makeDefinition({ kind: "code", slug: "visitor-code", toolIds: ["save_snippet"], isTownNative: false })),
    ).not.toEqual(expect.arrayContaining(["file_read"]));
  });
});
