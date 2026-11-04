import { describe, expect, it, vi } from "vitest";
import { ENTITY_KINDS, type PrototypeState } from "@shared/prototype";
import type { TrpcContext } from "../_core/context";
import { createDemoState } from "../../client/src/lib/demo-data";
import { normalizePrototype } from "../../client/src/lib/prototype-normalize";
import {
  createPrototypeRouter,
  prototypeStateSchema,
  type PrototypeWorkspaceStore,
  type StoredPrototypeWorkspace,
} from "./prototype";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function state(title = "حالة تجريبية"): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(kind => [kind, []])
  ) as unknown as PrototypeState["entities"];
  entities.portfolios.push({
    id: "portfolio-1",
    title,
    subtitle: "بيانات محلية اختيارية",
    portfolioId: "portfolio-1",
    propertyId: "",
    status: "نشط",
    date: "2026-10-24",
    amountMinor: 100,
    currency: "QAR",
    meta: { active: true, units: 1 },
  });

  return {
    version: 1,
    entities,
    audit: [],
    settings: {
      role: "operator",
      portfolioId: "",
      period: "all",
      language: "ar",
    },
  };
}

function memoryStore(): PrototypeWorkspaceStore {
  const workspaces = new Map<number, StoredPrototypeWorkspace>();

  return {
    async load(userId) {
      return workspaces.get(userId);
    },
    async create(userId, snapshot) {
      if (workspaces.has(userId)) return false;
      workspaces.set(userId, { snapshot, revision: 1, updatedAt: new Date() });
      return true;
    },
    async compareAndSwap(userId, expectedRevision, snapshot) {
      const workspace = workspaces.get(userId);
      if (!workspace || workspace.revision !== expectedRevision) return false;
      workspaces.set(userId, {
        snapshot,
        revision: expectedRevision + 1,
        updatedAt: new Date(),
      });
      return true;
    },
  };
}

function context(userId: number | null): TrpcContext {
  const user: AuthenticatedUser | null =
    userId === null
      ? null
      : {
          id: userId,
          openId: `user-${userId}`,
          name: null,
          email: null,
          loginMethod: "manus",
          role: "user",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
        };

  return {
    user,
    req: {} as TrpcContext["req"],
    res: { setHeader: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function caller(store: PrototypeWorkspaceStore, userId: number | null) {
  return createPrototypeRouter(store).createCaller(context(userId));
}

describe("prototype router", () => {
  it("accepts the complete fictional state for private storage", () => {
    expect(
      prototypeStateSchema.safeParse(normalizePrototype(createDemoState()))
        .success
    ).toBe(true);
  });
  it("accepts a valid custom month from the dashboard and rejects invalid months", () => {
    const snapshot = state();
    snapshot.settings.period = "2027-02";
    expect(prototypeStateSchema.safeParse(snapshot).success).toBe(true);
    snapshot.settings.period = "2027-13";
    expect(prototypeStateSchema.safeParse(snapshot).success).toBe(false);
  });
  it("requires the real protectedProcedure middleware", async () => {
    const anonymous = caller(memoryStore(), null);
    await expect(anonymous.load()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anonymous.save({ snapshot: state(), expectedRevision: 0, clientUserId: 1 })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("keeps workspaces private to the authenticated user", async () => {
    const store = memoryStore();
    const firstUser = caller(store, 11);
    const secondUser = caller(store, 22);

    await expect(
      firstUser.save({
        snapshot: state("مساحة المستخدم الأول"),
        expectedRevision: 0,
        clientUserId: 11,
      })
    ).resolves.toEqual({ revision: 1 });
    await expect(secondUser.load()).resolves.toEqual({
      snapshot: null,
      revision: 0,
    });
    await expect(
      secondUser.save({
        snapshot: state("مساحة المستخدم الثاني"),
        expectedRevision: 0,
        clientUserId: 22,
      })
    ).resolves.toEqual({ revision: 1 });

    await expect(firstUser.load()).resolves.toMatchObject({
      revision: 1,
      snapshot: {
        entities: { portfolios: [{ title: "مساحة المستخدم الأول" }] },
      },
    });
    await expect(secondUser.load()).resolves.toMatchObject({
      revision: 1,
      snapshot: {
        entities: { portfolios: [{ title: "مساحة المستخدم الثاني" }] },
      },
    });
  });

  it("accepts only the expected revision and rejects stale saves", async () => {
    const store = memoryStore();
    const user = caller(store, 42);

    await expect(
      user.save({
        snapshot: state("الإصدار الأول"),
        expectedRevision: 0,
        clientUserId: 42,
      })
    ).resolves.toEqual({ revision: 1 });
    await expect(
      user.save({
        snapshot: state("الإصدار الثاني"),
        expectedRevision: 1,
        clientUserId: 42,
      })
    ).resolves.toEqual({ revision: 2 });
    await expect(
      user.save({
        snapshot: state("إصدار قديم"),
        expectedRevision: 1,
        clientUserId: 42,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(user.load()).resolves.toMatchObject({
      revision: 2,
      snapshot: { entities: { portfolios: [{ title: "الإصدار الثاني" }] } },
    });
  });

  it("keeps B on its R1 baseline after a refetch observes A's R2", async () => {
    const store = memoryStore();
    const clientA = caller(store, 77);
    const clientB = caller(store, 77);

    await expect(
      clientA.save({
        snapshot: state("R1"),
        expectedRevision: 0,
        clientUserId: 77,
      })
    ).resolves.toEqual({ revision: 1 });
    // Both devices actually built their local copies on R1.
    await expect(clientA.load()).resolves.toMatchObject({ revision: 1 });
    await expect(clientB.load()).resolves.toMatchObject({ revision: 1 });

    await expect(
      clientA.save({
        snapshot: state("A-R2"),
        expectedRevision: 1,
        clientUserId: 77,
      })
    ).resolves.toEqual({ revision: 2 });
    // B may observe R2, but its expected revision remains the R1 it adopted.
    await expect(clientB.load()).resolves.toMatchObject({ revision: 2 });
    await expect(
      clientB.save({
        snapshot: state("B-stale-from-R1"),
        expectedRevision: 1,
        clientUserId: 77,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(clientA.load()).resolves.toMatchObject({
      revision: 2,
      snapshot: { entities: { portfolios: [{ title: "A-R2" }] } },
    });
  });

  it("rejects a request whose echoed browser identity does not match the session", async () => {
    const user = caller(memoryStore(), 88);
    await expect(
      user.save({
        snapshot: state(),
        expectedRevision: 0,
        clientUserId: 99,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
