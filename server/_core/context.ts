import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { PublicAccount } from "../modules/accounts";
import { resolveSessionUser } from "../modules/accounts";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  /**
   * Deliberately `PublicAccount`, never the raw `users` row: that type has no
   * `passwordHash` field, so a procedure that returns `ctx.user` (e.g.
   * `auth.me`) can never leak a credential hash to the browser by accident.
   */
  user: PublicAccount | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: PublicAccount | null = null;

  try {
    user = await resolveSessionUser(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
