import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { hashPassword, verifyPassword } from "./lib/password";
import {
  clearSessionCookieHeader,
  createAuthSession,
  destroyAuthSession,
  sessionCookieHeader,
  toPublicUser,
} from "./lib/session";

const email = z.string().trim().email().max(190);
const password = z.string().min(8).max(120);
const displayName = z.string().trim().min(1).max(60);

export const authRouter = createRouter({
  me: publicQuery.query(({ ctx }) => ctx.user),

  register: publicQuery
    .input(
      z.object({
        email,
        password,
        displayName,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const existing = await db.query.users.findFirst({
        where: eq(users.email, input.email.toLowerCase()),
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "email_taken",
        });
      }
      const [{ id }] = await db
        .insert(users)
        .values({
          email: input.email.toLowerCase(),
          passwordHash: await hashPassword(input.password),
          displayName: input.displayName,
        })
        .$returningId();
      const user = await db.query.users.findFirst({ where: eq(users.id, id) });
      if (!user) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }
      const token = await createAuthSession(user.id);
      ctx.resHeaders.append("Set-Cookie", sessionCookieHeader(token));
      return toPublicUser(user);
    }),

  login: publicQuery
    .input(z.object({ email, password }))
    .mutation(async ({ input, ctx }) => {
      const user = await getDb().query.users.findFirst({
        where: eq(users.email, input.email.toLowerCase()),
      });
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "invalid_credentials",
        });
      }
      const token = await createAuthSession(user.id);
      ctx.resHeaders.append("Set-Cookie", sessionCookieHeader(token));
      return toPublicUser(user);
    }),

  logout: publicQuery.mutation(async ({ ctx }) => {
    await destroyAuthSession(ctx.req);
    ctx.resHeaders.append("Set-Cookie", clearSessionCookieHeader());
    return { ok: true };
  }),
});
