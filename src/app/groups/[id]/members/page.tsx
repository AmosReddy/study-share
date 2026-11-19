import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrivateUnreadSync } from "@/client/components/chat/private-unread-sync";
import { MemberList } from "@/client/components/groups/member-list";
import { Skeleton } from "@/client/components/ui/skeleton";
import { withDirectChat } from "@/server/chat/direct-request-deps";
import { listMembersWithChatKeys } from "@/server/chat/direct-use-cases";
import { can } from "@/server/permissions";
import { GROUP_MESSAGES } from "@/shared/group-messages";
import { leaveGroupAction, removeMemberAction } from "../../actions";
import { openPrivateChatAction } from "../../direct-chat-actions";
import { loadGroupPage } from "../load-group";
import { loadPrivateUnread } from "../load-private-unread";

export default function MembersPage({ params }: PageProps<"/groups/[id]/members">) {
  return (
    <Suspense fallback={<Skeleton aria-busy="true" className="h-40 w-full" />}>
      <Members params={params} />
    </Suspense>
  );
}

/** The member list (names only, and a one-way code for "Message" on every other row), with Leave group for members, Remove buttons for the owner (who alone gets the ids) and a plain sentence for an owner who cannot leave. */
async function Members({ params }: Pick<PageProps<"/groups/[id]/members">, "params">) {
  const { id } = await params;
  const page = await loadGroupPage(id);
  if (!page) notFound();
  const rows = await listMembersWithChatKeys(withDirectChat(page.deps), id);
  if (!rows) notFound();
  const unread = await loadPrivateUnread(id);
  const unreadKeys = new Set(unread.fromChatKeys);

  return (
    <>
      <PrivateUnreadSync groupId={page.group.id} unread={unread} />
      <MemberList
        groupId={page.group.id}
        groupName={page.group.name}
        members={rows.map((row) => ({
          name: row.displayName,
          isOwner: row.role === "owner",
          isYou: row.isYou,
          ...(row.userId ? { userId: row.userId } : {}),
          ...(row.chatKey ? { chatKey: row.chatKey, unread: unreadKeys.has(row.chatKey) } : {}),
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
        openChatAction={openPrivateChatAction}
        {...(can(page.user, "group.members.remove", { membership: page.membership })
          ? { removeAction: removeMemberAction, handOverHref: `/groups/${page.group.id}/settings` }
          : {})}
      />
    </>
  );
}
