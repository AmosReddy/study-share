import { PrivateUnreadSync } from "@/client/components/chat/private-unread-sync";
import { loadPrivateUnread } from "./load-private-unread";

/**
 * Draws nothing; hands the browser what the server finds out about unread private messages, once
 * the lookup is done. The group frame does not wait for it (it sits in its own Suspense), because
 * a dot is only a hint and a slow or stuck lookup must never hold the page back. loadPrivateUnread
 * never throws, so a failing store means "nothing unread", not a broken frame.
 */
export async function UnreadFromServer({ groupId }: { groupId: string }) {
  const unread = await loadPrivateUnread(groupId);
  return <PrivateUnreadSync groupId={groupId} any={unread.any} />;
}
