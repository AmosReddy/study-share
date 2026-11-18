import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChatSwitch } from "@/client/components/chat/chat-switch";
import { PrivateChatList } from "@/client/components/chat/private-chat-list";
import { PrivateUnreadSync } from "@/client/components/chat/private-unread-sync";
import { Skeleton } from "@/client/components/ui/skeleton";
import { requireDirectChatDeps } from "@/server/chat/direct-request-deps";
import { loadPrivateSummary } from "@/server/chat/direct-use-cases";

export default function PrivateChatsPage({ params }: PageProps<"/groups/[id]/chat/private">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <PrivateChats params={params} />
    </Suspense>
  );
}

/**
 * The Private list: the person's own private chats. The layout has already checked that the person
 * may see the group; listPrivateChats answers null for anyone who may not, and that is the same
 * not-found page. It renders the list as it is now and the client takes over from there (polling);
 * "how long ago" is worked out in the browser, so this page never reads a clock.
 */
async function PrivateChats({ params }: Pick<PageProps<"/groups/[id]/chat/private">, "params">) {
  const { id } = await params;
  const deps = await requireDirectChatDeps(id);
  const summary = await loadPrivateSummary(deps, id);
  if (!summary) notFound();
  const { unread } = summary;
  return (
    <div className="flex flex-col gap-3">
      <PrivateUnreadSync groupId={id} any={unread.any} />
      <ChatSwitch groupId={id} current="private" unread={unread.any} />
      <PrivateChatList groupId={id} initial={summary} />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-3">
      <Skeleton className="h-13 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
