import { can, type Action } from "@/server/permissions";
import type { GroupDeps } from "./use-cases";
import { MAX_INVITE_ATTEMPTS, memberContext } from "./use-cases";
import { overLimit, parse, type ActionResult } from "@/server/use-case-kit";
import { GROUP_MESSAGES } from "@/shared/group-messages";
import { editGroupSchema, joinModeSchema, type JoinMode } from "@/shared/groups";
import { GROUP_EDIT_USER_LIMIT, RESET_INVITE_USER_LIMIT } from "./rate-limit-policy";
import { hashGroupPassword, newGroupCode, newInviteToken } from "./secrets";

/*
  Owner use-cases: edit the group, change how people join, reset the invite link, read the invite.
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

export async function updateGroupDetails(deps: GroupDeps, groupId: string, raw: unknown): Promise<ActionResult> {
  const group = await allowed(deps, groupId, "group.edit");
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
  const group = await allowed(deps, groupId, "group.join.change");
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
  const group = await allowed(deps, groupId, "group.invite.reset");
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
    const outcome = await deps.groups.replaceInvite(group.id, { inviteToken, inviteCode });
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
