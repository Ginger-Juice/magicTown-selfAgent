import { rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureWorkspace,
  isInside,
  mayUseHands,
  resolveInside,
  workspaceRoot,
} from "../workspace";

describe("workspace jail", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `town-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.WORKSPACE_ROOT = root;
  });

  afterEach(async () => {
    delete process.env.WORKSPACE_ROOT;
    await rm(root, { recursive: true, force: true });
  });

  it("seeds the rune bench once", async () => {
    const bench = await ensureWorkspace(7, "code", "code");
    expect(bench).toBe(workspaceRoot(7, "code"));
    const again = await ensureWorkspace(7, "code", "code");
    expect(again).toBe(bench);
    const inside = await resolveInside(bench, "src");
    expect(inside.ok).toBe(true);
  });

  it("rejects parent and drive-letter paths", async () => {
    const bench = await ensureWorkspace(7, "study", "study");
    expect((await resolveInside(bench, "../code/README.md")).ok).toBe(false);
    expect((await resolveInside(bench, "C:/Windows/System32")).ok).toBe(false);
    expect(isInside(bench, path.join(bench, "..", "other"))).toBe(false);
  });

  it("rejects a symlink that walks out", async () => {
    const bench = await ensureWorkspace(7, "code", "code");
    const outside = path.join(root, "secret.txt");
    await writeFile(outside, "nope", "utf8");
    const link = path.join(bench, "leak");
    try {
      await symlink(outside, link);
    } catch {
      return; // Windows without privilege
    }
    const resolved = await resolveInside(bench, "leak");
    expect(resolved.ok).toBe(false);
  });

  it("only town-native code and study may use hands", () => {
    expect(mayUseHands({ isTownNative: true, kind: "code" })).toBe(true);
    expect(mayUseHands({ isTownNative: true, kind: "study" })).toBe(true);
    expect(mayUseHands({ isTownNative: true, kind: "diet" })).toBe(false);
    expect(mayUseHands({ isTownNative: false, kind: "code" })).toBe(false);
  });
});
