# Phase 1b: Groups and Joining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in person can create a private group (password or link-only), share an invite link or short code, and others can join through it (signing up or logging in on the way and returning to the same invite), see the group page with tabs, list members, and leave.

**Architecture:** A new `GroupStore` port (SQL implementation on Postgres, in-memory fake for `SERVICES_MODE=fake`, one shared contract test run against both) holds groups and memberships; group use-cases in `src/server/groups/` call it with the existing `RateLimiter` and the `can()` permissions module; pages are server components with small client forms that follow the existing `useAuthForm` pattern. Phase 1b owns creating, joining, the group shell, member list, leaving and the owner's join settings. Phase 1c (not in this plan) owns email invites, removing members with the rejoin block UI, transferring ownership, and deleting or restoring groups.

**Tech Stack:** Next.js 16.4.5 (read `node_modules/next/dist/docs/` before writing Next code, see AGENTS.md), React 19.3, TypeScript, Drizzle + postgres.js, Zod 4, Tailwind 4 + shadcn/radix, Vitest (unit + `*.int.test.ts`), Playwright, `node:crypto` scrypt.

**Spec:** `docs/superpowers/specs/2026-11-06-phase-1-accounts-and-groups-design.md` (sections 3, 5, 6.1 to 6.4, 7, 8, 10, 11). The registration redesign spec supersedes its sign-up parts only.

## Global Constraints

- Limits: a person is in at most **20** groups; a group has at most **300** members; group name **2 to 60** characters, description up to **300** (count Unicode code points, trim ends, collapse inner whitespace in the name); group password **6 to 64** characters; group code **8** characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0, O, 1, I, L), case-insensitive, normalised to upper case.
- Password mode lets in only on the right password; **5 wrong attempts in 15 minutes** lock that person out of that group for the rest of the window (the right password is refused too while locked). New groups default to password mode; join approval does not exist yet.
- The group password is stored only as a salted slow hash (scrypt), compared in constant time, never logged, never in a URL, never returned after the single response that created or changed it.
- Invite tokens: 32 random bytes, base64url. Resetting the link replaces token **and** code; the old ones stop working at once. Changing the password never removes members.
- A removed person cannot rejoin by any path. Leaving is different: a person who leaves can rejoin. Roles now: `owner`, `member` (`admin`, `pending` reserved). Owner cannot leave (transfer arrives in 1c).
- Unknown, reset, or deleted invite keys all give the same message; a non-member (or removed member) opening a group page gets the same 404 as a group that does not exist. Errors never contain secrets or other people's details.
- Phones first: 360px up, no sideways scroll, tap targets at least 44px, inputs at least 16px, correct `autocomplete`/`inputmode`; bottom tabs respect the safe area; Playwright runs at desktop, phone-360 and phone-412.
- Architecture rules: client/server/shared folders separate; vendor code only in adapters; every new table chains `.enableRLS()` (the RLS integration test fails otherwise); no new env setting; `SERVICES_MODE=fake` never touches Postgres; test-only routes 404 unless fake mode.
- Process rules: branch `feature/phase-1b-groups`; Conventional Commits ending with the `Co-Authored-By` line from the session reminder; never push (the controller pushes); never read, print or commit `.env*` files; do not run anything against production.
- Copy lives in `src/shared/group-messages.ts` (same style as `src/shared/auth-messages.ts`), never inline in components or use-cases.

## Review Focus

- Two people join in the same instant when 299 are in, or one person double-taps Join: exactly 300 members, exactly one membership per person (Task 6 contract + Task 7).
- Wrong password from several devices or accounts-of-one-person: lockout counts per person per group; the right password during lockout is refused; link-only groups never ask (Task 7).
- Signed-out person opens the invite, signs up by email code, signs in with Google, or logs in: lands back on the same invite, then joins; a first-time Google person passes `/welcome` Terms on the way (Task 11 e2e).
- Owner resets the link while someone is mid-way: the old key gives the standard "no longer valid" message, never a stack trace or the group name (Tasks 7, 11).
- Names with Hindi, Telugu, emoji and a 60-character name at 360px: no overflow, truncation not wrap-push; emoji counted as one character against the limit (Tasks 2, 9, 12).
- A non-member, a removed member and a deleted group are indistinguishable from "no such group", and the member list never shows to non-members (Tasks 7, 10).

---

## File Structure

- Create `src/shared/groups.ts` (limits, code alphabet, `normalizeGroupCode`, zod schemas, types), `src/shared/group-messages.ts`.
- Create `src/server/groups/secrets.ts` (password hash, token and code generation), `use-cases.ts`, `owner-use-cases.ts`, `request-deps.ts`, `rate-limit-policy.ts`, `shell-groups.ts`.
- Create `src/server/use-case-kit.ts` (extracted shared helpers).
- Create `src/server/ports/group-store.ts`, `src/server/adapters/fake-group-store.ts`, `src/server/adapters/group-store.contract.ts`, `src/server/db/group-store.ts`.
- Modify `src/server/db/schema.ts`, `drizzle/` (migration 0004), `src/server/services.ts`, `src/server/permissions/index.ts`, `src/shared/form-state.ts`, `src/app/api/test/reset/route.ts`.
- Create pages and actions under `src/app/groups/**`, `src/app/invite/[key]/`, `src/app/join/`; shared server frame `src/app/_components/signed-in-frame.tsx`; client components in `src/client/components/groups/`.
- Modify `src/app/page.tsx`, `src/app/account/page.tsx`, `src/client/components/app-shell/group-sidebar.tsx`, `src/client/components/home/empty-groups.tsx`.
- E2E: `e2e/groups.spec.ts`, `e2e/invite.spec.ts`, entries in `e2e/phone-quality.spec.ts`, helpers in `e2e/helpers.ts`.

---

### Task 1: Extract the shared use-case helpers

**Files:**
- Create: `src/server/use-case-kit.ts`
- Modify: `src/server/auth/use-cases.ts` (import from the kit; delete the moved code)
- Test: existing `src/server/auth/use-cases.test.ts` must pass unchanged

**Interfaces:**
- Produces from `use-case-kit.ts`: `type ActionResult<T = void>` (same shape as today), `type Failure`, `type Limit` (moved here from `auth/rate-limit-policy.ts`, which re-exports it with `export type { Limit } from "../use-case-kit"` so existing imports keep working), `type Check = { key: string; limit: Limit; message?: string }`, `parse(schema, raw)`, `ipCheck(prefix, ip, limit): Check[]`, `hitWithTimeout(...)`, `overLimit(limiter, checks, defaultMessage): Promise<Failure | null>` (the default refusal message becomes a parameter instead of `MESSAGES.tooMany`).

- [ ] **Step 1:** Run `npm test` and record that it passes (baseline).
- [ ] **Step 2:** Move `ActionResult`, `Failure`, `Check`, `parse`, `ipCheck`, `hitWithTimeout`, `overLimit`, `MAX_IP_LENGTH`, `LIMITER_TIMEOUT_MS` out of `src/server/auth/use-cases.ts` into `src/server/use-case-kit.ts`, behaviour unchanged. Auth call sites pass `MESSAGES.tooMany` as the default message. Keep `Deps` and the auth-specific helpers where they are. Keep the single fixed warning text and the fail-open behaviour exactly.
- [ ] **Step 3:** Run `npm test && npm run typecheck && npm run lint`. Expected: all pass, no test file edited except import paths if a test imported a moved symbol.
- [ ] **Step 4:** Commit `refactor: share the use-case helpers between auth and groups`.

---

### Task 2: Shared group rules, messages and FormState reveal

**Files:**
- Create: `src/shared/groups.ts`, `src/shared/group-messages.ts`, `src/shared/groups.test.ts`
- Modify: `src/shared/form-state.ts`

**Interfaces:**
- Produces from `groups.ts`: `GROUP_LIMITS = { maxGroupsPerPerson: 20, maxMembers: 300, nameMin: 2, nameMax: 60, descriptionMax: 300, passwordMin: 6, passwordMax: 64, codeLength: 8 }`; `GROUP_CODE_ALPHABET`; `type JoinMode = "password" | "link"`; `type GroupRole = "owner" | "admin" | "member"`; `type MemberStatus = "active" | "pending" | "removed"`; `normalizeGroupCode(raw: string): string` (trim, strip spaces and hyphens, upper-case); `isGroupCode(key: string): boolean` (exactly 8 chars from the alphabet after normalising); `createGroupSchema` (`name`, `description?`, `joinMode`, `password?`; password required and 6 to 64 chars when `joinMode === "password"`, ignored when `link`); `editGroupSchema` (`name`, `description?`); `joinModeSchema` (`joinMode`, `password?` same rule); `joinGroupSchema` (`key`, `password?`); `joinCodeSchema` (`code` normalised, must be a valid code).
- Produces from `group-messages.ts`: `GROUP_MESSAGES` with at least `invalidInvite` ("This invite link isn't valid any more. Ask the group owner for a new one."), `cannotJoin` ("You can't join this group."), `full` ("This group is full."), `wrongPassword` ("That password is not right."), `locked` ("Too many wrong passwords. Try again in 15 minutes."), `tooManyGroups` ("You are in 20 groups, the most one account can be in. Leave one to join another."), `tooMany` (generic rate-limit), `ownerCannotLeave`, `codeNotFound` (same text as `invalidInvite`), `couldNotSave`.
- `FormState` gains `reveal?: { password?: string }` (set only on `status: "done"`; never copied into `values`).

- [ ] **Step 1: Write failing tests** in `groups.test.ts`: name `"  Data   Structures "` parses to `"Data Structures"`; a 60-code-point name of 😀 repeated passes and 61 fails; 1 character fails; Hindi `"गणित कक्षा"` and Telugu names pass; description of 300 passes and 301 fails; `joinMode: "password"` with password `"12345"` fails on `password` and with 65 chars fails; `joinMode: "link"` ignores a missing password; `normalizeGroupCode(" ab-cd 234 ")` is `"ABCD234"` and `isGroupCode("ABCDEFG2")` is true while `"ABCDEFG0"` , `"ABCDEFGI"` and a 7-character string are false; the alphabet has 31 characters and contains none of `0 O 1 I L`.
- [ ] **Step 2:** Run `npx vitest run --project unit src/shared/groups.test.ts`; expected FAIL (module missing).
- [ ] **Step 3:** Implement the files per the Interfaces block (code-point length via `[...value].length`, as `displayNameSchema` does). Add `reveal` to `FormState`.
- [ ] **Step 4:** Run the test again, then `npm run typecheck`; expected PASS.
- [ ] **Step 5:** Commit `feat: shared group rules and messages`.

---

### Task 3: Group password hashing and invite secrets

**Files:**
- Create: `src/server/groups/secrets.ts`, `src/server/groups/secrets.test.ts`

**Interfaces:**
- Produces: `hashGroupPassword(password: string): Promise<string>` (format `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>`, N=16384, r=8, p=1, 16-byte salt, 32-byte key); `verifyGroupPassword(password: string, stored: string): Promise<boolean>` (constant-time via `timingSafeEqual`; a malformed or unknown-format `stored` returns false and never throws); `newInviteToken(): string` (32 random bytes, base64url); `newGroupCode(): string` (8 characters drawn uniformly from `GROUP_CODE_ALPHABET` with `randomInt`).

- [ ] **Step 1: Write failing tests:** a hash verifies with the right password and fails with a wrong one; two hashes of the same password differ; the stored string does not contain the password; `verifyGroupPassword("x", "garbage")` and `("x", "")` resolve false; unicode passwords (`"पासवर्ड123"`) verify; `newInviteToken()` is 43 characters of `[A-Za-z0-9_-]` and 200 tokens are distinct; `newGroupCode()` always satisfies `isGroupCode` over 500 draws and every character of the alphabet appears over 5000 draws.
- [ ] **Step 2:** Run `npx vitest run --project unit src/server/groups/secrets.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement with `node:crypto` (`scrypt` promisified, `randomBytes`, `randomInt`, `timingSafeEqual`); file starts with `import "server-only"`.
- [ ] **Step 4:** Run the test; expected PASS.
- [ ] **Step 5:** Commit `feat: group password hashing and invite secrets`.

---

### Task 4: Permissions for groups

**Files:**
- Modify: `src/server/permissions/index.ts`, `src/server/permissions/index.test.ts`

**Interfaces:**
- Produces new `Action`s in `allowedRoles`: `"group.view"` (owner, admin, member, unchanged), `"group.members.view"` (owner, admin, member), `"group.leave"` (member only), `"group.edit"` (owner), `"group.join.change"` (owner), `"group.invite.view"` (owner), `"group.invite.reset"` (owner). Reuse `Role` and `MemberStatus` from this file as the types for `src/shared/groups.ts` is a separate declaration that must stay identical: add a type-level assertion test that both unions match.

- [ ] **Step 1: Write failing tests** in the existing style: each new action is allowed exactly for the roles above and denied for signed-out, non-member, pending, removed; `group.leave` is denied for owner; an unknown action is still denied.
- [ ] **Step 2:** Run `npx vitest run --project unit src/server/permissions`; expected FAIL.
- [ ] **Step 3:** Add the actions to `allowedRoles`.
- [ ] **Step 4:** Run; expected PASS. **Step 5:** Commit `feat: permissions for group actions`.

---

### Task 5: GroupStore port, fake adapter, contract test, wiring

**Files:**
- Create: `src/server/ports/group-store.ts`, `src/server/adapters/fake-group-store.ts`, `src/server/adapters/group-store.contract.ts`, `src/server/adapters/fake-group-store.test.ts`
- Modify: `src/server/services.ts`, `src/server/services.test.ts`, `src/app/api/test/reset/route.ts` (and its test)

**Interfaces:**
- Produces in `ports/group-store.ts`:
```ts
type GroupRecord = { id: string; name: string; description: string; joinMode: JoinMode; passwordHash: string | null; inviteToken: string; inviteCode: string; createdAt: Date };
type Membership = { role: GroupRole; status: MemberStatus };
type GroupSummary = { id: string; name: string };
type MemberRow = { userId: string; displayName: string; role: GroupRole; joinedAt: Date };
interface GroupStore {
  createGroup(input: { ownerId: string; name: string; description: string; joinMode: JoinMode; passwordHash: string | null; inviteToken: string; inviteCode: string }): Promise<{ ok: true; group: GroupRecord } | { ok: false; reason: "too_many_groups" | "invite_taken" }>;
  findByInvite(key: { token: string } | { code: string }): Promise<GroupRecord | null>;  // never returns a deleted group
  findById(id: string): Promise<GroupRecord | null>;
  getMembership(groupId: string, userId: string): Promise<Membership | null>;
  listGroupsFor(userId: string): Promise<GroupSummary[]>;  // active memberships, not deleted, ordered by name then id
  addMember(groupId: string, userId: string): Promise<"joined" | "already_member" | "removed" | "full" | "too_many_groups" | "group_gone">;
  leave(groupId: string, userId: string): Promise<"left" | "owner" | "not_member">;  // deletes the membership row
  removeMember(groupId: string, userId: string): Promise<boolean>;  // sets status removed; false for owner or non-member
  listMembers(groupId: string): Promise<MemberRow[]>;  // active only, owner first then by joinedAt
  updateDetails(groupId: string, d: { name: string; description: string }): Promise<boolean>;
  updateJoin(groupId: string, j: { joinMode: JoinMode; passwordHash: string | null }): Promise<boolean>;
  replaceInvite(groupId: string, i: { inviteToken: string; inviteCode: string }): Promise<"ok" | "invite_taken" | "group_gone">;
}
```
- Produces `runGroupStoreContract(withStore: (run: (ctx: { store: GroupStore; newUser(name?: string): Promise<string>; newUsers(count: number): Promise<string[]> }) => Promise<void>) => Promise<void>): void` in the contract file (registers describe/test; `withStore` lets each implementation set up and clean up its own state; `newUsers` creates many people in one call so the 299-member test is fast). Produces `createFakeGroupStore(authStore = getFakeAuthStore()): GroupStore` and `resetFakeGroupStore()`; state on `globalThis["__studyShareFakeGroupStore"]`; display names come from the fake auth store's users. `services.ts` gains `getGroupStore(): GroupStore` using the existing lazy pattern (fake in fake mode, `createGroupStore(getDb())` otherwise).
- Consumes: types from `src/shared/groups.ts` (Task 2).

- [ ] **Step 1: Write the contract** with these tests (names exact): `creates a group and makes the creator its owner`; `rejects a 21st group for one person` (creates 20, then `too_many_groups`); `finds by token and by code, and not a deleted-or-unknown key`; `adds a member once (second add is already_member)`; `refuses the 301st member with full` (create 299 members via `newUser`, add 1 more succeeds, the next is `full`); `two adds at the same instant for the last seat give exactly one joined` (`Promise.all` of two different people at 299 members: one `joined`, one `full`; and the same person twice at once: one `joined`, one `already_member`); `a removed person gets removed on add and stays removed`; `leave deletes the membership, lets the person rejoin, and refuses the owner`; `removeMember refuses the owner and non-members`; `refuses a join when the person is already in 20 groups`; `listGroupsFor lists only active memberships`; `listMembers shows names, owner first, active only`; `updateDetails and updateJoin change only their fields`; `replaceInvite makes the old token and code stop finding the group`; `invite_taken on a duplicate token or code, with nothing changed`.
- [ ] **Step 2:** Add `fake-group-store.test.ts` calling the contract with an in-memory `withStore`. Run `npx vitest run --project unit src/server/adapters/fake-group-store.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement the port and fake (single-threaded Maps are atomic by construction; keep checks and writes in one synchronous section). Wire `getGroupStore`, add the `services.test.ts` cases (fake mode never calls `getDb` or the SQL factory; real mode returns the SQL store), and make `POST /api/test/reset` also call `resetFakeGroupStore()` (extend its test).
- [ ] **Step 4:** Run `npm test && npm run typecheck`; expected PASS. In this task `getGroupStore` returns the fake in fake mode and throws a clear "not available yet" error otherwise; Task 6 replaces that branch with the SQL store (and the real-mode `services.test.ts` case lands there).
- [ ] **Step 5:** Commit `feat: group store port with a fake adapter and contract`.

---

### Task 6: Database tables, migration and SQL GroupStore

**Files:**
- Modify: `src/server/db/schema.ts`; Create: `drizzle/0004_*.sql` (+ meta, via `npm run db:generate`), `src/server/db/group-store.ts`, `src/server/db/group-store.int.test.ts`; Modify: `src/server/services.ts` (real branch)

**Interfaces:**
- Consumes: Task 5's `GroupStore`, `runGroupStoreContract`.
- Produces tables: `groups` (`id uuid pk default gen_random_uuid()`, `name text not null`, `description text not null default ''`, `join_mode text not null`, `password_hash text`, `invite_token text not null unique`, `invite_code text not null unique`, `created_at timestamptz default now()`, `deleted_at timestamptz`), check constraints `join_mode in ('password','link')` and `(join_mode = 'link' or password_hash is not null)`; `group_members` (`group_id uuid references groups on delete cascade`, `user_id uuid references auth.users on delete cascade`, `role text not null`, `status text not null`, `joined_at timestamptz default now()`, primary key `(group_id, user_id)`), checks on `role` and `status` values, index on `user_id`, and a unique partial index allowing one active owner per group. Both `.enableRLS()`. Produces `createGroupStore(db): GroupStore`, taking `Pick<PostgresJsDatabase, "execute" | "transaction">`.

- [ ] **Step 1:** Add the tables to `schema.ts`; run `npm run db:generate`; read the generated SQL and confirm RLS is enabled and the constraints above are present (add missing CHECKs by editing the generated file; do not hand-edit the snapshot).
- [ ] **Step 2: Write `group-store.int.test.ts`:** `describe.skipIf(!testDatabaseUrl())` running `runGroupStoreContract`. Ruling: the concurrency tests (last seat, double add) are meaningless inside one rolled-back transaction on one connection, so this suite does NOT use the rollback pattern. `withStore` opens a small pool (`max: 5`), `newUser`/`newUsers` insert into `auth.users` with unique `...@example.invalid` emails (firing the profile trigger) and remember the ids, and a `finally` deletes the groups those users created and then the users (cascade removes memberships and profiles), so nothing persists even when a test fails. Only ever against `TEST_DATABASE_URL` (the helper already refuses production). Add: `every table in public still has row level security on` is already covered by `rls.int.test.ts`; also assert `group_members` rejects a status outside the allowed values and a second active owner.
- [ ] **Step 3:** Run `npm run test:int` with `TEST_DATABASE_URL` set locally to a throwaway database (CI runs it anyway); expected FAIL before implementation.
- [ ] **Step 4:** Implement `createGroupStore`. Concurrency: take `pg_advisory_xact_lock(hashtextextended(<groupId>, 0))` before counting members in `addMember`, and a per-user advisory lock before counting a person's groups in `addMember` and `createGroup`; every read filters `deleted_at is null`; `findByInvite` matches the token or the code exactly; map unique-violation on token/code to `invite_taken`. Wire the real branch in `getGroupStore`.
- [ ] **Step 5:** Run `npm run test:int && npm test && npm run typecheck`; expected PASS. Apply the migration to the dev database only with `npm run db:migrate` from the owner's dev env (never production).
- [ ] **Step 6:** Commit `feat: groups and memberships tables with the SQL group store`.

---

### Task 7: Group use-cases (create, view, join, leave)

**Files:**
- Create: `src/server/groups/rate-limit-policy.ts`, `src/server/groups/request-deps.ts`, `src/server/groups/use-cases.ts`, `src/server/groups/use-cases.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 6.
- Produces:
```ts
type GroupDeps = { groups: GroupStore; limiter: RateLimiter; ip: string; siteUrl: string; user: { id: string; displayName: string } };
type GroupView = { id: string; name: string; description: string; joinMode: JoinMode; inviteUrl: string; inviteCode: string };
requireGroupDeps(next: string): Promise<GroupDeps>   // in request-deps.ts: requireAcceptedTerms(next), then builds deps
previewDeps(): Promise<PreviewDeps>   // request-deps.ts; PreviewDeps = Omit<GroupDeps, "user"> & { user: GroupDeps["user"] | null }; no redirect, no Terms check (signed-out invite page)
createGroup(deps, raw): Promise<ActionResult<{ group: GroupView; password: string | null }>>   // password echoed once, only in password mode
listMyGroups(deps): Promise<GroupSummary[]>
previewInvite(deps: PreviewDeps, key: string): Promise<InvitePreview>   // lookups are rate limited per person when signed in, per IP (JOIN_IP_LIMIT) always
  // InvitePreview = { state: "invalid" } | { state: "removed" } | { state: "member"; groupId } | { state: "open"; groupId; name; joinMode; ownerName: string }
joinGroup(deps, raw): Promise<ActionResult<{ groupId: string }>>    // raw = { key, password? }
viewGroup(deps, groupId): Promise<{ group: GroupRecord; membership: Membership } | null>   // null for non-member, removed, deleted, unknown id, non-uuid id
listGroupMembers(deps, groupId): Promise<MemberRow[] | null>        // null unless can(user, "group.members.view")
leaveGroup(deps, groupId): Promise<ActionResult>
```
 Limits in `rate-limit-policy.ts`: `CREATE_GROUP_USER_LIMIT` 10 per hour per person; `JOIN_LOOKUP_USER_LIMIT` 60 per 15 min per person and `JOIN_IP_LIMIT` 300 per hour (code guessing), `WRONG_PASSWORD_LIMIT` 5 per 15 minutes keyed `join-wrong:<groupId>:<userId>`, checked with `limiter.peek` BEFORE verifying and counted with `limiter.hit` only after a wrong password.

- [ ] **Step 1: Write failing tests** (fake store, fake limiter; names exact): `createGroup in password mode returns the link, the code and the password once, and stores only a hash`; `createGroup in link mode returns password null`; `createGroup refuses a 21st group with the tooManyGroups message`; `createGroup retries when the generated code is taken` (store forced to answer invite_taken twice); `createGroup rate limit refuses the 11th in an hour`; `previewInvite gives invalid for an unknown, reset or deleted key, with the same result for each`; `previewInvite resolves an 8-character key as a code and anything else as a token, case-insensitively for codes`; `previewInvite says member for a member and removed for a removed person`; `joinGroup in link mode joins at once`; `joinGroup in password mode refuses a wrong password and joins with the right one`; `five wrong passwords lock the person out, and the right password is refused with the locked message while locked`; `a lockout is per person and per group (another person, another group are unaffected)`; `joinGroup refuses a removed person with cannotJoin on token and on code paths`; `joinGroup on a full group gives full`; `joinGroup twice (double tap) leaves one membership and the second says success`; `joinGroup for someone already in 20 groups gives tooManyGroups`; `joinGroup for a member returns the group id without asking the password`; `viewGroup returns null for a non-member, a removed member, a malformed id and an unknown id`; `listGroupMembers returns null for a non-member`; `leaveGroup works for a member, refuses the owner with ownerCannotLeave, and lets the person rejoin`; `no result, message or log line contains the password or its hash` (spy on `console`).
- [ ] **Step 2:** Run `npx vitest run --project unit src/server/groups/use-cases.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement. Hash only in password mode; compare with `verifyGroupPassword`; when a lookup misses, spend similar effort to a hit is NOT required (accepted), but all misses return `invalid`; invite URL is `${siteUrl}/invite/${token}`. Use `can()` for every gate (`group.view`, `group.members.view`, `group.leave`).
- [ ] **Step 4:** Run the tests plus `npm run typecheck`; expected PASS.
- [ ] **Step 5:** Commit `feat: group create, view, join and leave use-cases`.

---

### Task 8: Owner use-cases (edit, join settings, reset link)

**Files:**
- Create: `src/server/groups/owner-use-cases.ts`, `src/server/groups/owner-use-cases.test.ts`

**Interfaces:**
- Produces: `updateGroupDetails(deps, groupId, raw): Promise<ActionResult>` (`group.edit`); `changeJoinSettings(deps, groupId, raw): Promise<ActionResult<{ password: string | null }>>` (`group.join.change`; switching to password mode requires a password; switching to link mode clears the hash; password echoed once); `resetInvite(deps, groupId): Promise<ActionResult<{ inviteUrl: string; inviteCode: string }>>` (`group.invite.reset`; retries on `invite_taken` up to 5 times); `getInviteForOwner(deps, groupId): Promise<{ inviteUrl: string; inviteCode: string; joinMode: JoinMode; ownerName: string } | null>` (`group.invite.view`, else null). Non-owners and non-members get `{ ok: false, formError: GROUP_MESSAGES.couldNotSave }` without changing anything.

- [ ] **Step 1: Write failing tests:** owner edits name and description (trimmed, validated); a member cannot (store unchanged); changing to link mode removes the stored hash, back to password without a password fails on `password`; changing the password keeps all members; `resetInvite` returns a different token and code and the old ones no longer resolve via `previewInvite` (`invalid`), while an existing member is still a member; a member cannot reset or view the invite; reset rate limited to 20 per hour per person; no hash or password in any returned value except the single `password` field.
- [ ] **Step 2:** Run the file; expected FAIL. **Step 3:** Implement. **Step 4:** Run tests and typecheck; expected PASS.
- [ ] **Step 5:** Commit `feat: owner use-cases for group details, join settings and invite reset`.

---

### Task 9: Signed-in frame, home list, and Create group page

**Files:**
- Create: `src/app/_components/signed-in-frame.tsx`, `src/server/groups/shell-groups.ts`, `src/app/groups/new/page.tsx`, `src/app/groups/actions.ts` (create action now; later tasks add to it), `src/client/components/groups/create-group-form.tsx`, `src/client/components/groups/copy-button.tsx`, `src/client/components/groups/invite-card.tsx`, `e2e/groups.spec.ts`
- Modify: `src/app/page.tsx`, `src/app/account/page.tsx`, `src/client/components/app-shell/group-sidebar.tsx`, `src/client/components/home/empty-groups.tsx`, `e2e/helpers.ts`

**Interfaces:**
- Produces `SignedInFrame({ user, activeGroupId?, children })` (async server component: loads `listMyGroups`, renders `AppShell` with the real `groups`, `AccountMenu`); `createGroupAction: FormAction` (calls `createGroup`, returns `{ status: "done", reveal: { password }, values: { groupId, inviteUrl, inviteCode, name } }` on success, field errors otherwise, never echoes `password` in `values`); `InviteCard({ inviteUrl, inviteCode, joinMode, ownerName, groupName })` (shows link, code, Copy buttons, WhatsApp button `https://wa.me/?text=<encoded message>`, a "Share" button using `navigator.share` when available; password mode message reads "Join <name> on study-share: <link>. Ask <owner name> for the group password."; the password is never in the message); `CopyButton({ value, label })` with an announced "Copied".
- Consumes: Tasks 7 and 8 use-cases; `requireGroupDeps`.

- [ ] **Step 1: Write the failing e2e** in `e2e/groups.spec.ts` (all three projects, uses `signUpAndConfirm` and `isolateRateLimits`): `home offers Create a group and Join with a code as real links`; `creating a group in password mode shows the link, the code and the password once, with copy buttons`; `leaving the created screen and coming back never shows the password again`; `link-only mode shows no password`; `the new group appears in the group list (sidebar, and the phone drawer)`; `a 60-character name and a Telugu name show without sideways scroll at 360px`; `password under 6 characters shows the error on the field`.
- [ ] **Step 2:** Run `npx playwright test e2e/groups.spec.ts --project=desktop`; expected FAIL.
- [ ] **Step 3:** Implement: sidebar items become `Link`s to `/groups/<id>` (active one `aria-current="page"`), the two disabled buttons become `Link`s styled as buttons to `/groups/new` and `/join` (keep the accessible names "Create a group" in the empty state so `helpers.passwordWorks` still finds it); `page.tsx` and `account/page.tsx` use `SignedInFrame`; form built with `useAuthForm`, `TextField`, `FormMessage`, `SubmitButton`; join mode as two radio cards (password default); password field type text with a hint "Send it separately from the link", `autocomplete="off"`.
- [ ] **Step 4:** Run the spec in all three projects, `npm run typecheck && npm run lint`; expected PASS.
- [ ] **Step 5:** Commit `feat: create a group and see your groups`.

---

### Task 10: Group page with tabs, members and settings

**Files:**
- Create: `src/app/groups/[id]/layout.tsx`, `page.tsx` (Library empty state), `members/page.tsx`, `settings/page.tsx`, `src/client/components/groups/group-tabs.tsx`, `member-list.tsx`, `settings-forms.tsx`
- Modify: `src/app/groups/actions.ts`, `e2e/groups.spec.ts`

**Interfaces:**
- Produces actions: `leaveGroupAction`, `updateGroupDetailsAction`, `changeJoinSettingsAction` (password echoed once via `reveal`), `resetInviteAction`. `GroupTabs({ groupId, showSettings })` (client, `usePathname`): bottom bar fixed above the safe area on screens under `lg` (page content gets matching bottom padding), top tab row on `lg` and up; only Library, Members and, for owners, Settings. The layout calls `viewGroup`; `null` → `notFound()`. Header shows the group name (truncated) and uses the existing group-list drawer as the switcher. Settings page: details form, join-mode form (password shown once after a change), `InviteCard` with the current link and code, "Reset link" with a confirm step stating that the old link and code stop working, and no email-invite or delete controls yet.

- [ ] **Step 1: Write the failing e2e** (add to `groups.spec.ts`): `owner sees Library, Members, Settings; a member sees Library and Members only`; `Library shows an honest empty state, not fake files`; `Members lists names, marks the owner and "You"`; `a member can leave after a confirm and the group vanishes from their list`; `the owner has no Leave button and is told why`; `a non-member opening /groups/<id> sees the same not-found page as a made-up id`; `owner edits name and description and sees them in the header after a reload`; `owner switches to link mode and back, new password shown once`; `reset link: the old link says no longer valid for a new visitor and the new one works`; `bottom tabs are fixed at 360px, not covered by the keyboard-safe area, and no sideways scroll`.
- [ ] **Step 2:** Run it; expected FAIL.
- [ ] **Step 3:** Implement per Interfaces. Leaving uses a small confirm (a dialog or a second tap pattern already used in the repo; reuse `sheet` or `dropdown-menu` primitives, no new library).
- [ ] **Step 4:** Run `npx playwright test e2e/groups.spec.ts` (all projects), typecheck and lint; expected PASS.
- [ ] **Step 5:** Commit `feat: group page with library, members and settings`.

---

### Task 11: Invite page, Join by code, and the sign-up round trip

**Files:**
- Create: `src/app/invite/[key]/page.tsx`, `src/app/join/page.tsx`, `src/client/components/groups/join-form.tsx`, `src/client/components/groups/invite-signed-out.tsx`, `e2e/invite.spec.ts`
- Modify: `src/app/groups/actions.ts` (add `joinGroupAction`, `findGroupByCodeAction`)

**Interfaces:**
- `/invite/[key]`: signed out → layout A (group name as hero via `previewInvite(await previewDeps(), key)`; two big buttons Continue with Google (the existing `startGoogleAction` with `next=/invite/<key>`) and Sign up with email (`withNext("/signup", "/invite/<key>")`), then "Already have an account? Log in" with `withNext("/login", ...)`; no typing on this page; an invalid key shows the standard message with no sign-up buttons). Signed in → `requireAcceptedTerms("/invite/<key>")`, then by preview state: `member` → redirect to `/groups/<id>`; `removed` → the `cannotJoin` message; `invalid` → the standard message; `open` + link mode → one "Join" button; `open` + password mode → password field and Join. A successful join redirects to `/groups/<id>`. `/join` (signed in): code field (`inputMode` text, `autocapitalize="characters"`, accepts `abcd-2345`), submit → `findGroupByCodeAction` → redirect to `/invite/<CODE>`; an unknown code shows `codeNotFound` (same wording as an invalid invite).
- Consumes: `previewInvite`, `joinGroup`, `safeNextPath` (the token is in the path, not the fragment).

- [ ] **Step 1: Write the failing e2e** in `invite.spec.ts` (two browser contexts for owner and friend): `signed-out friend sees the group name and two buttons, nothing to type`; `friend signs up by email code from the invite and lands back on the same invite, then joins with the password`; `wrong password shows the field error, five wrong passwords show the locked message even with the right one`; `friend logs in (existing account) from the invite and joins a link-only group in one tap`; `friend using fake Google from the invite passes the Terms step and returns to the invite`; `friend enters the code in lower case with a hyphen on /join and reaches the invite`; `unknown code and reset link give the same message`; `an existing member opening the invite goes straight to the group`; `invite page and /join have no sideways scroll at 360px and tap targets are 44px`.
- [ ] **Step 2:** Run `npx playwright test e2e/invite.spec.ts --project=phone-360`; expected FAIL.
- [ ] **Step 3:** Implement. Keep the pages free of group data beyond name for signed-out visitors (no member count, no owner email). Confirm the other-device sign-up code path (code entered on a second device) still ends at `/` and not on the invite, and say so in the commit body: that is by design.
- [ ] **Step 4:** Run all e2e (`npm run test:e2e`), typecheck, lint, unit; expected PASS.
- [ ] **Step 5:** Commit `feat: invite page, join by code and the sign-up round trip`.

---

### Task 12: Phone and desktop quality pass, journeys, and docs

**Files:**
- Modify: `e2e/phone-quality.spec.ts`, `e2e/shell.spec.ts` (only if the drawer assertions changed), `docs/PROJECT_PLAN.md` (phase status), the Phase 1 spec header note
- Create: `docs/PHASE_1B_ACCEPTANCE.md`

**Interfaces:** `phone-quality.spec.ts` gains entries for `/groups/new`, `/join`, `/invite/<made-up key>` (signed out, invalid message) in the signed-out/signed-in lists, plus a created group's Library, Members and Settings pages and a valid invite page, each audited in both themes at 360px and desktop with the existing `auditPage`.

- [ ] **Step 1:** Add the audit entries and run `npx playwright test e2e/phone-quality.spec.ts`; fix any finding in the components (targets, labels, contrast, overflow) rather than loosening the audit.
- [ ] **Step 2:** Add one journey test, `owner creates a password group, shares, friend joins from the invite, both see each other on Members, friend leaves, friend rejoins with the code`.
- [ ] **Step 3:** Write `docs/PHASE_1B_ACCEPTANCE.md` for the owner in the same click-by-click style as `docs/SETUP_AUTH.md` Part 8: two phones or a phone and a desktop, create (password and link-only), WhatsApp share, join by link while signed out, join by code, wrong password lockout, leave and rejoin, reset link, Hindi/Telugu/emoji name, a 60-character name. No owner setup is needed (no new settings); say so.
- [ ] **Step 4:** Run the full suite: `npm run lint && npm run typecheck && npm test && npm run test:int && npm run test:e2e && npm run build`; expected all pass.
- [ ] **Step 5:** Commit `test: phone quality, journey and acceptance guide for phase 1b`.

---

## Self-review notes

- **Spec coverage:** create/default password mode (T7, T9), password shown once (T7, T9, T10), 8-char code and token (T3), limits 20/300 (T6, T7), lockout 5 per 15 min (T7), join paths link/code through sign-up/login/Google (T11), removed cannot rejoin (T6, T7), leave and rejoin (T6, T7, T10), owner cannot leave (T7, T10), reset link kills token and code (T6, T8, T10), group page tabs and phone bottom tabs (T10), non-member 404 (T7, T10), WhatsApp share/copy (T9), phone quality bar and browser projects (T9 to T12). Deferred to 1c by agreement: email invites, remove/transfer/delete UI, restore.
- **My calls (to surface to the owner):** leaving deletes the membership row; one route `/invite/<key>` serves both token and code (code recognised by shape); owner types the group password (no generator); `admin`/`pending` stay unused; groups table already has `deleted_at` for 1c; invite token stored in clear text (the owner must be able to see the link again), password only hashed.
