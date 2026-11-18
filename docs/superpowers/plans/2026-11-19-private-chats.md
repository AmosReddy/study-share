# Private Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two members of a group can chat privately; nobody else (including the owner) can read or see it.

**Architecture:** Three new tables (`direct_chats`, `direct_messages`, `direct_reads`) behind a new `DirectChatStore` port with Postgres and fake adapters sharing one contract. Use-cases mirror the group chat's (`src/server/chat/use-cases.ts`) with a participant rule on top. The existing chat panel and polling code are reused with private endpoints.

**Tech Stack:** as the group chat (Next.js 16 cacheComponents, TypeScript, Drizzle/Postgres, zod, Vitest, Playwright; ports/adapters; shared contract tests).

**Spec:** `docs/superpowers/specs/2026-11-19-private-chats-design.md` (read it first, including "Small calls made after the review").

## Global Constraints

- Participant rule: caller must be an ACTIVE member of a live group AND one of the two participants of a chat that belongs to the group in the ADDRESS; everything else answers exactly like "not found" (same shape as the group chat's `notFound`), including a chat id from another group, a chat the caller is not in, the group owner who is not a participant, removed members, malformed ids.
- Send and delete-own: read access AND the other participant is still an ACTIVE member of the group; otherwise read-only. Delete only your own messages; the owner has NO power over private chats (`message.delete.any` never applies).
- Messages: same cleaning and limits as group messages (1 to 2000 characters, `src/shared/message-schemas.ts`); 20 sends per minute per person (limit key `dm-send:user:<id>`), 30 chat openings per hour per person (`dm-open:user:<id>`); fail open like elsewhere.
- Chats with no non-deleted message are hidden from the Private list (for both people); opening a chat by tapping a member creates it silently.
- Members' account ids stay hidden: the Members list gives each OTHER member a one-way `chatKey` = base64url(HMAC-SHA256(secret, `direct-chat:${groupId}:${userId}`)) with secret = `SUPABASE_SERVICE_ROLE_KEY` (as `src/server/auth/signup-cookies.ts` does; no new setting); the server maps a key back to a member by recomputing over the group's ACTIVE members (constant-time compare).
- Account deletion cascades private chats and messages (both participant FKs `on delete cascade`).
- Views never contain account ids; failures log a fixed sentence only; no clock reads during prerender; English only; 360px layouts and 44px targets; never read `.env*`; never touch production; agents never run migrations or push.

## Review Focus

- Group owner, other members, removed members and members of other groups cannot list, open, read, poll, send to, delete from, or learn the existence of a chat (including via `chatKey` replay, a guessed chat id, or another group's address).
- A chat id of group A used under group B's address, where the caller is a participant of that chat but only a member of B (not A): not found.
- The other person leaves or is removed: the stayer can still read, cannot send or delete-own; the leaver cannot read; rejoining restores access to the same chat.
- A retried send (same `client_id`) never duplicates; `markRead` moves the cursor forward only.
- Group chat queries never touch the new tables and private queries never touch `messages`.

## File Structure

- Create `drizzle/0008_direct_chats.sql` (+ meta), modify `src/server/db/schema.ts`.
- Create `src/server/ports/direct-chat-store.ts`, `src/server/db/direct-chat-store.ts`, `src/server/adapters/fake-direct-chat-store.ts`, `direct-chat-store.contract.ts`, `fake-direct-chat-store.test.ts`, `src/server/db/direct-chat-store.int.test.ts`; modify `src/server/services.ts` (`getDirectChatStore()`), `/api/test/reset`.
- Create `src/server/groups/chat-key.ts` (+ test), `src/server/chat/direct-use-cases.ts` (+ test), `direct-request-deps.ts`; shared types in `src/shared/direct-chat-types.ts`; routes under `src/app/groups/[id]/chat/private/...`.
- UI (Task 2): Members list, group tabs/layout (unread dot), Chat area switch, private list page, conversation page, shared chat panel changes, e2e, guide.

---

### Task 1: Data layer and server rules

**Files:** as File Structure (everything except UI).

**Interfaces:**
- Consumes: group chat code (`MessageRecord`-style cursor helpers in `src/server/resource-cursor.ts`, `cleanMessageBody`/`sendMessageSchema`, `CHAT_MESSAGES`, `memberContext`/`actionContext` in `src/server/groups/use-cases.ts`, `GroupStore.getMembership`).
- Produces:
  - `DirectChatStore` (names exact): `openChat(groupId: string, userX: string, userY: string): Promise<{ chatId: string }>` (idempotent; stores the pair ordered `user_low < user_high` as strings; throws for a deleted/missing group or equal users); `findChat(groupId: string, chatId: string): Promise<{ id: string; participants: [string, string] } | null>` (null for a deleted group or malformed ids); `listChatsFor(groupId: string, userId: string): Promise<{ chatId: string; otherUserId: string; otherName: string; lastBody: string; lastAt: Date; unread: boolean }[]>` (only chats with at least one non-deleted message, newest first, `lastBody` cut to 80 chars, `unread` = a message from the OTHER person newer than the caller's read cursor); `send(input: { chatId: string; senderId: string; clientId: string; body: string }): Promise<{ message: DirectMessageRecord; created: boolean }>` (idempotent on `(chat_id, client_id)`; same rules as `MessageStore.send` including the deleted-message answer); `listLatest(chatId, limit)`, `listAfter(chatId, cursor, limit)`, `listBefore(chatId, cursor, limit)` with the same return shapes and microsecond cursors as `MessageStore`; `findMessageById(chatId, id)`; `softDelete(chatId, id)`; `markRead(chatId: string, userId: string, cursor: string): Promise<void>` (moves forward only); `unreadSummary(groupId: string, userId: string): Promise<{ any: boolean; fromUserIds: string[] }>` (chats with unread messages from the other person; empty chats excluded).
  - `DirectMessageRecord` = the group `MessageRecord` shape with `chatId` instead of `groupId`.
  - `chatKeyFor(secret: string, groupId: string, userId: string): string`; `findMemberByChatKey(secret: string, groupId: string, activeUserIds: string[], key: string): string | null`.
  - Use-cases in `src/server/chat/direct-use-cases.ts` (deps = `GroupDeps` + `direct: DirectChatStore` + `secret: string`): `openDirectChat(deps, groupId, chatKey): Promise<{ ok: true; data: { chatId: string } } | NotFound | rate-limited>` (the target must be an ACTIVE member other than the caller); `listPrivateChats(deps, groupId): Promise<{ chats: { chatId: string; name: string; otherGone: boolean; preview: string; lastAt: string; unread: boolean }[] } | null>`; `loadDirectChat(deps, groupId, chatId, query: { after?: string; before?: string }): Promise<{ messages: MessageView[]; hasMore: boolean; cursor: string | null; canSend: boolean; otherName: string; otherGone: boolean } | null>` (a successful load of the newest messages moves the caller's read cursor); `sendDirectMessage(deps, groupId, chatId, raw: { body: string; clientId: string })`; `deleteDirectMessage(deps, groupId, chatId, messageId)`; `privateUnread(deps, groupId): Promise<{ any: boolean; fromChatKeys: string[] }>`. `MessageView` is the group chat's (`src/shared/chat-types.ts`), `mine` and `canDelete` computed for the private rules.
  - Routes (GET, JSON, `no-store`, `await connection()` first, bare 404 for not allowed, redirect to login when signed out, copied from `src/app/groups/[id]/chat/messages/route.ts` + `serve-messages.ts`): `/groups/[id]/chat/private/[chatId]/messages` (the `after`/`before` poll) and `/groups/[id]/chat/private/summary` (the list + `unread` info used for polling the Private list).
- [ ] Step 1: Write failing tests: the contract for the store (ordering of the pair, idempotent open, hidden empty chats in `listChatsFor`, send idempotency, paging, cursors, soft delete, markRead forward only, unreadSummary), unit tests for chat keys (stable, unique per member and group, rejects garbage, constant-time compare), and use-case tests covering EVERY line of Review Focus.
- [ ] Step 2: Run `npx vitest run --project unit` on those files; expect FAIL.
- [ ] Step 3: Implement. Migration `0008_direct_chats` via `npx drizzle-kit generate --name direct_chats` (dummy `DATABASE_URL` on the command line only): tables per the spec, RLS on with no policies, check `user_low < user_high`, unique `(group_id, user_low, user_high)`, unique `(chat_id, client_id)`, body check like `messages`, indexes `(chat_id, created_at desc, id desc)` and on `direct_chats (group_id, user_low)` and `(group_id, user_high)`. Postgres adapter parameters only (copy `src/server/db/message-store.ts` patterns); fake mirrors strictness and tracks the fake group store's liveness like the fake message store; int test for the migration and SQL (cannot be run locally).
- [ ] Step 4: Run unit tests, typecheck, lint: PASS. Commit `feat: private chats data layer and server rules`.

### Task 2: Screens, end-to-end tests and the owner guide

**Files:** UI as File Structure; e2e; `docs/SLICE_6_ACCEPTANCE.md`.

**Interfaces:**
- Consumes: Task 1 (`openDirectChat`, `listPrivateChats`, `loadDirectChat`, `sendDirectMessage`, `deleteDirectMessage`, `privateUnread`, the routes) and the group chat UI (`src/client/components/chat/*`, `src/client/lib/chat-*`).
- Produces: Members tab: each OTHER member's row has a "Message" button (>= 44px, form posting the `chatKey` to a server action that calls `openDirectChat` and redirects to `/groups/<id>/chat/private/<chatId>`) and an unread dot when that member sent something unread; Chat area: a "Group | Private" switch; `/groups/[id]/chat/private` list page (rows: name with "(left the group)" when gone, preview, unread dot, relative time computed on the client, empty state "No private chats yet. Open the Members tab and tap someone to message them."); `/groups/[id]/chat/private/[chatId]` conversation page (title = the other person, "Back to private chats", same bubbles/composer/delete-own/"Load earlier"/idle slow-down as the group chat via the shared panel pointed at the private endpoints and actions; read-only note "<Name> is no longer in this group. You can read this conversation but not reply." replacing the composer); an unread dot on the Chat tab (computed in the group layout once per render via `privateUnread`) and on the Private switch.
- [ ] Step 1: Write failing e2e tests (fake services; the second person via the test-only join route; owner and two members): Message button opens a private chat; the other person sees it in Private only after a message arrives and with an unread dot (Chat tab, Private switch, member row), the dot clears after reading; the owner and a third member cannot open the conversation URL (not-found page) or poll its endpoint (404) and see nothing in the Private list; a chat id of another group under this group's address is not found; send, reply within the polling window, delete own message (no delete button on the other person's), line breaks and 2000-character limit as in group chat; the other person removed by the owner: the stayer reads but cannot send (note shown, no composer), the removed person gets not-found; a member who leaves and rejoins regains access; hostile `chatKey` (garbled, own key, another group's key) is not found; 360px no sideways scroll, composer above the tab bar, `auditPage` on the list, conversation and read-only states.
- [ ] Step 2: Run them; expect FAIL.
- [ ] Step 3: Implement the UI (reuse the chat panel: parametrise endpoints/actions/read-only instead of copying), the server actions, the layout dot, and keep the group chat's behaviour and tests unchanged.
- [ ] Step 4: Run the whole e2e suite on desktop, phone-360 and phone-412, `npm test`, typecheck, lint: PASS.
- [ ] Step 5: Write `docs/SLICE_6_ACCEPTANCE.md` in the style of `docs/SLICE_5_ACCEPTANCE.md` (beginner friendly, `<preview address>` placeholder, three accounts on two devices incl. a phone; says a database change must be applied to production before merge): open a chat from Members; reply; unread dots; the third person and the owner cannot see it; delete own message; removed member loses access and the stayer reads read-only; rejoin; phone checks; chat refreshes every few seconds.
- [ ] Step 6: Commit `feat: private chats between two members`.
