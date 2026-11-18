import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChatPanel } from "@/client/components/chat/chat-panel";
import { ChatSwitch } from "@/client/components/chat/chat-switch";
import { PrivateUnreadSync } from "@/client/components/chat/private-unread-sync";
import { Skeleton } from "@/client/components/ui/skeleton";
import { requireChatDeps } from "@/server/chat/request-deps";
import { loadChat } from "@/server/chat/use-cases";
import { deleteMessageAction, sendMessageAction } from "../../chat-actions";
import { loadPrivateUnread } from "../load-private-unread";

export default function ChatPage({ params }: PageProps<"/groups/[id]/chat">) {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <Chat params={params} />
    </Suspense>
  );
}

/**
 * The Chat tab. The layout has already checked that the person may see the group; loadChat answers
 * null for anyone who may not, and that is the same not-found page. It renders the newest messages
 * and the client takes over from there (polling), under the Group | Private switch. No time is rendered here: the browser formats
 * each message's time in the viewer's own time zone once it has taken over.
 */
async function Chat({ params }: Pick<PageProps<"/groups/[id]/chat">, "params">) {
  const { id } = await params;
  const deps = await requireChatDeps(id);
  const page = await loadChat(deps, id);
  if (!page) notFound();
  const unread = await loadPrivateUnread(id);
  return (
    <div className="flex flex-col gap-3">
      <PrivateUnreadSync groupId={id} any={unread.any} />
      <ChatSwitch groupId={id} current="group" unread={unread.any} />
      <ChatPanel groupId={id} initial={page} sendAction={sendMessageAction} deleteAction={deleteMessageAction} />
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-3 rounded-xl border p-3">
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="ml-auto h-12 w-1/2" />
      <Skeleton className="h-12 w-3/5" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
