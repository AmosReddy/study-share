import { can } from "@/server/permissions";
import type { GroupRecord, GroupStore, GroupSummary, MemberRow, Membership } from "@/server/ports/group-store";
import type { RateLimiter } from "@/server/ports/rate-limiter";
import { hitWithTimeout, ipCheck, overLimit, parse, type ActionResult, type Check } from "@/server/use-case-kit";
import { GROUP_MESSAGES } from "@/shared/group-messages";
import { createGroupSchema, isGroupCode, joinGroupSchema, normalizeGroupCode, type JoinMode } from "@/shared/groups";
import {
  CREATE_GROUP_USER_LIMIT,
  JOIN_IP_LIMIT,
  JOIN_LOOKUP_USER_LIMIT,
  WRONG_PASSWORD_LIMIT,
  wrongPasswordKey,
} from "./rate-limit-policy";
import { hashGroupPassword, newGroupCode, newInviteToken, verifyGroupPassword } from "./secrets";

/*
  Group use-cases: create, list, preview an invite, join, view, list members, leave. Plain
  functions over ports, so they run in unit tests with the fakes. Nothing here returns, logs or
  throws a group password or its hash; the one exception is createGroup, which hands back the
  plaintext once so the owner can write it down.
*/

export type GroupDeps = {
  groups: GroupStore;
  limiter: RateLimiter;
  ip: string;
  siteUrl: string;
  user: { id: string; displayName: string };
};

/** The invite page also serves signed-out people: `user` is then null. */
export type PreviewDeps = Omit<GroupDeps, "user"> & { user: GroupDeps["user"] | null };

export type GroupView = {
  id: string;
  name: string;
  description: string;
  joinMode: JoinMode;
  inviteUrl: string;
  inviteCode: string;
};

export type InvitePreview =
  | { state: "invalid" }
  | { state: "limited"; retryAfterSeconds: number }
  | { state: "removed" }
  | { state: "member"; groupId: string }
  | { state: "open"; groupId: string; name: string; joinMode: JoinMode; ownerName: string };

/**
 * The group as the pages may see it: no password hash, and no invite token or code. `invite` is
 * present only for those allowed to see it (the owner).
 */
export type VisibleGroup = Omit<GroupRecord, "passwordHash" | "inviteToken" | "inviteCode"> & {
  invite?: { url: string; code: string };
};

/** How many fresh invite keys createGroup tries before it gives up (a clash is very unlikely). */
export const MAX_INVITE_ATTEMPTS = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function visible(group: GroupRecord, invite: { url: string; code: string } | null): VisibleGroup {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    joinMode: group.joinMode,
    createdAt: group.createdAt,
    ...(invite ? { invite } : {}),
  };
}

function viewOf(group: GroupRecord, siteUrl: string): GroupView {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    joinMode: group.joinMode,
    inviteUrl: `${siteUrl}/invite/${group.inviteToken}`,
    inviteCode: group.inviteCode,
  };
}

export async function createGroup(
  deps: GroupDeps,
  raw: unknown,
): Promise<ActionResult<{ group: GroupView; password: string | null }>> {
  const parsed = parse(createGroupSchema, raw, GROUP_MESSAGES.badForm);
  if ("failure" in parsed) return parsed.failure;
  const { name, description, joinMode, password } = parsed.data;

  const refused = await overLimit(
    deps.limiter,
    [{ key: `create-group:user:${deps.user.id}`, limit: CREATE_GROUP_USER_LIMIT }],
    GROUP_MESSAGES.tooMany,
  );
  if (refused) return refused;

  const passwordHash = joinMode === "password" && password !== undefined ? await hashGroupPassword(password) : null;

  for (let attempt = 0; attempt < MAX_INVITE_ATTEMPTS; attempt++) {
    let result: Awaited<ReturnType<GroupStore["createGroup"]>>;
    try {
      result = await deps.groups.createGroup({
        ownerId: deps.user.id,
        name,
        description,
        joinMode,
        passwordHash,
        inviteToken: newInviteToken(),
        inviteCode: newGroupCode(),
      });
    } catch {
      // The error may carry the query's values (the password hash): log a fixed line only.
      console.error("Could not save a new group.");
      return { ok: false, formError: GROUP_MESSAGES.couldNotSave };
    }
    if (result.ok) {
      return {
        ok: true,
        data: { group: viewOf(result.group, deps.siteUrl), password: joinMode === "password" ? (password ?? null) : null },
      };
    }
    if (result.reason === "too_many_groups") return { ok: false, formError: GROUP_MESSAGES.tooManyGroups };
  }
  return { ok: false, formError: GROUP_MESSAGES.couldNotSave };
}

export function listMyGroups(deps: GroupDeps): Promise<GroupSummary[]> {
  return deps.groups.listGroupsFor(deps.user.id);
}

/**
 * Codes are matched case-insensitively and ignoring spaces and hyphens; anything else is a token.
 * A key no invite can have (a NUL character, or longer than any token) matches nothing and never
 * reaches the store. A store failure throws; the callers decide what the person sees.
 */
function lookupGroup(groups: GroupStore, key: string): Promise<GroupRecord | null> {
  const trimmed = key.trim();
  if (!joinGroupSchema.shape.key.safeParse(trimmed).success) return Promise.resolve(null);
  return isGroupCode(trimmed)
    ? groups.findByInvite({ code: normalizeGroupCode(trimmed) })
    : groups.findByInvite({ token: trimmed });
}

const LIMITER_DOWN = "Rate limit store unavailable; allowing the request.";

/**
 * The per-network lookup bucket (what slows down code guessing) is only looked at here, never
 * counted: it is counted by `countMiss`, for lookups that find nothing. So a whole class opening
 * the same link from one college Wi-Fi address never uses it up. Fails open if the limiter is down.
 */
async function networkRefusal(deps: PreviewDeps): Promise<{ retryAfterSeconds: number } | null> {
  for (const { key, limit } of ipCheck("join-lookup", deps.ip, JOIN_IP_LIMIT)) {
    try {
      const answer = await hitWithTimeout(deps.limiter, { key, limit: limit.limit, windowSeconds: limit.windowSeconds }, "peek");
      if (!answer.allowed) return { retryAfterSeconds: Math.max(1, answer.retryAfterSeconds) };
    } catch {
      console.warn(LIMITER_DOWN);
    }
  }
  return null;
}

/** A lookup that found nothing was a guess: it uses one try of the network's bucket. Fails open. */
async function countMiss(deps: PreviewDeps): Promise<void> {
  for (const { key, limit } of ipCheck("join-lookup", deps.ip, JOIN_IP_LIMIT)) {
    try {
      await hitWithTimeout(deps.limiter, { key, limit: limit.limit, windowSeconds: limit.windowSeconds });
    } catch {
      console.warn(LIMITER_DOWN);
    }
  }
}

/**
 * The limits on looking up invites, applied before anything is looked up: the network's bucket is
 * checked (not counted), then every lookup by a signed-in person is counted against theirs.
 */
async function lookupRefusal(deps: PreviewDeps): Promise<{ retryAfterSeconds: number } | null> {
  const network = await networkRefusal(deps);
  if (network) return network;
  const checks: Check[] = deps.user ? [{ key: `join-lookup:user:${deps.user.id}`, limit: JOIN_LOOKUP_USER_LIMIT }] : [];
  const refused = await overLimit(deps.limiter, checks, GROUP_MESSAGES.tooMany);
  return refused ? { retryAfterSeconds: refused.retryAfterSeconds ?? 1 } : null;
}

/**
 * What an invite link or code leads to. A key that matches nothing, a reset key and a deleted group
 * all give the same "invalid". A lookup over its limit gives "limited" before anything is looked up,
 * so it says nothing about the key. A store failure throws a generic error (the page's error
 * screen), never a message that holds the key.
 */
export async function previewInvite(deps: PreviewDeps, key: string): Promise<InvitePreview> {
  const refused = await lookupRefusal(deps);
  if (refused) return { state: "limited", retryAfterSeconds: refused.retryAfterSeconds };

  let group: GroupRecord | null;
  try {
    group = await lookupGroup(deps.groups, key);
  } catch {
    console.error("Could not look up an invite.");
    throw new Error("Group lookup failed");
  }
  if (!group) {
    await countMiss(deps);
    return { state: "invalid" };
  }

  if (deps.user) {
    const membership = await deps.groups.getMembership(group.id, deps.user.id);
    if (membership?.status === "removed") return { state: "removed" };
    if (membership?.status === "active") return { state: "member", groupId: group.id };
  }
  const owner = (await deps.groups.listMembers(group.id)).find((member) => member.role === "owner");
  return { state: "open", groupId: group.id, name: group.name, joinMode: group.joinMode, ownerName: owner?.displayName ?? "" };
}

/** The wait the person is told about when the wrong-password counter cannot be used. */
const COUNTER_DOWN_WAIT_SECONDS = 60;

/**
 * Takes one of the person's wrong-password slots for this group BEFORE the password is checked, so
 * parallel guesses cannot all get through (the count is the limiter's, atomic). Returns the wait
 * when the slots are used up; the right password uses a slot too. Fails CLOSED if the limiter is
 * down or too slow: without the counter nobody may guess, so the password is not checked at all.
 */
async function takePasswordSlot(deps: GroupDeps, groupId: string): Promise<{ retryAfterSeconds: number } | null> {
  try {
    const answer = await hitWithTimeout(deps.limiter, {
      key: wrongPasswordKey(groupId, deps.user.id),
      limit: WRONG_PASSWORD_LIMIT.limit,
      windowSeconds: WRONG_PASSWORD_LIMIT.windowSeconds,
    });
    return answer.allowed ? null : { retryAfterSeconds: Math.max(1, answer.retryAfterSeconds) };
  } catch {
    console.warn("Rate limit store unavailable; refusing the password attempt.");
    return { retryAfterSeconds: COUNTER_DOWN_WAIT_SECONDS };
  }
}

export async function joinGroup(deps: GroupDeps, raw: unknown): Promise<ActionResult<{ groupId: string }>> {
  const parsed = parse(joinGroupSchema, raw, GROUP_MESSAGES.badForm);
  if ("failure" in parsed) return parsed.failure;
  const { key, password } = parsed.data;

  const refused = await lookupRefusal(deps);
  if (refused) {
    return { ok: false, formError: GROUP_MESSAGES.tooMany, retryAfterSeconds: refused.retryAfterSeconds };
  }

  try {
    return await joinFound(deps, key, password);
  } catch {
    // A store error may carry the key or ids: log a fixed line only.
    console.error("Could not join the group.");
    return { ok: false, formError: GROUP_MESSAGES.couldNotSave };
  }
}

async function joinFound(
  deps: GroupDeps,
  key: string,
  password: string | undefined,
): Promise<ActionResult<{ groupId: string }>> {
  const group = await lookupGroup(deps.groups, key);
  if (!group) {
    await countMiss(deps);
    return { ok: false, formError: GROUP_MESSAGES.invalidInvite };
  }

  // Already in: success before any password or limit check. Removed: refused, and a removal is
  // never cleared by a join.
  const membership = await deps.groups.getMembership(group.id, deps.user.id);
  if (membership?.status === "active") return { ok: true, data: { groupId: group.id } };
  if (membership?.status === "removed") return { ok: false, formError: GROUP_MESSAGES.cannotJoin };

  if (group.joinMode === "password") {
    const locked = await takePasswordSlot(deps, group.id);
    if (locked) return { ok: false, formError: GROUP_MESSAGES.locked, retryAfterSeconds: locked.retryAfterSeconds };
    const right = group.passwordHash !== null && (await verifyGroupPassword(password ?? "", group.passwordHash));
    if (!right) {
      return { ok: false, fieldErrors: { password: GROUP_MESSAGES.wrongPassword } };
    }
  }

  switch (await deps.groups.addMember(group.id, deps.user.id)) {
    case "joined":
    case "already_member":
      return { ok: true, data: { groupId: group.id } };
    case "removed":
      return { ok: false, formError: GROUP_MESSAGES.cannotJoin };
    case "full":
      return { ok: false, formError: GROUP_MESSAGES.full };
    case "too_many_groups":
      return { ok: false, formError: GROUP_MESSAGES.tooManyGroups };
    case "group_gone":
      return { ok: false, formError: GROUP_MESSAGES.invalidInvite };
  }
}

/**
 * The group and the caller's membership, or null for an unknown or malformed id. A store failure
 * throws: a read must never turn an outage into "no such group". Actions use `actionContext`.
 */
export async function memberContext(
  deps: GroupDeps,
  groupId: string,
): Promise<{ group: GroupRecord; membership: Membership | null } | null> {
  if (!UUID.test(groupId)) return null;
  const group = await deps.groups.findById(groupId);
  if (!group) return null;
  return { group, membership: await deps.groups.getMembership(group.id, deps.user.id) };
}

export type ActionContext =
  | { failed: true }
  | { failed: false; context: Awaited<ReturnType<typeof memberContext>> };

/**
 * memberContext for actions: a store failure logs `logLine` (a fixed sentence, no ids, no error
 * text) and comes back as `failed`, so the action can answer couldNotSave.
 */
export async function actionContext(deps: GroupDeps, groupId: string, logLine: string): Promise<ActionContext> {
  try {
    return { failed: false, context: await memberContext(deps, groupId) };
  } catch {
    console.error(logLine);
    return { failed: true };
  }
}

/** Null for a non-member, a removed member, a deleted or unknown group and a malformed id: all look alike. */
export async function viewGroup(
  deps: GroupDeps,
  groupId: string,
): Promise<{ group: VisibleGroup; membership: Membership } | null> {
  const context = await memberContext(deps, groupId);
  if (!context?.membership || !can(deps.user, "group.view", { membership: context.membership })) return null;
  const invite = can(deps.user, "group.invite.view", { membership: context.membership })
    ? { url: `${deps.siteUrl}/invite/${context.group.inviteToken}`, code: context.group.inviteCode }
    : null;
  return { group: visible(context.group, invite), membership: context.membership };
}

export async function listGroupMembers(deps: GroupDeps, groupId: string): Promise<MemberRow[] | null> {
  const context = await memberContext(deps, groupId);
  if (!context?.membership || !can(deps.user, "group.members.view", { membership: context.membership })) return null;
  return deps.groups.listMembers(context.group.id);
}

/**
 * Leaving is safe to repeat: someone who is not in the group (a double tap, or a removed person)
 * gets success and nothing changes. Owners cannot leave.
 */
export async function leaveGroup(deps: GroupDeps, groupId: string): Promise<ActionResult> {
  const found = await actionContext(deps, groupId, "Could not leave the group.");
  if (found.failed) return { ok: false, formError: GROUP_MESSAGES.couldNotSave };
  const context = found.context;
  if (!context?.membership || context.membership.status !== "active") return { ok: true, data: undefined };
  if (!can(deps.user, "group.leave", { membership: context.membership })) {
    return {
      ok: false,
      formError: context.membership.role === "owner" ? GROUP_MESSAGES.ownerCannotLeave : GROUP_MESSAGES.couldNotSave,
    };
  }
  let outcome: Awaited<ReturnType<GroupStore["leave"]>>;
  try {
    outcome = await deps.groups.leave(context.group.id, deps.user.id);
  } catch {
    console.error("Could not leave the group.");
    return { ok: false, formError: GROUP_MESSAGES.couldNotSave };
  }
  if (outcome === "owner") return { ok: false, formError: GROUP_MESSAGES.ownerCannotLeave };
  return { ok: true, data: undefined };
}
