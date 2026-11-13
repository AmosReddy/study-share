import { can, type Action } from "@/server/permissions";
import type { GroupDeps } from "./use-cases";
import { MAX_INVITE_ATTEMPTS, actionContext, memberContext } from "./use-cases";
import { overLimit, parse, type ActionResult } from "@/server/use-case-kit";
import { GROUP_MESSAGES } from "@/shared/group-messages";
import type { GroupStore } from "@/server/ports/group-store";
import {
  deleteGroupSchema,
  editGroupSchema,
  joinModeSchema,
  normalizeGroupNameForCompare,
  transferOwnershipSchema,
  uuidSchema,
  type JoinMode,
} from "@/shared/groups";
import { GROUP_EDIT_USER_LIMIT, GROUP_MANAGE_LIMIT, RESET_INVITE_USER_LIMIT } from "./rate-limit-policy";
import { hashGroupPassword, newGroupCode, newInviteToken } from "./secrets";

/*
  Owner use-cases: edit the group, change how people join, reset the invite link, read the invite,
  remove a member, hand the group over and delete it.
  Every one of them asks can() with the person's membership first. Anyone who is not an active
  owner (a member, a removed person, a stranger, an unknown or malformed id, a deleted group) gets
  the same answer and nothing changes, so the answer never says whether the group exists. Nothing
  here returns, logs or throws a password hash; the plaintext password is handed back once, in
  changeJoinSettings, only when it was just set.
*/

const COULD_NOT_SAVE = { ok: false, formError: GROUP_MESSAGES.couldNotSave } as const;

/** The group, when this person may do `action` on it; null in every other case. */
async function allowed(deps: GroupDeps, groupId: string, action: Action) {
  const context = await memberContext(deps, groupId);
  if (!context?.membership || !can(deps.user, action, { membership: context.membership })) return null;
  return context.group;
}

/**
 * Like `allowed`, for the actions: a store failure while checking is logged as a fixed line and
 * answers like a refusal (couldNotSave) instead of throwing.
 */
async function allowedForAction(deps: GroupDeps, groupId: string, action: Action) {
  const found = await actionContext(deps, groupId, "Could not check the group.");
  if (found.failed) return null;
  const context = found.context;
  if (!context?.membership || !can(deps.user, action, { membership: context.membership })) return null;
  return context.group;
}

export async function updateGroupDetails(deps: GroupDeps, groupId: string, raw: unknown): Promise<ActionResult> {
  const group = await allowedForAction(deps, groupId, "group.edit");
  if (!group) return COULD_NOT_SAVE;

  const parsed = parse(editGroupSchema, raw, GROUP_MESSAGES.badForm);
  if ("failure" in parsed) return parsed.failure;

  const refused = await overLimit(
    deps.limiter,
    [{ key: `group-edit:${deps.user.id}`, limit: GROUP_EDIT_USER_LIMIT }],
    GROUP_MESSAGES.tooMany,
  );
  if (refused) return refused;

  const saved = await deps.groups.updateDetails(group.id, parsed.data);
  return saved ? { ok: true, data: undefined } : COULD_NOT_SAVE;
}

export async function changeJoinSettings(
  deps: GroupDeps,
  groupId: string,
  raw: unknown,
): Promise<ActionResult<{ password: string | null }>> {
  const group = await allowedForAction(deps, groupId, "group.join.change");
  if (!group) return COULD_NOT_SAVE;

  const parsed = parse(joinModeSchema, raw, GROUP_MESSAGES.badForm);
  if ("failure" in parsed) return parsed.failure;
  const { joinMode, password } = parsed.data;

  const refused = await overLimit(
    deps.limiter,
    [{ key: `group-edit:${deps.user.id}`, limit: GROUP_EDIT_USER_LIMIT }],
    GROUP_MESSAGES.tooMany,
  );
  if (refused) return refused;

  const newPassword = joinMode === "password" && password !== undefined ? password : null;
  const passwordHash = newPassword === null ? null : await hashGroupPassword(newPassword);

  let saved: boolean;
  try {
    saved = await deps.groups.updateJoin(group.id, { joinMode, passwordHash });
  } catch {
    // The error may carry the query's values (the password hash): log a fixed line only.
    console.error("Could not save the join settings.");
    return COULD_NOT_SAVE;
  }
  return saved ? { ok: true, data: { password: newPassword } } : COULD_NOT_SAVE;
}

export async function resetInvite(
  deps: GroupDeps,
  groupId: string,
): Promise<ActionResult<{ inviteUrl: string; inviteCode: string }>> {
  const group = await allowedForAction(deps, groupId, "group.invite.reset");
  if (!group) return COULD_NOT_SAVE;

  const refused = await overLimit(
    deps.limiter,
    [{ key: `group-reset:${deps.user.id}`, limit: RESET_INVITE_USER_LIMIT }],
    GROUP_MESSAGES.tooMany,
  );
  if (refused) return refused;

  for (let attempt = 0; attempt < MAX_INVITE_ATTEMPTS; attempt++) {
    const inviteToken = newInviteToken();
    const inviteCode = newGroupCode();
    let outcome: Awaited<ReturnType<typeof deps.groups.replaceInvite>>;
    try {
      outcome = await deps.groups.replaceInvite(group.id, { inviteToken, inviteCode });
    } catch {
      // The error may carry the NEW live token and code (the query's values): log a fixed line only.
      console.error("Could not reset the invite.");
      return COULD_NOT_SAVE;
    }
    if (outcome === "ok") return { ok: true, data: { inviteUrl: `${deps.siteUrl}/invite/${inviteToken}`, inviteCode } };
    if (outcome === "group_gone") return COULD_NOT_SAVE;
  }
  return COULD_NOT_SAVE;
}

/** The invite for the owner's share screen; null for everyone else. Never carries the password hash. */
export async function getInviteForOwner(
  deps: GroupDeps,
  groupId: string,
): Promise<{ inviteUrl: string; inviteCode: string; joinMode: JoinMode; ownerName: string } | null> {
  const group = await allowed(deps, groupId, "group.invite.view");
  if (!group) return null;
  return {
    inviteUrl: `${deps.siteUrl}/invite/${group.inviteToken}`,
    inviteCode: group.inviteCode,
    joinMode: group.joinMode,
    ownerName: deps.user.displayName,
  };
}

const MANAGE_CHECK = (userId: string) => [{ key: `group-manage:${userId}`, limit: GROUP_MANAGE_LIMIT }];

/**
 * Owner only. Removes an ACTIVE member other than the owner: the status becomes
 * removed, which keeps the person from joining again. Every refusal, and a store that says no, is
 * the same couldNotSave, so nothing says whether the group or the person exists.
 */
export async function removeGroupMember(deps: GroupDeps, groupId: string, targetUserId: string): Promise<ActionResult> {
  const group = await allowedForAction(deps, groupId, "group.members.remove");
  if (!group) return COULD_NOT_SAVE;
  const parsedTarget = uuidSchema.safeParse(targetUserId);
  if (!parsedTarget.success) return COULD_NOT_SAVE;
  const targetId = parsedTarget.data;
  if (targetId === deps.user.id.toLowerCase()) return COULD_NOT_SAVE;

  let target: Awaited<ReturnType<GroupStore["getMembership"]>>;
  try {
    target = await deps.groups.getMembership(group.id, targetId);
  } catch {
    console.error("Could not remove the member.");
    return COULD_NOT_SAVE;
  }
  if (target?.status !== "active") return COULD_NOT_SAVE;

  const refused = await overLimit(deps.limiter, MANAGE_CHECK(deps.user.id), GROUP_MESSAGES.tooMany);
  if (refused) return refused;

  let removed: boolean;
  try {
    removed = await deps.groups.removeMember(group.id, targetId);
  } catch {
    console.error("Could not remove the member.");
    return COULD_NOT_SAVE;
  }
  return removed ? { ok: true, data: undefined } : COULD_NOT_SAVE;
}

/**
 * Owner only. Hands the group to another ACTIVE member; the owner becomes a plain member. A target
 * who is not in the group (or is the owner) is a field error so the owner can pick again; every
 * other refusal is couldNotSave.
 */
export async function transferGroupOwnership(deps: GroupDeps, groupId: string, raw: unknown): Promise<ActionResult> {
  const group = await allowedForAction(deps, groupId, "group.transfer");
  if (!group) return COULD_NOT_SAVE;

  const parsed = parse(transferOwnershipSchema, raw, GROUP_MESSAGES.badForm);
  if ("failure" in parsed) {
    return parsed.failure.fieldErrors?.targetUserId
      ? { ok: false, fieldErrors: { targetUserId: GROUP_MESSAGES.transferTargetInvalid } }
      : parsed.failure;
  }

  const refused = await overLimit(deps.limiter, MANAGE_CHECK(deps.user.id), GROUP_MESSAGES.tooMany);
  if (refused) return refused;

  let outcome: Awaited<ReturnType<GroupStore["transferOwnership"]>>;
  try {
    outcome = await deps.groups.transferOwnership(group.id, deps.user.id, parsed.data.targetUserId);
  } catch {
    console.error("Could not hand over the group.");
    return COULD_NOT_SAVE;
  }
  switch (outcome) {
    case "ok":
      return { ok: true, data: undefined };
    case "not_member":
    case "same_person":
      return { ok: false, fieldErrors: { targetUserId: GROUP_MESSAGES.transferTargetInvalid } };
    default:
      return COULD_NOT_SAVE;
  }
}

/**
 * Owner only, and only when the typed name matches the group's current name. A soft delete: the
 * group vanishes for everyone and its invite stops working, but the rows are kept.
 */
export async function deleteGroup(deps: GroupDeps, groupId: string, raw: unknown): Promise<ActionResult> {
  const group = await allowedForAction(deps, groupId, "group.delete");
  if (!group) return COULD_NOT_SAVE;

  const mismatch = { ok: false, fieldErrors: { confirmName: GROUP_MESSAGES.deleteNameMismatch } } as const;
  const parsed = deleteGroupSchema.safeParse(raw);
  if (!parsed.success || normalizeGroupNameForCompare(parsed.data.confirmName) !== normalizeGroupNameForCompare(group.name)) return mismatch;

  const refused = await overLimit(deps.limiter, MANAGE_CHECK(deps.user.id), GROUP_MESSAGES.tooMany);
  if (refused) return refused;

  let deleted: boolean;
  try {
    deleted = await deps.groups.softDeleteGroup(group.id);
  } catch {
    console.error("Could not delete the group.");
    return COULD_NOT_SAVE;
  }
  return deleted ? { ok: true, data: undefined } : COULD_NOT_SAVE;
}
