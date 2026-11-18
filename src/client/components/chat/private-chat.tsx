"use client";

import { useCallback } from "react";
import { fetchDirectPage } from "@/client/lib/chat-poll";
import type { ChatPage, DeleteMessageResult, SendMessageResult } from "@/shared/chat-types";
import { DIRECT_CHAT_MESSAGES } from "@/shared/direct-chat-messages";
import { ChatPanel, type ChatCopy } from "./chat-panel";

type PrivateChatProps = {
  groupId: string;
  chatId: string;
  /** The newest messages, rendered by the server. */
  initial: ChatPage;
  /** The person may reply: the other person is still in the group. The polls keep this current. */
  canSend: boolean;
  otherName: string;
  sendAction: (groupId: string, chatId: string, body: string, clientId: string) => Promise<SendMessageResult>;
  deleteAction: (groupId: string, chatId: string, messageId: string) => Promise<DeleteMessageResult>;
};

/**
 * One private conversation: the group chat's panel (the same bubbles, composer, polling, delete
 * sheet and "Load earlier messages") pointed at this conversation's route and actions, with its
 * own sentences, and a read-only note instead of the message box when the other person is gone.
 */
export function PrivateChat({ groupId, chatId, initial, canSend, otherName, sendAction, deleteAction }: PrivateChatProps) {
  const fetchPage = useCallback(
    (query: { after?: string; before?: string }, signal: AbortSignal) => fetchDirectPage(groupId, chatId, query, signal),
    [groupId, chatId],
  );
  const send = useCallback(
    (_groupId: string, body: string, clientId: string) => sendAction(groupId, chatId, body, clientId),
    [sendAction, groupId, chatId],
  );
  const remove = useCallback(
    (_groupId: string, messageId: string) => deleteAction(groupId, chatId, messageId),
    [deleteAction, groupId, chatId],
  );
  const copy: ChatCopy = {
    label: `Chat with ${otherName}`,
    empty: `No messages yet. Say hello to ${otherName}.`,
    deleteOwn: "It disappears for both of you and cannot be brought back.",
    readOnlyNote: DIRECT_CHAT_MESSAGES.readOnlyNote(otherName),
  };

  return (
    <ChatPanel
      groupId={groupId}
      chatKey={`${groupId}/${chatId}`}
      resumeHref={`/groups/${encodeURIComponent(groupId)}/chat/private/${encodeURIComponent(chatId)}`}
      initial={initial}
      sendAction={send}
      deleteAction={remove}
      fetchPage={fetchPage}
      copy={copy}
      canSend={canSend}
    />
  );
}
