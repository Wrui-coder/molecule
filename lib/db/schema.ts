import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Data model
 * ----------
 * An *app* is one user idea. Every generation (the first one, and every
 * follow-up instruction) appends an immutable *version*. Nothing is ever
 * overwritten, which is what makes rollback a first-class operation instead of
 * a special case: rolling back is just "append a copy of an old version".
 */

export const apps = pgTable(
  "apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    /** draft | generating | ready | error */
    status: text("status").notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("apps_updated_at_idx").on(table.updatedAt)],
);

export const versions = pgTable(
  "versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** the instruction that produced this version */
    instruction: text("instruction").notNull(),
    /** model's one-line description of what changed */
    summary: text("summary").notNull().default(""),
    html: text("html").notNull(),
    /** ms spent generating, for the "平均耗时" stat on the landing page */
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("versions_app_version_idx").on(table.appId, table.version)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    /** user | assistant */
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** version this assistant message announced, null for user messages */
    version: integer("version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_app_created_idx").on(table.appId, table.createdAt)],
);

export type AppRow = typeof apps.$inferSelect;
export type VersionRow = typeof versions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
