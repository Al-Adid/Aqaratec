import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { TRPCError } from "@trpc/server";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { COOKIE_NAME, ONE_HOUR_MS } from "@shared/const";
import { getFirestore } from "../firebase";
import { getSessionCookieOptions } from "../_core/cookies";
import { ENV } from "../_core/env";
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
// Firestore-backed store. The real, persistent account store used in every
// environment (local dev and production alike) — there is no database-less
// fallback here, so registering an account always actually persists it.
// ---------------------------------------------------------------------------

const ACCOUNTS_COLLECTION = "accounts";
const COUNTERS_DOC_PATH = ["_meta", "counters"] as const;

/**
 * Firestore has no auto-increment primary key, but `AccountRecord.id` is a
 * `number` throughout the app (session payloads, prototype workspace keys,
 * admin procedures). A transactional counter preserves that contract instead
 * of threading a type change through the whole codebase.
 */
async function nextAccountId(): Promise<number> {
  const counterRef = getFirestore().collection(COUNTERS_DOC_PATH[0]).doc(COUNTERS_DOC_PATH[1]);
  return getFirestore().runTransaction(async tx => {
    const snap = await tx.get(counterRef);
    const current = (snap.data()?.nextAccountId as number | undefined) ?? 1;
    tx.set(counterRef, { nextAccountId: current + 1 }, { merge: true });
    return current;
  });
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate(): Date }).toDate();
  }
  return new Date();
}

function toAccountRecord(id: number, data: FirebaseFirestore.DocumentData): AccountRecord {
  return {
    id,
    openId: data.openId,
    name: data.name ?? null,
    email: data.email ?? null,
    passwordHash: data.passwordHash ?? "",
    loginMethod: data.loginMethod ?? null,
    role: data.role,
    isActive: data.isActive,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    lastSignedIn: toDate(data.lastSignedIn),
  };
}

function accountDoc(id: number) {
  return getFirestore().collection(ACCOUNTS_COLLECTION).doc(String(id));
}

export const firestoreAccountStore: AccountStore = {
  async findByEmail(email) {
    const snap = await getFirestore()
      .collection(ACCOUNTS_COLLECTION)
      .where("email", "==", email)
      .limit(1)
      .get();
    if (snap.empty) return undefined;
    const doc = snap.docs[0];
    return toAccountRecord(Number(doc.id), doc.data());
  },
  async findByOpenId(openId) {
    const snap = await getFirestore()
      .collection(ACCOUNTS_COLLECTION)
      .where("openId", "==", openId)
      .limit(1)
      .get();
    if (snap.empty) return undefined;
    const doc = snap.docs[0];
    return toAccountRecord(Number(doc.id), doc.data());
  },
  async findById(id) {
    const doc = await accountDoc(id).get();
    if (!doc.exists) return undefined;
    return toAccountRecord(id, doc.data()!);
  },
  async create(input) {
    const id = await nextAccountId();
    const openId = synthesizeOpenId();
    const now = new Date();
    const data = {
      openId,
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
    await accountDoc(id).set(data);
    return toAccountRecord(id, data);
  },
  async listAll() {
    const snap = await getFirestore().collection(ACCOUNTS_COLLECTION).orderBy("createdAt", "asc").get();
    return snap.docs.map(doc => toAccountRecord(Number(doc.id), doc.data()));
  },
  async setActive(id, isActive) {
    await accountDoc(id).update({ isActive, updatedAt: new Date() });
  },
  async touchLastSignedIn(id) {
    await accountDoc(id).update({ lastSignedIn: new Date() });
  },
};

// ---------------------------------------------------------------------------
// In-memory store. Test-only fixture (see accounts.spec.ts) — never used by
// the running app, which always talks to Firestore above.
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

/** The single place the rest of the app asks for the account store. */
export async function getAccountStore(): Promise<AccountStore> {
  return firestoreAccountStore;
}

// ---------------------------------------------------------------------------
// Session resolution. Self-contained (jose + a local secret): no dependency on
// a reachable Manus OAuth server, so it works the same in dev and production.
// ---------------------------------------------------------------------------

// Deliberately independent of server/_core/sdk.ts's Manus-OAuth session
// signing: that signer binds every token to MANUS_PROJECT_ID (`appId`) and
// rejects tokens where it's empty, which it always is now that there's no
// Manus app. Real accounts need their own, unconditionally valid session.
function getSessionSecretKey(): Uint8Array {
  if (!ENV.cookieSecret) throw new Error("SESSION_JWT_SECRET is unavailable");
  return new TextEncoder().encode(ENV.cookieSecret);
}

async function signAccountSessionToken(openId: string, name: string, expiresInMs: number): Promise<string> {
  const expirationSeconds = Math.floor((Date.now() + expiresInMs) / 1000);
  return new SignJWT({ openId, name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(getSessionSecretKey());
}

async function verifyAccountSessionToken(token: string): Promise<{ openId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecretKey(), { algorithms: ["HS256"] });
    const { openId } = payload as Record<string, unknown>;
    return typeof openId === "string" && openId.length > 0 ? { openId } : null;
  } catch {
    return null;
  }
}

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

  const session = await verifyAccountSessionToken(token);
  if (!session) return null;

  const store = await getAccountStore();
  const account = await store.findByOpenId(session.openId);
  if (!account || !account.isActive) return null;

  void store.touchLastSignedIn(account.id).catch(() => {});
  return toPublicAccount(account);
}

/**
 * Each login/register issues a fresh, short-lived session: the cookie and the
 * JWT's own `exp` both expire after ONE_HOUR_MS, so a browser can't carry a
 * stale sign-in indefinitely (previously 1 year) — the owner has to log back
 * in roughly every hour, each time producing a new, independent session token.
 */
async function issueSession(res: { cookie: (name: string, value: string, options: unknown) => void }, req: unknown, account: PublicAccount) {
  const sessionToken = await signAccountSessionToken(account.openId, account.name || "", ONE_HOUR_MS);
  const cookieOptions = getSessionCookieOptions(req as never);
  res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_HOUR_MS });
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

/**
 * Factory, not a flat object, so tests can exercise this exact router logic
 * against a fake store instead of live Firestore — same shape as
 * `createPrototypeRouter` in `./prototype.ts`.
 */
export function createAccountsRouter(store: AccountStore = firestoreAccountStore) {
  return router({
    register: publicProcedure.input(registerInputSchema).mutation(async ({ ctx, input }) => {
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
}

export const accountsRouter = createAccountsRouter();

// ---------------------------------------------------------------------------
// Super admin router: cross-account oversight. `adminProcedure` already
// enforces `ctx.user.role === "admin"` server-side — the real security
// boundary. Hiding the route client-side is only a UX nicety on top of it.
// ---------------------------------------------------------------------------

export function createSuperAdminRouter(store: AccountStore = firestoreAccountStore) {
  return router({
    listAccounts: adminProcedure.query(async () => {
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
        const target = await store.findById(input.accountId);
        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
        }
        await store.setActive(input.accountId, input.isActive);
        return { success: true } as const;
      }),
  });
}

export const superAdminRouter = createSuperAdminRouter();
