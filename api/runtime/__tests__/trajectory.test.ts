import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createHookBus } from "../hooks/bus";
import { defaultGuards } from "../hooks/guards";
import { runLoop } from "../loop";
import { defineTool } from "../tools/registry";
import { HANDS_TOOLS } from "../tools/hands";
import { RuntimeError } from "../errors";
import {
  makeContext,
  makeDefinition,
  passthroughHooks,
  scriptedProvider,
  text,
  toolCall,
} from "./helpers";
import type { ToolSpec } from "../types";

describe("tool trajectory", () => {
  it("denies diet file_read and still writes call + result + a tool_trace note", async () => {
    const log: { type: string; callId: string }[] = [];
    const ctx = makeContext(
      scriptedProvider([[toolCall("file_read", { path: "README.md" })], [text("我没有这双手。")]]),
      {
        definition: makeDefinition({ kind: "diet", slug: "diet" }),
        async recordToolEvent(event) {
          log.push({ type: event.type, callId: event.callId });
        },
      },
    );

    const result = await runLoop({
      ctx,
      hooks: createHookBus(defaultGuards()),
      tools: HANDS_TOOLS,
      system: "s",
      messages: [],
    });

    expect(result.finalText).toBe("我没有这双手。");
    expect(log.map((e) => e.type)).toEqual(["tool/call", "tool/result"]);
    expect(ctx.trace[0]).toMatchObject({ tool: "file_read", allowed: false, reason: "hands_not_allowed" });
    expect(ctx.notes.some((n) => n.kind === "tool_trace")).toBe(true);
    expect(String(ctx.notes.find((n) => n.kind === "tool_trace")?.body)).toContain("拒 file_read");
  });

  it("keeps the tool/call row when execute hangs and the turn aborts", async () => {
    const log: { type: string }[] = [];
    const hang: ToolSpec = defineTool({
      id: "hang_forever",
      description: "never returns",
      parameters: z.object({}),
      async execute() {
        return new Promise(() => {});
      },
    });

    const ac = new AbortController();
    const ctx = makeContext(scriptedProvider([[toolCall("hang_forever")]]), {
      signal: ac.signal,
      async recordToolEvent(event) {
        log.push({ type: event.type });
        if (event.type === "tool/call") queueMicrotask(() => ac.abort());
      },
    });

    await expect(
      runLoop({
        ctx,
        hooks: passthroughHooks,
        tools: [hang],
        system: "s",
        messages: [],
      }),
    ).rejects.toBeInstanceOf(RuntimeError);

    expect(log.map((e) => e.type)).toEqual(["tool/call", "tool/result"]);
    expect(ctx.trace[0]).toMatchObject({ tool: "hang_forever", reason: "aborted" });
  });
});
