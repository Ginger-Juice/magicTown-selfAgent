import { createRouter, publicQuery } from "./middleware";
import { townRouter } from "./town";
import { adminRouter } from "./admin";
import { authRouter } from "./auth";
import { agentRouter } from "./agents";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  town: townRouter,
  admin: adminRouter,
  auth: authRouter,
  agent: agentRouter,
});

export type AppRouter = typeof appRouter;
