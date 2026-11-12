"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  changeJoinSettings,
  deleteGroup,
  removeGroupMember,
  resetInvite,
  transferGroupOwnership,
  updateGroupDetails,
} from "@/server/groups/owner-use-cases";
import { requireGroupDeps } from "@/server/groups/request-deps";
import { createGroup, joinGroup, leaveGroup, previewInvite } from "@/server/groups/use-cases";
import type { FormState } from "@/shared/form-state";
import { GROUP_MESSAGES } from "@/shared/group-messages";
import { joinCodeSchema } from "@/shared/groups";
import { failed, text } from "../(auth)/form-data";

/*
  Thin server actions for groups: read the form, call the use-case, turn its result into what the
  screen shows. A group password is never echoed into `values`, an address, a cookie or a log:
  the only place it goes back is `reveal`, once, on a success that just set it.

  Every action re-reads the session (a stale tab can still post after the session ended), and the
  use-cases re-check the person's membership and role, so a hand-made post changes nothing it may
  not. Each success refreshes every page, because the group's name is in the shell on all of them.
*/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where to come back to after logging in: the group page, or `/` for an id that is not one. */
function groupPath(groupId: string, tab = ""): string {
  return UUID.test(groupId) ? `/groups/${groupId}${tab}` : "/";
}

/** The invite page to come back to after logging in, or `/` for a key no invite could have. */
function invitePath(key: string): string {
  const trimmed = key.trim();
  return trimmed !== "" && trimmed.length <= 100 ? `/invite/${encodeURIComponent(trimmed)}` : "/";
}

export async function createGroupAction(_state: FormState, form: FormData): Promise<FormState> {
  const deps = await requireGroupDeps("/groups/new");
  const values = { name: text(form, "name"), description: text(form, "description"), joinMode: text(form, "joinMode") };
  const result = await createGroup(deps, { ...values, password: text(form, "password") });
  if (!result.ok) return failed(result, values);

  revalidatePath("/", "layout");
  const { group, password } = result.data;
  return {
    status: "done",
    ...(password !== null ? { reveal: { password } } : {}),
    values: {
      groupId: group.id,
      inviteUrl: group.inviteUrl,
      inviteCode: group.inviteCode,
      name: group.name,
      joinMode: group.joinMode,
      ownerName: deps.user.displayName,
    },
  };
}

/** Leaves the group and goes home, where the group is no longer listed. Owners are told they cannot. */
export async function leaveGroupAction(_state: FormState, form: FormData): Promise<FormState> {
  const groupId = text(form, "groupId");
  const deps = await requireGroupDeps(groupPath(groupId, "/members"));
  const result = await leaveGroup(deps, groupId);
  if (!result.ok) return failed(result, {});

  revalidatePath("/", "layout");
  redirect("/");
}

export async function updateGroupDetailsAction(_state: FormState, form: FormData): Promise<FormState> {
  const groupId = text(form, "groupId");
  const deps = await requireGroupDeps(groupPath(groupId, "/settings"));
  const values = { name: text(form, "name"), description: text(form, "description") };
  const result = await updateGroupDetails(deps, groupId, values);
  if (!result.ok) return failed(result, values);

  revalidatePath("/", "layout");
  return { status: "done", notice: "Saved.", values };
}

/** A new password (password mode) comes back once in `reveal`; it is never put in `values`, also not on an error. */
export async function changeJoinSettingsAction(_state: FormState, form: FormData): Promise<FormState> {
  const groupId = text(form, "groupId");
  const deps = await requireGroupDeps(groupPath(groupId, "/settings"));
  const values = { joinMode: text(form, "joinMode") };
  const result = await changeJoinSettings(deps, groupId, { ...values, password: text(form, "password") });
  if (!result.ok) return failed(result, values);

  revalidatePath("/", "layout");
  const { password } = result.data;
  return {
    status: "done",
    values: { joinMode: password === null ? "link" : "password" },
    ...(password !== null ? { reveal: { password } } : {}),
  };
}

/** Makes a new link and code; the page reloads with them, and the old ones stop working at once. */
export async function resetInviteAction(_state: FormState, form: FormData): Promise<FormState> {
  const groupId = text(form, "groupId");
  const deps = await requireGroupDeps(groupPath(groupId, "/settings"));
  const result = await resetInvite(deps, groupId);
  if (!result.ok) return failed(result, {});

  revalidatePath("/", "layout");
  return { status: "done", notice: "New link and code made. The old ones no longer work." };
}

/** Removes one person from the group (owner only); the Members list then comes back without them. */
export async function removeMemberAction(_state: FormState, form: FormData): Promise<FormState> {
  const groupId = text(form, "groupId");
  const deps = await requireGroupDeps(groupPath(groupId, "/members"));
  const result = await removeGroupMember(deps, groupId, text(form, "userId"));
  if (!result.ok) {
    // A lost response after a success leaves a stale row that every retry refuses: refresh the list.
    revalidatePath("/", "layout");
    return failed(result, {});
  }

  revalidatePath("/", "layout");
  return { status: "done" };
}

/** Hands the group to another member. The previous owner is a plain member now, so they go to the group's first page. */
export async function transferOwnershipAction(_state: FormState, form: FormData): Promise<FormState> {
  const groupId = text(form, "groupId");
  const deps = await requireGroupDeps(groupPath(groupId, "/settings"));
  const result = await transferGroupOwnership(deps, groupId, { targetUserId: text(form, "targetUserId") });
  if (!result.ok) {
    // The people or the owner may have changed since this page was drawn: refresh it.
    revalidatePath("/", "layout");
    return failed(result, {});
  }

  revalidatePath("/", "layout");
  redirect(groupPath(groupId));
}

/** Deletes the group (owner only, and only with its exact name typed); a wrong name stays on the sheet as the field's error. */
export async function deleteGroupAction(_state: FormState, form: FormData): Promise<FormState> {
  const groupId = text(form, "groupId");
  const deps = await requireGroupDeps(groupPath(groupId, "/settings"));
  const result = await deleteGroup(deps, groupId, { confirmName: text(form, "confirmName") });
  if (!result.ok) return failed(result, { confirmName: text(form, "confirmName") });

  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Joins with the invite key from the page's address (a link token or a group code) and, in
 * password mode, the typed password, then opens the group. The password is never put back into
 * `values`: a wrong one comes back only as the field's error.
 */
export async function joinGroupAction(_state: FormState, form: FormData): Promise<FormState> {
  const key = text(form, "key");
  const deps = await requireGroupDeps(invitePath(key));
  const password = form.has("password") ? text(form, "password") : undefined;
  const result = await joinGroup(deps, { key, ...(password !== undefined ? { password } : {}) });
  if (!result.ok) return failed(result, {});

  revalidatePath("/", "layout");
  redirect(`/groups/${result.data.groupId}`);
}

/**
 * Join by code: a typed code (any case, spaces and hyphens allowed) goes on to its invite page,
 * which joins, asks for the password or, for a member, opens the group. A code that matches no
 * group gets exactly the words of a dead invite link.
 */
export async function findGroupByCodeAction(_state: FormState, form: FormData): Promise<FormState> {
  const deps = await requireGroupDeps("/join");
  const values = { code: text(form, "code") };
  const parsed = joinCodeSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", fieldErrors: { code: parsed.error.issues[0]?.message ?? GROUP_MESSAGES.codeNotFound }, values };
  }

  const preview = await previewInvite(deps, parsed.data.code);
  if (preview.state === "limited") {
    return { status: "error", formError: GROUP_MESSAGES.tooMany, retryAfterSeconds: preview.retryAfterSeconds, values };
  }
  if (preview.state === "invalid") return { status: "error", fieldErrors: { code: GROUP_MESSAGES.codeNotFound }, values };
  redirect(`/invite/${parsed.data.code}`);
}
