import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

/**
 * Row Level Security is switched on for every table and no policies grant
 * public access, so only the server (which connects as a privileged role) can
 * read or write. Always chain .enableRLS() on new tables.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  ageConfirmedAt: timestamp("age_confirmed_at", { withTimezone: true }),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  termsVersion: text("terms_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/**
 * One row per rate-limit key and window. See postgres-rate-limiter.ts.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
).enableRLS();

/**
 * A study group. Deleting a group sets deleted_at (the row and its invite keys stay, so an old
 * link never finds a new group); every read of the store skips deleted groups. See group-store.ts.
 * The invite token and code are unique across all groups, deleted ones included.
 */
export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    joinMode: text("join_mode").notNull(),
    passwordHash: text("password_hash"),
    inviteToken: text("invite_token").notNull().unique(),
    inviteCode: text("invite_code").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  () => [
    check("groups_join_mode_check", sql`join_mode in ('password', 'link')`),
    check("groups_password_check", sql`join_mode = 'link' or password_hash is not null`),
  ],
).enableRLS();

/**
 * Who is in which group. Leaving deletes the row; removal keeps it with status 'removed', which
 * blocks joining again. At most one active owner per group (a backstop: the store's advisory
 * locks are what keep the limits).
 */
export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("group_members_user_id_idx").on(t.userId),
    uniqueIndex("group_members_one_active_owner").on(t.groupId).where(sql`role = 'owner' and status = 'active'`),
    check("group_members_role_check", sql`role in ('owner', 'admin', 'member')`),
    check("group_members_status_check", sql`status in ('active', 'pending', 'removed')`),
  ],
).enableRLS();
