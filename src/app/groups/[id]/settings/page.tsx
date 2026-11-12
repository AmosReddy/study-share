import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GroupSettings } from "@/client/components/groups/settings-forms";
import { Skeleton } from "@/client/components/ui/skeleton";
import { listGroupMembers } from "@/server/groups/use-cases";
import { can } from "@/server/permissions";
import {
  changeJoinSettingsAction,
  deleteGroupAction,
  resetInviteAction,
  transferOwnershipAction,
  updateGroupDetailsAction,
} from "../../actions";
import { loadGroupPage } from "../load-group";

export default function SettingsPage({ params }: PageProps<"/groups/[id]/settings">) {
  return (
    <Suspense fallback={<Skeleton aria-busy="true" className="h-96 w-full" />}>
      <Settings params={params} />
    </Suspense>
  );
}

/** Owner only. Anyone else who types the address gets the plain not-found page. */
async function Settings({ params }: Pick<PageProps<"/groups/[id]/settings">, "params">) {
  const { id } = await params;
  const page = await loadGroupPage(id);
  const invite = page?.group.invite;
  if (!page || !invite || !can(page.user, "group.edit", { membership: page.membership })) notFound();
  const { group, deps } = page;
  const members = (await listGroupMembers(deps, id)) ?? [];
  // Only the owner gets here, so the rows carry ids; the owner themselves cannot be picked.
  const candidates = members.flatMap((row) =>
    row.userId && !row.isYou && row.role !== "owner" ? [{ userId: row.userId, name: row.displayName }] : [],
  );

  return (
    <GroupSettings
      group={{ id: group.id, name: group.name, description: group.description, joinMode: group.joinMode }}
      invite={invite}
      ownerName={deps.user.displayName}
      detailsAction={updateGroupDetailsAction}
      joinAction={changeJoinSettingsAction}
      resetAction={resetInviteAction}
      candidates={candidates}
      transferAction={transferOwnershipAction}
      deleteAction={deleteGroupAction}
    />
  );
}
