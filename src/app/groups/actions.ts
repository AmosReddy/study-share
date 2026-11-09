"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { changeJoinSettings, resetInvite, updateGroupDetails } from "@/server/groups/owner-use-cases";
import { requireGroupDeps } from "@/server/groups/request-deps";
import { createGroup, leaveGroup } from "@/server/groups/use-cases";
import type { FormState } from "@/shared/form-state";
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
