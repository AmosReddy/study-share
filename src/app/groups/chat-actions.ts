"use server";

import { requireChatDeps } from "@/server/chat/request-deps";
import { deleteMessage, sendMessage } from "@/server/chat/use-cases";
import { CHAT_MESSAGES } from "@/shared/chat-messages";
import type { DeleteMessageResult, SendMessageResult } from "@/shared/chat-types";

/*
  Thin server actions for the chat, like file-actions.ts: re-read the session (requireChatDeps),
  call the use-case and answer with plain data. The use-cases re-check that the caller is an active
  member and whose message it is, so a hand-made post changes nothing it may not.

  Nothing is revalidated: the chat page is not cached and its browser code polls for new messages
  (and gets its own sent message in this answer), so there is no cached page to refresh.
*/

/** Sends a message. `clientId` is made once per message by the browser, so a retry is harmless. */
export async function sendMessageAction(groupId: string, body: string, clientId: string): Promise<SendMessageResult> {
  const id = typeof groupId === "string" ? groupId : "";
  const deps = await requireChatDeps(id);
  const result = await sendMessage(deps, id, { body, clientId });
  if (result.ok) return { ok: true, message: result.data };
  const fields = "fieldErrors" in result ? result.fieldErrors : undefined;
  const error = fields?.body ?? fields?.clientId ?? result.formError ?? CHAT_MESSAGES.couldNotSave;
  return "notFound" in result ? { ok: false, notFound: true, error } : { ok: false, error };
}

/** Deletes a message: its sender, or the owner. */
export async function deleteMessageAction(groupId: string, messageId: string): Promise<DeleteMessageResult> {
  const id = typeof groupId === "string" ? groupId : "";
  const deps = await requireChatDeps(id);
  const result = await deleteMessage(deps, id, typeof messageId === "string" ? messageId : "");
  if (result.ok) return { ok: true };
  const error = result.formError ?? CHAT_MESSAGES.couldNotSave;
  return "notFound" in result ? { ok: false, notFound: true, error } : { ok: false, error };
}
