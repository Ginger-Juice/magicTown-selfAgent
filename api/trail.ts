import { z } from "zod";
import { createRouter, authedProcedure } from "./middleware";
import { mine, record } from "./runtime/trail";

export const trailRouter = createRouter({
  /** Visitors only log a landmark open from the client. Everything else is server-side. */
  record: authedProcedure
    .input(
      z.object({
        kind: z.literal("open_landmark"),
        landmarkId: z.string().trim().min(1).max(64),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return record({
        userId: ctx.user.id,
        kind: "open_landmark",
        landmarkId: input.landmarkId,
      });
    }),

  mine: authedProcedure.query(async ({ ctx }) => {
    return mine(ctx.user.id);
  }),
});
