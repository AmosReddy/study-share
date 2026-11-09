"use server";

import { revalidatePath } from "next/cache";
import { requireGroupDeps } from "@/server/groups/request-deps";
import { createGroup } from "@/server/groups/use-cases";
import type { FormState } from "@/shared/form-state";
import { failed, text } from "../(auth)/form-data";

/*
  Thin server actions for groups: read the form, call the use-case, turn its result into what the
  screen shows. A group password is never echoed into `values`, an address, a cookie or a log:
  the only place it goes back is `reveal`, once, on the create screen's success.
*/

export async function createGroupAction(_state: FormState, form: FormData): Promise<FormState> {
  // The page requires sign-in, but a stale tab can still post here after the session ended.
  const deps = await requireGroupDeps("/groups/new");
  const values = { name: text(form, "name"), description: text(form, "description"), joinMode: text(form, "joinMode") };
  const result = await createGroup(deps, { ...values, password: text(form, "password") });
  if (!result.ok) return failed(result, values);

  // The new group is in the shell's group list on every page, so refresh them all.
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
