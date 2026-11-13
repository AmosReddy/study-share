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
  /** The wait is added by the screen, from retryHint. */
  locked: "Too many wrong passwords.",
  tooManyGroups: `You are in ${GROUP_LIMITS.maxGroupsPerPerson} groups, the most one account can be in. Leave one to join another.`,
  tooMany: "Too many attempts. Please try again later.",
  ownerCannotLeave: "You own this group. Hand it over to another member first, then you can leave.",
  transferTargetInvalid: "Pick someone who is in this group.",
  deleteNameMismatch: "That is not the group's name. Type it exactly as shown.",
  /** A code that matches no group looks exactly like a dead invite link. */
  codeNotFound: "This invite link isn't valid any more. Ask the group owner for a new one.",
  badForm: "Check the form and try again.",
  couldNotSave: "We couldn't save that right now. Please try again.",
} as const;

/** When a refused try may be made again, in whole minutes (at least one): "You can try again in about 15 minutes." */
export function retryHint(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `You can try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}
