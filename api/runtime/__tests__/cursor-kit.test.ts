import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseMcpServers,
  parseSkillSeeds,
  readCursorApiKey,
  seedCursorProject,
} from "../providers/cursor-kit";
import { makeDefinition } from "./helpers";

describe("cursor kit", () => {
  let root: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), `cursor-kit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("parses mcp servers and skill seeds", () => {
    expect(parseMcpServers({ docs: { type: "http", url: "https://example.com/mcp" } })).toEqual({
      docs: { type: "http", url: "https://example.com/mcp" },
    });
    expect(parseMcpServers("nope")).toEqual({});
    expect(parseSkillSeeds([{ name: "review", body: "看 diff" }])).toEqual([{ name: "review", body: "看 diff" }]);
  });

  it("seeds project files once and keeps visitor edits", async () => {
    const definition = makeDefinition({
      kind: "code",
      slug: "code",
      providerOptions: { mcpServers: { docs: { type: "http", url: "https://example.com/mcp" } } },
    });
    await seedCursorProject(root, definition);
    await seedCursorProject(root, definition);
    const hooks = await readFile(path.join(root, ".cursor", "hooks.json"), "utf8");
    expect(hooks).toContain("before-shell.mjs");
    const skill = await readFile(path.join(root, ".cursor", "skills", "workshop", "SKILL.md"), "utf8");
    expect(skill).toContain("save_snippet");
    const mcp = JSON.parse(await readFile(path.join(root, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(mcp.mcpServers.docs).toMatchObject({ url: "https://example.com/mcp" });
  });

  it("reads a town-native key from the row or CURSOR_API_KEY", () => {
    const rune = makeDefinition({ kind: "code", slug: "code", isTownNative: true });
    const prev = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
    expect(readCursorApiKey(rune)).toBeNull();
    expect(readCursorApiKey({ ...rune, providerOptions: { cursorApiKey: "cursor_row" } })).toBe("cursor_row");
    process.env.CURSOR_API_KEY = "cursor_env";
    expect(readCursorApiKey(rune)).toBe("cursor_env");
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  });
});
