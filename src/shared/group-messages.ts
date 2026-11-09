import { GROUP_LIMITS } from "./groups";

/**
 * Every sentence the group use-cases show, in one place so the owner can change the wording.
 * None of them names a person, a password or anything from the database.
 */
export const GROUP_MESSAGES = {
  invalidInvite: "This invite link isn't valid any more. Ask the group owner for a new one.",
  cannotJoin: "You can't join this group.",
  full: "This group is full.",
  wrongPassword: "That password is not right.",
  locked: "Too many wrong passwords. Try again in 15 minutes.",
  tooManyGroups: `You are in ${GROUP_LIMITS.maxGroupsPerPerson} groups, the most one account can be in. Leave one to join another.`,
  tooMany: "Too many attempts. Please try again later.",
  ownerCannotLeave: "You own this group, so you can't leave it yet.",
  /** A code that matches no group looks exactly like a dead invite link. */
  codeNotFound: "This invite link isn't valid any more. Ask the group owner for a new one.",
  badForm: "Check the form and try again.",
  couldNotSave: "We couldn't save that right now. Please try again.",
} as const;
