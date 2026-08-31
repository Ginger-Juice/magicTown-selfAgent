import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { loadUserFromRequest, type PublicUser } from "./lib/session";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user: PublicUser | null;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  let user: PublicUser | null = null;
  try {
    user = await loadUserFromRequest(opts.req);
  } catch {
    user = null;
  }
  return { req: opts.req, resHeaders: opts.resHeaders, user };
}
