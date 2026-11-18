"use server";

import { redirect } from "next/navigation";
import { requireDirectChatDeps } from "@/server/chat/direct-request-deps";
import { deleteDirectMessage, openDirectChat, sendDirectMessage } from "@/server/chat/direct-use-cases";
import { CHAT_MESSAGES } from "@/shared/chat-messages";
import type { DeleteMessageResult, SendMessageResult } from "@/shared/chat-types";
import type { FormState } from "@/shared/form-state";
import { failed, text } from "../(auth)/form-data";

/*
  Thin server actions for private chats, like chat-actions.ts: re-read the session, call the use-case
  and answer with plain data. The use-cases apply the participant rule on every call (and re-check
  that the other person is still in the group), so a hand-made post changes nothing it may not.

  Nothing is revalidated: the pages are not cached and their browser code polls.
*/

/**
 * "Message <name>" on the Members tab: opens (makes, when new) the person's private chat with the
 * member the form's `chatKey` names, and goes to it. A code that names nobody (a made-up one,
 * another group's, your own, someone who has left) or opening too many chats answers with a plain
 * sentence on the row instead.
 */
export async function openPrivateChatAction(_state: FormState, form: FormData): Promise<FormState> {
  const groupId = text(form, "groupId");
  const deps = await requireDirectChatDeps(groupId);
  const result = await openDirectChat(deps, groupId, text(form, "chatKey"));
  if (!result.ok) return failed(result, {});
  redirect(`/groups/${groupId}/chat/private/${result.data.chatId}`);
}

/** Sends a message in a private chat. `clientId` is made once per message by the browser, so a retry is harmless. */
export async function sendDirectMessageAction(groupId: string, chatId: string, body: string, clientId: string): Promise<SendMessageResult> {
  const group = typeof groupId === "string" ? groupId : "";
  const deps = await requireDirectChatDeps(group);
  const result = await sendDirectMessage(deps, group, typeof chatId === "string" ? chatId : "", { body, clientId });
  if (result.ok) return { ok: true, message: result.data };
  const fields = "fieldErrors" in result ? result.fieldErrors : undefined;
  const error = fields?.body ?? fields?.clientId ?? result.formError ?? CHAT_MESSAGES.couldNotSave;
  return "notFound" in result ? { ok: false, notFound: true, error } : { ok: false, error };
}

/** Deletes the caller's own message in a private chat. */
export async function deleteDirectMessageAction(groupId: string, chatId: string, messageId: string): Promise<DeleteMessageResult> {
  const group = typeof groupId === "string" ? groupId : "";
  const deps = await requireDirectChatDeps(group);
  const result = await deleteDirectMessage(deps, group, typeof chatId === "string" ? chatId : "", typeof messageId === "string" ? messageId : "");
  if (result.ok) return { ok: true };
  const error = result.formError ?? CHAT_MESSAGES.couldNotSave;
  return "notFound" in result ? { ok: false, notFound: true, error } : { ok: false, error };
}
