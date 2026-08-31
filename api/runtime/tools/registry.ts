import { z } from "zod";
import type { RunContext, StepOutcome, ToolSpec } from "../types";
import type { JsonSchemaTool } from "../providers/types";

export type ToolDefinition<S extends z.ZodType> = {
  id: string;
  description: string;
  parameters: S;
  realAction?: boolean;
  execute(args: z.infer<S>, ctx: RunContext): Promise<StepOutcome>;
};

/**
 * Wraps a typed handler into the erased `ToolSpec` the loop stores. Validation
 * happens here so a malformed argument blob becomes a result the model can read
 * and correct, rather than an exception that kills the turn.
 */
export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): ToolSpec {
  return {
    id: def.id,
    description: def.description,
    parameters: def.parameters,
    realAction: def.realAction,
    async execute(raw: unknown, ctx: RunContext): Promise<StepOutcome> {
      const parsed = def.parameters.safeParse(raw);
      if (!parsed.success) {
        return {
          data: {
            error: "invalid_arguments",
            detail: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
          },
        };
      }
      return def.execute(parsed.data as z.infer<S>, ctx);
    },
  };
}

export class ToolRegistry {
  private readonly specs = new Map<string, ToolSpec>();

  register(...specs: ToolSpec[]): this {
    for (const spec of specs) this.specs.set(spec.id, spec);
    return this;
  }

  get(id: string): ToolSpec | undefined {
    return this.specs.get(id);
  }

  /** Business tools come from the definition; framework tools are always appended. */
  resolve(ids: string[], always: string[] = []): ToolSpec[] {
    const wanted = [...new Set([...ids, ...always])];
    return wanted.map((id) => this.specs.get(id)).filter((s): s is ToolSpec => Boolean(s));
  }
}

function stripSchemaKeys(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _schema, ...rest } = schema;
  return rest;
}

export function toJsonSchemaTools(specs: ToolSpec[]): JsonSchemaTool[] {
  return specs.map((spec) => ({
    name: spec.id,
    description: spec.description,
    parameters: stripSchemaKeys(
      z.toJSONSchema(spec.parameters, { io: "input" }) as Record<string, unknown>,
    ),
  }));
}
