import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import {
  createAccountsRouter,
  createSuperAdminRouter,
  hardcodedAccountStore,
  hashPassword,
  verifyPassword,
} from "./accounts";

// Session signing needs a secret; tests never touch the real SESSION_JWT_SECRET.
beforeEach(() => vi.stubEnv("SESSION_JWT_SECRET", "test-only-session-secret"));
afterEach(() => vi.unstubAllEnvs());

// These specs exercise the real router logic against the in-memory test
// fixture store (see accounts.ts), never live Firestore — same pattern as
// prototype.spec.ts passing an explicit store to createPrototypeRouter.
const accountsRouter = createAccountsRouter(hardcodedAccountStore);
const superAdminRouter = createSuperAdminRouter(hardcodedAccountStore);

function cookieContext(): { ctx: TrpcContext; cookies: Array<{ name: string; value: string }> } {
  const cookies: Array<{ name: string; value: string }> = [];
  const ctx = {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string) => {
        cookies.push({ name, value });
      },
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  } as TrpcContext;
  return { ctx, cookies };
}

function adminContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: "local:seed-super-admin",
      name: "مدير المنصة",
      email: "admin@sunnaa.local",
      loginMethod: "password",
      role: "admin",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("password hashing", () => {
  it("round-trips a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("Correct-Horse-1");
    expect(hash).not.toBe("Correct-Horse-1");
    await expect(verifyPassword("Correct-Horse-1", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});

describe("accounts.register / accounts.login", () => {
  it("registers a new owner account, signs it in, and rejects a duplicate email", async () => {
    const { ctx, cookies } = cookieContext();
    const caller = accountsRouter.createCaller(ctx);
    const email = `owner-${crypto.randomUUID()}@example.com`;

    const account = await caller.register({
      name: "Test Owner",
      email,
      password: "StrongPass1",
    });

    expect(account.role).toBe("user");
    expect(account.email).toBe(email);
    expect(cookies).toHaveLength(1);

    await expect(
      caller.register({ name: "Second", email, password: "AnotherPass1" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("logs in with the right password and rejects the wrong one, without leaking which part failed", async () => {
    const { ctx: registerCtx } = cookieContext();
    const registerCaller = accountsRouter.createCaller(registerCtx);
    const email = `owner-${crypto.randomUUID()}@example.com`;
    await registerCaller.register({ name: "Login Test", email, password: "RightPass1" });

    const { ctx: loginCtx, cookies } = cookieContext();
    const loginCaller = accountsRouter.createCaller(loginCtx);

    const account = await loginCaller.login({ email, password: "RightPass1" });
    expect(account.email).toBe(email);
    expect(cookies).toHaveLength(1);

    await expect(
      loginCaller.login({ email, password: "WrongPass1" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      loginCaller.login({ email: "nobody@example.com", password: "WrongPass1" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses to sign in a suspended account", async () => {
    const { ctx: registerCtx } = cookieContext();
    const email = `owner-${crypto.randomUUID()}@example.com`;
    const created = await accountsRouter
      .createCaller(registerCtx)
      .register({ name: "Suspend Me", email, password: "SomePass1" });

    await hardcodedAccountStore.setActive(created.id, false);

    const { ctx: loginCtx } = cookieContext();
    await expect(
      accountsRouter.createCaller(loginCtx).login({ email, password: "SomePass1" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("superAdmin router", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists every account for an admin caller", async () => {
    const { ctx } = cookieContext();
    const email = `owner-${crypto.randomUUID()}@example.com`;
    await accountsRouter.createCaller(ctx).register({
      name: "Visible Owner",
      email,
      password: "VisiblePass1",
    });

    // The seed super admin is registered lazily on first store access.
    await hardcodedAccountStore.findByEmail("admin@sunnaa.local");

    const admin = await hardcodedAccountStore.findByEmail("admin@sunnaa.local");
    expect(admin).toBeDefined();

    const accounts = await superAdminRouter
      .createCaller(adminContext(admin!.id))
      .listAccounts();

    expect(accounts.some(account => account.email === email)).toBe(true);
    expect(accounts.every(account => !("passwordHash" in account))).toBe(true);
  });

  it("refuses a non-admin caller", async () => {
    const ownerCtx: TrpcContext = {
      user: {
        id: 999,
        openId: "local:not-admin",
        name: "Owner",
        email: "owner@example.com",
        loginMethod: "password",
        role: "user",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };

    await expect(
      superAdminRouter.createCaller(ownerCtx).listAccounts()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses to let an admin suspend their own account", async () => {
    const admin = await hardcodedAccountStore.findByEmail("admin@sunnaa.local");
    expect(admin).toBeDefined();

    await expect(
      superAdminRouter
        .createCaller(adminContext(admin!.id))
        .setAccountActive({ accountId: admin!.id, isActive: false })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
