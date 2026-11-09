import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  type DemoEntity,
  type MetaValue,
  type PrototypeState,
} from "@shared/prototype";
import { prototypeStateSchema } from "@shared/prototype-validation";
import { getFirestore } from "../firebase";
import { protectedProcedure, router } from "../_core/trpc";

const WORKSPACES_COLLECTION = "prototypeWorkspaces";

export {
  auditEventSchema,
  demoEntitySchema,
  entityMapSchema,
  prototypeStateSchema,
} from "@shared/prototype-validation";
export type { ValidatedPrototypeState } from "@shared/prototype-validation";

const MAX_REVISION = 2_147_483_646;
export type StoredPrototypeWorkspace = {
  snapshot: PrototypeState;
  revision: number;
  updatedAt: Date;
};

/**
 * Narrow storage seam: it keeps the production router protected while allowing
 * deterministic tests to exercise the real tRPC authentication middleware.
 */
export interface PrototypeWorkspaceStore {
  load(userId: number): Promise<StoredPrototypeWorkspace | undefined>;
  create(userId: number, snapshot: PrototypeState): Promise<boolean>;
  compareAndSwap(
    userId: number,
    expectedRevision: number,
    snapshot: PrototypeState
  ): Promise<boolean>;
}

function revisionConflict(): TRPCError {
  return new TRPCError({
    code: "CONFLICT",
    message: "The prototype workspace has changed. Reload before saving again.",
  });
}

/**
 * In-memory implementation. Test-only fixture (see prototype.spec.ts,
 * prototype-load-identity.spec.ts) — never used by the running app, which
 * always talks to Firestore via `firestorePrototypeWorkspaceStore` below.
 */
const memoryWorkspaces = new Map<number, StoredPrototypeWorkspace>();

export const inMemoryPrototypeWorkspaceStore: PrototypeWorkspaceStore = {
  async load(userId) {
    return memoryWorkspaces.get(userId);
  },
  async create(userId, snapshot) {
    if (memoryWorkspaces.has(userId)) return false;
    memoryWorkspaces.set(userId, { snapshot, revision: 1, updatedAt: new Date() });
    return true;
  },
  async compareAndSwap(userId, expectedRevision, snapshot) {
    const current = memoryWorkspaces.get(userId);
    if (!current || current.revision !== expectedRevision) return false;
    memoryWorkspaces.set(userId, {
      snapshot,
      revision: current.revision + 1,
      updatedAt: new Date(),
    });
    return true;
  },
};

function workspaceDoc(userId: number) {
  return getFirestore().collection(WORKSPACES_COLLECTION).doc(String(userId));
}

/** The real, persistent workspace store — properties, units, leases, everything. */
export const firestorePrototypeWorkspaceStore: PrototypeWorkspaceStore = {
  async load(userId) {
    const doc = await workspaceDoc(userId).get();
    if (!doc.exists) return undefined;
    const data = doc.data()!;
    return {
      snapshot: data.snapshot as PrototypeState,
      revision: data.revision as number,
      updatedAt:
        data.updatedAt instanceof Date
          ? data.updatedAt
          : (data.updatedAt as FirebaseFirestore.Timestamp).toDate(),
    };
  },
  async create(userId, snapshot) {
    return getFirestore().runTransaction(async tx => {
      const ref = workspaceDoc(userId);
      const existing = await tx.get(ref);
      if (existing.exists) return false;
      tx.set(ref, { snapshot, revision: 1, updatedAt: new Date() });
      return true;
    });
  },
  async compareAndSwap(userId, expectedRevision, snapshot) {
    return getFirestore().runTransaction(async tx => {
      const ref = workspaceDoc(userId);
      const existing = await tx.get(ref);
      if (!existing.exists) return false;
      if ((existing.data()!.revision as number) !== expectedRevision) return false;
      tx.update(ref, { snapshot, revision: expectedRevision + 1, updatedAt: new Date() });
      return true;
    });
  },
};

/** Kept as the public name the rest of the app imports (routers.ts, this file's default). */
export const autoPrototypeWorkspaceStore = firestorePrototypeWorkspaceStore;

const saveInputSchema = z
  .object({
    snapshot: prototypeStateSchema,
    expectedRevision: z.number().int().min(0).max(MAX_REVISION),
    // A stale browser component must not be able to submit under a newly
    // switched session cookie. This adds no entitlement: ctx.user still scopes
    // every database row and remains the source of truth.
    clientUserId: z.number().int().positive(),
  })
  .strict();

export function createPrototypeRouter(
  store: PrototypeWorkspaceStore = firestorePrototypeWorkspaceStore
) {
  return router({
    load: protectedProcedure
      .input(
        z
          .object({ clientUserId: z.number().int().positive() })
          .strict()
          .optional()
      )
      .query(async ({ ctx, input }) => {
        ctx.res.setHeader("Cache-Control", "private, no-store");
        if (input && input.clientUserId !== ctx.user.id)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "The active account changed before this workspace load.",
          });
        const workspace = await store.load(ctx.user.id);
        if (!workspace) {
          return { snapshot: null, revision: 0 };
        }

        return {
          snapshot: workspace.snapshot,
          revision: workspace.revision,
          updatedAt: workspace.updatedAt,
        };
      }),

    save: protectedProcedure
      .input(saveInputSchema)
      .mutation(async ({ ctx, input }) => {
        ctx.res.setHeader("Cache-Control", "private, no-store");
        if (input.clientUserId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "The active account changed before this workspace save.",
          });
        }
        const snapshot = input.snapshot as PrototypeState;
        if (input.expectedRevision === 0) {
          if (!(await store.create(ctx.user.id, snapshot))) {
            throw revisionConflict();
          }
          return { revision: 1 };
        }

        if (
          !(await store.compareAndSwap(
            ctx.user.id,
            input.expectedRevision,
            snapshot
          ))
        ) {
          throw revisionConflict();
        }

        return { revision: input.expectedRevision + 1 };
      }),
  });
}

export const prototypeRouter = createPrototypeRouter(autoPrototypeWorkspaceStore);
export type PrototypeRouter = typeof prototypeRouter;
export type { DemoEntity, MetaValue };
