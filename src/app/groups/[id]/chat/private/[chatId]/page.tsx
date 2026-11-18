import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrivateChat } from "@/client/components/chat/private-chat";
import { PrivateUnreadSync } from "@/client/components/chat/private-unread-sync";
import { Skeleton } from "@/client/components/ui/skeleton";
import { requireDirectChatDeps } from "@/server/chat/direct-request-deps";
import { loadDirectChat, privateUnread } from "@/server/chat/direct-use-cases";
import { DIRECT_CHAT_MESSAGES } from "@/shared/direct-chat-messages";
import { deleteDirectMessageAction, sendDirectMessageAction } from "../../../../direct-chat-actions";

export default function PrivateConversationPage({ params }: PageProps<"/groups/[id]/chat/private/[chatId]">) {
  return (
    <Suspense fallback={<ConversationSkeleton />}>
      <Conversation params={params} />
    </Suspense>
  );
}

/**
 * One private conversation. loadDirectChat answers null for everyone who is not one of its two
 * people in this group (the owner too, another member, someone removed, another group's address, an
 * id that is not one), and that is the same not-found page as everywhere else. Loading the newest
 * messages marks them read, so the unread information is asked for after it. No time is rendered
 * here: the browser formats each message's time once it has taken over.
 */
async function Conversation({ params }: Pick<PageProps<"/groups/[id]/chat/private/[chatId]">, "params">) {
  const { id, chatId } = await params;
  const deps = await requireDirectChatDeps(id);
  const page = await loadDirectChat(deps, id, chatId);
  if (!page) notFound();
  const unread = await privateUnread(deps, id);
  const { messages, hasMore, cursor, canSend, otherName, otherGone } = page;

  return (
    <div className="flex flex-col gap-3">
      <PrivateUnreadSync groupId={id} any={unread.any} />
      <div className="flex min-w-0 flex-col">
        <Link
          href={`/groups/${id}/chat/private`}
          className="-ml-2 inline-flex min-h-11 items-center gap-2 self-start rounded-md px-2 text-base font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {DIRECT_CHAT_MESSAGES.backToList}
        </Link>
        <h2 className="text-xl font-semibold [overflow-wrap:anywhere]">
          {otherName}
          {otherGone ? <span className="text-base font-normal text-muted-foreground"> {DIRECT_CHAT_MESSAGES.leftTag}</span> : null}
        </h2>
      </div>
      <PrivateChat
        groupId={id}
        chatId={chatId}
        initial={{ messages, hasMore, cursor, canDeleteAny: false }}
        canSend={canSend}
        otherName={otherName}
        sendAction={sendDirectMessageAction}
        deleteAction={deleteDirectMessageAction}
      />
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-3 rounded-xl border p-3">
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="ml-auto h-12 w-1/2" />
      <Skeleton className="h-12 w-3/5" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
