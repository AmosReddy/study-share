import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MemberList } from "@/client/components/groups/member-list";
import { Skeleton } from "@/client/components/ui/skeleton";
import { listGroupMembers } from "@/server/groups/use-cases";
import { can } from "@/server/permissions";
import { GROUP_MESSAGES } from "@/shared/group-messages";
import { leaveGroupAction } from "../../actions";
import { loadGroupPage } from "../load-group";

export default function MembersPage({ params }: PageProps<"/groups/[id]/members">) {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <Members params={params} />
    </Suspense>
  );
}

/** The member list (names only), with Leave group for members and a plain sentence for the owner. */
async function Members({ params }: Pick<PageProps<"/groups/[id]/members">, "params">) {
  const { id } = await params;
  const page = await loadGroupPage(id);
  if (!page) notFound();
  const rows = await listGroupMembers(page.deps, id);
  if (!rows) notFound();

  return (
    <MemberList
      groupId={page.group.id}
      groupName={page.group.name}
      members={rows.map((row) => ({
        name: row.displayName,
        isOwner: row.role === "owner",
        isYou: row.userId === page.user.id,
      }))}
      leave={
        can(page.user, "group.leave", { membership: page.membership })
          ? "allowed"
          : page.membership.role === "owner"
            ? "owner"
            : "none"
      }
      ownerCannotLeave={GROUP_MESSAGES.ownerCannotLeave}
      leaveAction={leaveGroupAction}
    />
  );
}
