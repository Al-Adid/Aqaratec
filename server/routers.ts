import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { autoPrototypeWorkspaceStore, prototypeRouter } from "./modules/prototype";
import { advisorRouter } from "./modules/advisor";
import { accountsRouter, getAccountStore, superAdminRouter, toPublicAccount } from "./modules/accounts";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  prototype: prototypeRouter,
  advisor: advisorRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    register: accountsRouter.register,
    login: accountsRouter.login,
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Platform-wide oversight. Every procedure here is `adminProcedure`
  // (role === "admin"), enforced server-side — hiding the /super-admin route
  // client-side is a UX nicety on top of this, never the security boundary.
  superAdmin: router({
    listAccounts: superAdminRouter.listAccounts,
    setAccountActive: superAdminRouter.setAccountActive,
    overview: adminProcedure.query(async () => {
      const store = await getAccountStore();
      const accounts = await store.listAll();
      const accountsWithWorkspaces = await Promise.all(
        accounts.map(async account => {
          const workspace = await autoPrototypeWorkspaceStore.load(account.id);
          const recordCount = workspace
            ? Object.values(workspace.snapshot.entities).reduce(
                (total, rows) => total + rows.length,
                0
              )
            : 0;
          return {
            account: toPublicAccount(account),
            workspace: workspace
              ? { revision: workspace.revision, updatedAt: workspace.updatedAt, recordCount }
              : null,
          };
        })
      );

      return {
        totals: {
          accounts: accounts.length,
          activeAccounts: accounts.filter(account => account.isActive).length,
          suspendedAccounts: accounts.filter(account => !account.isActive).length,
          owners: accounts.filter(account => account.role === "user").length,
          admins: accounts.filter(account => account.role === "admin").length,
          savedWorkspaces: accountsWithWorkspaces.filter(entry => entry.workspace).length,
        },
        accounts: accountsWithWorkspaces,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
