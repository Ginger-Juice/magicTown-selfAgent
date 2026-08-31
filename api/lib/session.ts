import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { authSessions, users } from "@db/schema";
import type { User } from "@db/schema";
import { getDb } from "../queries/connection";
import { env } from "./env";

export const SESSION_COOKIE = "st_session";
const SESSION_DAYS = 30;
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function sessionCookieHeader(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE}`,
  ];
  if (env.isProduction) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (env.isProduction) parts.push("Secure");
  return parts.join("; ");
}

export function readSessionToken(req: Request): string | null {
  return parseCookies(req.headers.get("cookie"))[SESSION_COOKIE] ?? null;
}

export type PublicUser = {
  id: number;
  email: string;
  displayName: string;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  };
}

export async function createAuthSession(userId: number): Promise<string> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);
  await getDb().insert(authSessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return token;
}

export async function loadUserFromRequest(req: Request): Promise<PublicUser | null> {
  if (!env.databaseUrl) return null;
  const token = readSessionToken(req);
  if (!token) return null;
  const db = getDb();
  const row = await db.query.authSessions.findFirst({
    where: and(
      eq(authSessions.tokenHash, hashToken(token)),
      gt(authSessions.expiresAt, new Date()),
    ),
  });
  if (!row) return null;
  const user = await db.query.users.findFirst({
    where: eq(users.id, row.userId),
  });
  return user ? toPublicUser(user) : null;
}

export async function destroyAuthSession(req: Request): Promise<void> {
  const token = readSessionToken(req);
  if (!token || !env.databaseUrl) return;
  await getDb()
    .delete(authSessions)
    .where(eq(authSessions.tokenHash, hashToken(token)));
}
