# Private chats between two group members: design

Status: waiting for the owner's approval. Nothing is built yet. A reviewer read it first and found nothing important left; the calls at the end record the small decisions it made.

## Intent and why

The group chat is visible to everyone in the group. Sometimes a member wants something from one other member (a resource, an answer) **without the whole group seeing**. The owner's idea: in the **Members** tab, tapping a member opens a **private chat between just those two people**. Nobody else can see it, including the group owner.

## Goals

- Tapping another member in the Members tab opens (or creates) a private chat with them.
- Only the two people can read or write it. **Not even the group owner** (owner's decision).
- It works like the group chat: text only, checks for new messages every few seconds while open, sender can delete their own messages, works well on a 360px phone.
- **A Private list on the Chat tab**: a switch between "Group" and "Private"; the Private list shows each conversation (the other person's name, a short preview, how long ago), newest first, so conversations can be found again.
- **A small unread dot** (owner's decision) on the Chat tab, on the Private list entry and on that member's row in the Members tab.
- **When one of the two leaves the group or is removed:** the person who stays can still **read** the conversation but cannot reply; the one who left loses access (owner's decision). If a member who left joins again later, they regain access.

## Non-goals

Files or images in private chats (text only, owner's decision), group chats of three or more people, editing messages, replies, typing indicators, read receipts, blocking or reporting, searching inside chats, email or push notifications, private chats outside a group, owner moderation of private chats.

## Anti-goals (failure even if it technically works)

- Anyone other than the two people can read, count, list or learn the existence of a private chat (including the owner, other members, removed members, other groups).
- The group chat becomes slower or leaks into private data.
- A tap on the wrong member silently starts a chat with someone else.
- The Members list exposes people's internal account ids to other members.

## Constraints

- One new migration (applied to production by the owner before merge, like earlier slices); free plans only; English only; no realtime service (polling, like the group chat); 360px layouts, 44px tap targets; no clock reads during prerender; every server action and route checks access itself.

## Approaches considered

1. **Separate tables for private chats, reusing the group chat's polling screen (recommended, used here).** Private messages live in their own tables, so a mistake in the group chat's queries can never expose them. The chat panel component, the polling code and the message rules are reused with different endpoints.
2. **Put private messages in the existing `messages` table with a nullable recipient.** Fewer tables, but every existing group-chat query would have to remember to exclude private rows: one forgotten filter exposes private messages to the whole group. Too risky for a privacy feature.
3. **Third-party chat service.** Not free-friendly, and it moves private data outside the database. Rejected.

## The design (owner's decisions are marked; the rest are my calls)

### Data (migration 0008)

- `direct_chats`: `id`, `group_id` (cascade with the group), two participants stored in a fixed order (`user_low`, `user_high`, a check that low < high so a pair has one conversation), `created_at`; unique per (group, pair).
- `direct_messages`: `id`, `chat_id` (cascade), `sender_id` (kept as set-null like group messages), `body` (same 1 to 2000 characters rules as group messages), `client_id` (retries do not duplicate; unique per chat), `created_at`, `deleted_at`.
- `direct_reads`: (`chat_id`, `user_id`) with the newest message cursor the person has seen; drives the unread dots.
- Row Level Security on, no policies, like every other table. All access goes through server code.

### Who can do what (the core rule, tested to death)

- **Participant check:** the caller must be one of the two people of that chat, and the chat must belong to the group in the address (a chat id from another group, or a chat the caller is not part of, answers exactly like "not found").
- **Read:** the caller must be an **active member** of the group, the group must exist (not deleted). The other person may be anyone: active or gone.
- **Send and delete-own:** read access **and** the other person is still an active member. Otherwise the screen is read-only with a short note ("Name is no longer in this group. You can read this conversation but not reply.").
- The owner has no special power over private chats. The existing `message.delete.any` does not apply to them.
- Messages are cleaned and limited exactly like group messages; **20 messages a minute per person** (own limit key) and 30 new conversations an hour.

### Opening a private chat

- The Members list keeps hiding other members' internal ids from plain members. Each other member's row instead carries a **one-way code** (`chatKey`, an HMAC of the group id and the member id with a server-side secret, as the pending sign-up cookie already does). The row's "Message" button sends that code to a server action `openDirectChat(groupId, chatKey)`, which finds the matching **active** member, creates the conversation if it does not exist, and redirects to `/groups/<groupId>/chat/private/<chatId>`. Your own row has no button. A garbled or foreign code answers "not found".

### What people see

- **Chat tab** gets a two-way switch, **Group** | **Private**. Private shows the list; each row: the other person's name (plus "(left the group)" when they are gone), the start of the last message, an unread dot, newest first. Empty state: "No private chats yet. Open the Members tab and tap someone to message them."
- **Members tab:** each other member's row gets a "Message" button (>=44px) and an unread dot when they sent something new.
- **A private conversation** looks like the group chat (same bubbles, composer above the phone's tab bar, delete-own with confirmation, "Load earlier messages", slow-down when idle), with the person's name as the title and a "Back to private chats" link. Read-only mode as above.
- **Unread dots** (my call): the group layout checks once per page render whether the person has any private message newer than their read cursor and shows the dot on the Chat tab; inside the Chat area the poll answers keep the Private list and dots fresh. A conversation is marked read when its newest message is shown to the person (the poll that returns messages moves their read cursor).

### Left to the builder

Component names and layout details, exact wording of messages (friendly, English), the migration's SQL, test data, how the two screens share the chat panel code, accessibility details.

## Small calls made after the review (my calls, for the owner to check)

1. **No new secret to set up:** the one-way member code reuses the same server-side secret the sign-up cookie already uses.
2. **Rejoining:** a member who left and joins again has the same account, so they get back the same private chats (nothing is deleted).
3. **Deleting an account** removes that person's private chats and messages for good (both participant links cascade). There is no account deletion in the app today, so this only matters for a developer deleting an account by hand.
4. **Chats with no messages yet are hidden** from the Private list, so nobody learns a chat was opened that nobody has written in. Opening someone's Members row and not writing leaves no trace for them.

## How it is delivered

One slice (it is a single feature), one branch and pull request, with a test guide for the owner. It needs the migration 0008 on production before merge, which the owner applies, then merge straight after.
