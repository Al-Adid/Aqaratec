import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type DemoEntity,
  type MetaValue,
  type PrototypeState,
} from "@shared/prototype";
import { prototypeStateSchema } from "@shared/prototype-validation";
import { prototypeWorkspaces } from "../../drizzle/schema";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

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

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

async function requireDatabase() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Prototype storage is unavailable.",
    });
  }
  return db;
}

/** Database-backed implementation. CAS makes revision checks atomic per user row. */
export const databasePrototypeWorkspaceStore: PrototypeWorkspaceStore = {
  async load(userId) {
    const db = await requireDatabase();
    const rows = await db
      .select({
        snapshot: prototypeWorkspaces.snapshot,
        revision: prototypeWorkspaces.revision,
        updatedAt: prototypeWorkspaces.updatedAt,
      })
      .from(prototypeWorkspaces)
      .where(eq(prototypeWorkspaces.userId, userId))
      .limit(1);

    const row = rows[0];
    if (!row) return undefined;

    return {
      snapshot: row.snapshot,
      revision: row.revision,
      updatedAt: row.updatedAt,
    };
  },

  async create(userId, snapshot) {
    const db = await requireDatabase();
    try {
      await db.insert(prototypeWorkspaces).values({
        userId,
        snapshot,
        revision: 1,
      });
      return true;
    } catch (error) {
      // The sole unique constraint is userId. A competing expectedRevision=0
      // creation therefore becomes a normal revision conflict, not an overwrite.
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  },

  async compareAndSwap(userId, expectedRevision, snapshot) {
    const db = await requireDatabase();
    const result = await db
      .update(prototypeWorkspaces)
      .set({
        snapshot,
        revision: sql`${prototypeWorkspaces.revision} + 1`,
      })
      .where(
        and(
          eq(prototypeWorkspaces.userId, userId),
          eq(prototypeWorkspaces.revision, expectedRevision)
        )
      );

    return result[0].affectedRows === 1;
  },
};

/**
 * In-memory implementation, used whenever no DATABASE_URL is configured so a
 * real (non-guest) account still has a working cloud workspace before a
 * database is wired up. Data lives only for the life of this process.
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

/** Picks database vs. in-memory per call, mirroring `getAccountStore()` in `./accounts.ts`. */
export const autoPrototypeWorkspaceStore: PrototypeWorkspaceStore = {
  async load(userId) {
    const db = await getDb();
    return (db ? databasePrototypeWorkspaceStore : inMemoryPrototypeWorkspaceStore).load(userId);
  },
  async create(userId, snapshot) {
    const db = await getDb();
    return (db ? databasePrototypeWorkspaceStore : inMemoryPrototypeWorkspaceStore).create(
      userId,
      snapshot
    );
  },
  async compareAndSwap(userId, expectedRevision, snapshot) {
    const db = await getDb();
    return (
      db ? databasePrototypeWorkspaceStore : inMemoryPrototypeWorkspaceStore
    ).compareAndSwap(userId, expectedRevision, snapshot);
  },
};

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
  store: PrototypeWorkspaceStore = databasePrototypeWorkspaceStore
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
