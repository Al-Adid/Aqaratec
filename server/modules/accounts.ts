import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getDb } from "../db";
import { users, type User } from "../../drizzle/schema";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;

/** Scrypt is CPU-hard and salted; the digest is stored as `salt:hash` hex, never the raw password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

export type AccountRole = "user" | "admin";

export interface PublicAccount {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: AccountRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
}

export interface AccountRecord extends PublicAccount {
  passwordHash: string;
}

export interface CreateAccountInput {
  name: string;
  email: string;
  passwordHash: string;
  role: AccountRole;
}

/**
 * Narrow storage seam, same shape as `PrototypeWorkspaceStore` in
 * `./prototype.ts`: one interface, a database-backed implementation and an
 * in-memory one, selected at call time by whether `DATABASE_URL` resolves.
 */
export interface AccountStore {
  findByEmail(email: string): Promise<AccountRecord | undefined>;
  findByOpenId(openId: string): Promise<AccountRecord | undefined>;
  findById(id: number): Promise<AccountRecord | undefined>;
  create(input: CreateAccountInput): Promise<AccountRecord>;
  listAll(): Promise<AccountRecord[]>;
  setActive(id: number, isActive: boolean): Promise<void>;
  touchLastSignedIn(id: number): Promise<void>;
}

export function toPublicAccount(record: AccountRecord): PublicAccount {
  const { passwordHash: _passwordHash, ...publicAccount } = record;
  return publicAccount;
}

function synthesizeOpenId(): string {
  return `local:${randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Database-backed store. Live once DATABASE_URL resolves; untouched until then.
// ---------------------------------------------------------------------------

function toAccountRecord(row: User): AccountRecord {
  return {
    id: row.id,
    openId: row.openId,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash ?? "",
    loginMethod: row.loginMethod,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSignedIn: row.lastSignedIn,
  };
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

export const databaseAccountStore: AccountStore = {
  async findByEmail(email) {
    const db = await requireDb();
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0] ? toAccountRecord(rows[0]) : undefined;
  },
  async findByOpenId(openId) {
    const db = await requireDb();
    const rows = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    return rows[0] ? toAccountRecord(rows[0]) : undefined;
  },
  async findById(id) {
    const db = await requireDb();
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? toAccountRecord(rows[0]) : undefined;
  },
  async create(input) {
    const db = await requireDb();
    const openId = synthesizeOpenId();
    await db.insert(users).values({
      openId,
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      loginMethod: "password",
      role: input.role,
    });
    const created = await databaseAccountStore.findByOpenId(openId);
    if (!created) throw new Error("Failed to read back the created account");
    return created;
  },
  async listAll() {
    const db = await requireDb();
    const rows = await db.select().from(users);
    return rows.map(toAccountRecord);
  },
  async setActive(id, isActive) {
    const db = await requireDb();
    await db.update(users).set({ isActive }).where(eq(users.id, id));
  },
  async touchLastSignedIn(id) {
    const db = await requireDb();
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, id));
  },
};

// ---------------------------------------------------------------------------
// In-memory store. Used whenever no DATABASE_URL is configured, so the app is
// fully usable before a real database is wired up. Data lives only for the
// life of this process: restarting the server clears registered accounts.
// ---------------------------------------------------------------------------

let nextMemoryId = 1;
const memoryAccounts: AccountRecord[] = [];
let memorySeeded = false;

/** The one bootstrap account: without it nobody could ever reach /super-admin. */
async function seedMemoryAccounts() {
  if (memorySeeded) return;
  memorySeeded = true;
  const now = new Date();
  memoryAccounts.push({
    id: nextMemoryId++,
    openId: "local:seed-super-admin",
    name: "مدير المنصة",
    email: "admin@sunnaa.local",
    passwordHash: await hashPassword("Admin@12345"),
    loginMethod: "password",
    role: "admin",
    isActive: true,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  });
}

export const hardcodedAccountStore: AccountStore = {
  async findByEmail(email) {
    await seedMemoryAccounts();
    return memoryAccounts.find(account => account.email === email);
  },
  async findByOpenId(openId) {
    await seedMemoryAccounts();
    return memoryAccounts.find(account => account.openId === openId);
  },
  async findById(id) {
    await seedMemoryAccounts();
    return memoryAccounts.find(account => account.id === id);
  },
  async create(input) {
    await seedMemoryAccounts();
    const now = new Date();
    const record: AccountRecord = {
      id: nextMemoryId++,
      openId: synthesizeOpenId(),
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      loginMethod: "password",
      role: input.role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    };
    memoryAccounts.push(record);
    return record;
  },
  async listAll() {
    await seedMemoryAccounts();
    return [...memoryAccounts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  },
  async setActive(id, isActive) {
    await seedMemoryAccounts();
    const account = memoryAccounts.find(candidate => candidate.id === id);
    if (!account) return;
    account.isActive = isActive;
    account.updatedAt = new Date();
  },
  async touchLastSignedIn(id) {
    await seedMemoryAccounts();
    const account = memoryAccounts.find(candidate => candidate.id === id);
    if (account) account.lastSignedIn = new Date();
  },
};

/** The single place that decides database vs. in-memory. Call per-request: never cache the result. */
export async function getAccountStore(): Promise<AccountStore> {
  const db = await getDb();
  return db ? databaseAccountStore : hardcodedAccountStore;
}

// ---------------------------------------------------------------------------
// Session resolution. Self-contained (jose + a local secret): no dependency on
// a reachable Manus OAuth server, so it works the same in dev and production.
// ---------------------------------------------------------------------------

export async function resolveSessionUser(req: {
  headers: { cookie?: string | undefined };
}): Promise<PublicAccount | null> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));

  const session = await sdk.verifySession(token);
  if (!session) return null;

  const store = await getAccountStore();
  const account = await store.findByOpenId(session.openId);
  if (!account || !account.isActive) return null;

  void store.touchLastSignedIn(account.id).catch(() => {});
  return toPublicAccount(account);
}

async function issueSession(res: { cookie: (name: string, value: string, options: unknown) => void }, req: unknown, account: PublicAccount) {
  const sessionToken = await sdk.createSessionToken(account.openId, {
    name: account.name || "",
    expiresInMs: ONE_YEAR_MS,
  });
  const cookieOptions = getSessionCookieOptions(req as never);
  res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
}

// ---------------------------------------------------------------------------
// Public auth router: register + login. `me` / `logout` stay in routers.ts.
// ---------------------------------------------------------------------------

const EMAIL_MAX_LENGTH = 320;
const NAME_MAX_LENGTH = 120;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72; // scrypt/bcrypt-class inputs beyond this add no real strength.

const registerInputSchema = z
  .object({
    name: z.string().trim().min(2).max(NAME_MAX_LENGTH),
    email: z.string().trim().toLowerCase().email().max(EMAIL_MAX_LENGTH),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

const loginInputSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(EMAIL_MAX_LENGTH),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password (10003)";

export const accountsRouter = router({
  register: publicProcedure.input(registerInputSchema).mutation(async ({ ctx, input }) => {
    const store = await getAccountStore();
    const existing = await store.findByEmail(input.email);
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "An account with this email already exists (10004)",
      });
    }

    const passwordHash = await hashPassword(input.password);
    const account = await store.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: "user",
    });

    const publicAccount = toPublicAccount(account);
    await issueSession(ctx.res, ctx.req, publicAccount);
    return publicAccount;
  }),

  login: publicProcedure.input(loginInputSchema).mutation(async ({ ctx, input }) => {
    const store = await getAccountStore();
    const account = await store.findByEmail(input.email);
    // Always hash, even on a miss, so a wrong email and a wrong password take
    // the same time and an attacker cannot use latency to enumerate accounts.
    const passwordMatches = await verifyPassword(
      input.password,
      account?.passwordHash ?? (await hashPassword(randomUUID()))
    );

    if (!account || !passwordMatches) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: INVALID_CREDENTIALS_MESSAGE });
    }
    if (!account.isActive) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This account has been suspended (10005)",
      });
    }

    void store.touchLastSignedIn(account.id).catch(() => {});
    const publicAccount = toPublicAccount({ ...account, lastSignedIn: new Date() });
    await issueSession(ctx.res, ctx.req, publicAccount);
    return publicAccount;
  }),
});

// ---------------------------------------------------------------------------
// Super admin router: cross-account oversight. `adminProcedure` already
// enforces `ctx.user.role === "admin"` server-side — the real security
// boundary. Hiding the route client-side is only a UX nicety on top of it.
// ---------------------------------------------------------------------------

export const superAdminRouter = router({
  listAccounts: adminProcedure.query(async () => {
    const store = await getAccountStore();
    const accounts = await store.listAll();
    return accounts.map(toPublicAccount);
  }),

  setAccountActive: adminProcedure
    .input(z.object({ accountId: z.number().int().positive(), isActive: z.boolean() }).strict())
    .mutation(async ({ ctx, input }) => {
      if (input.accountId === ctx.user.id && !input.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot suspend your own account (10006)",
        });
      }
      const store = await getAccountStore();
      const target = await store.findById(input.accountId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }
      await store.setActive(input.accountId, input.isActive);
      return { success: true } as const;
    }),
});
