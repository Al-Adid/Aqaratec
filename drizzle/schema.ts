import {
  boolean,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import type { PrototypeState } from "../shared/prototype";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /**
   * Stable account identifier. For a password account this is synthesized
   * (`local:<uuid>`); for a Manus OAuth account it is the Manus openId.
   * Either way it is what the session cookie carries, never the email.
   */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  /** Scrypt hash ("salt:hash" hex), null for accounts that only ever used OAuth. */
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** Super admin kill switch for an account; checked on every session resolution. */
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * One private, optional cloud snapshot per authenticated user. The browser never
 * supplies userId; server procedures derive it from the authenticated context.
 */
export const prototypeWorkspaces = mysqlTable("prototypeWorkspaces", {
  userId: int("userId")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  snapshot: json("snapshot").$type<PrototypeState>().notNull(),
  revision: int("revision").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PrototypeWorkspace = typeof prototypeWorkspaces.$inferSelect;
export type InsertPrototypeWorkspace = typeof prototypeWorkspaces.$inferInsert;
