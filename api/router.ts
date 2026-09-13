import { createRouter, publicQuery } from "./middleware";
import { townRouter } from "./town";
import { adminRouter } from "./admin";
import { authRouter } from "./auth";
import { agentRouter } from "./agents";
import { trailRouter } from "./trail";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  town: townRouter,
  admin: adminRouter,
  auth: authRouter,
  agent: agentRouter,
  trail: trailRouter,
});

export type AppRouter = typeof appRouter;
