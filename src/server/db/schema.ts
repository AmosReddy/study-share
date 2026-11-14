import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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

/**
 * A file shared in a group. Created as 'uploading' when the browser is handed an upload link and
 * 'ready' once the server has confirmed the stored file; only ready rows are listed. Deleting a
 * file sets deleted_at. uploader_id is cleared (not the file) when the uploader's account goes, so
 * the file stays and shows "Former member". The length checks match RESOURCE_LIMITS in
 * src/shared/resources.ts. See resource-store.ts.
 */
export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    uploaderId: uuid("uploader_id").references(() => authUsers.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    subject: text("subject").notNull().default(""),
    type: text("type").notNull(),
    fileKey: text("file_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: text("status").notNull().default("uploading"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("resources_group_created_idx").on(t.groupId, t.createdAt.desc(), t.id),
    check("resources_type_check", sql`type in ('notes', 'pyq', 'study_material', 'assignment', 'other')`),
    check("resources_status_check", sql`status in ('uploading', 'ready')`),
    check("resources_size_check", sql`size_bytes > 0`),
    check("resources_title_length_check", sql`char_length(btrim(title)) between 1 and 120`),
    check("resources_subject_length_check", sql`char_length(subject) <= 60`),
    check("resources_file_name_length_check", sql`char_length(file_name) between 1 and 200`),
  ],
).enableRLS();

/**
 * Chat messages, one chat per group. sender_id is cleared (not the message) when the sender's
 * account goes, so the message stays and shows "Former member". Deleting a message sets deleted_at.
 * (group_id, client_id) is unique so a retried send is a no-op. The body check matches
 * CHAT_LIMITS.maxBody in src/shared/messages.ts. See message-store.ts.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").references(() => authUsers.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    clientId: uuid("client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("messages_group_client_unique").on(t.groupId, t.clientId),
    index("messages_group_created_idx").on(t.groupId, t.createdAt.desc(), t.id.desc()),
    check("messages_body_length_check", sql`char_length(btrim(body)) between 1 and 2000`),
  ],
).enableRLS();
