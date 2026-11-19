/**
 * Every sentence the private chats' server code and screens show that the group chat does not
 * already have (see CHAT_MESSAGES for the rest: the body rules, "couldn't save", "too fast"). One
 * place so the owner can change the wording. None names an id or anything from the database.
 */
export const DIRECT_CHAT_MESSAGES = {
  /** The same answer for a chat that does not exist, one the person is not in, another group's, and a message that is not theirs to delete. */
  notFound: "That conversation isn't available.",
  /** Opening too many private chats in an hour. */
  tooManyChats: "You've opened a lot of private chats in a short time. Please wait a while and try again.",
  /** Trying to write or delete in a conversation whose other person has left the group. */
  readOnly: "This conversation is read-only because the other person is no longer in this group.",
  /** What the other person's name is shown as when it is not known. */
  formerMember: "Former member",
  /** Added after a name in the Private list when that person has left. */
  leftTag: "(left the group)",
  /** In place of the message box when the conversation is read-only. */
  readOnlyNote: (name: string) => `${name} is no longer in this group. You can read this conversation but not reply.`,
  emptyList: "No private chats yet. Open the Members tab and tap someone to message them.",
  backToList: "Back to private chats",
} as const;
