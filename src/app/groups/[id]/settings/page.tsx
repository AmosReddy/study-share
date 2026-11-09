import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GroupSettings } from "@/client/components/groups/settings-forms";
import { Skeleton } from "@/client/components/ui/skeleton";
import { can } from "@/server/permissions";
import { changeJoinSettingsAction, resetInviteAction, updateGroupDetailsAction } from "../../actions";
import { loadGroupPage } from "../load-group";

export default function SettingsPage({ params }: PageProps<"/groups/[id]/settings">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
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

  return (
    <GroupSettings
      group={{ id: group.id, name: group.name, description: group.description, joinMode: group.joinMode }}
      invite={invite}
      ownerName={deps.user.displayName}
      detailsAction={updateGroupDetailsAction}
      joinAction={changeJoinSettingsAction}
      resetAction={resetInviteAction}
    />
  );
}
