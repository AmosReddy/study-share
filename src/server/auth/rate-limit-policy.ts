import type { Limit } from "../use-case-kit";

export type { Limit } from "../use-case-kit";

const HOUR = 60 * 60;
const FIFTEEN_MINUTES = 15 * 60;

export const SIGN_UP_EMAIL_LIMIT: Limit = { limit: 5, windowSeconds: HOUR };
/*
  Per-IP limits are generous on purpose: a whole class often registers together on one college
  Wi-Fi network (one public address), and each person may need a few tries. The per-address
  limits carry the security; these only stop one network from flooding the app.
*/

/** A class of 40 to 100 signing up at once, with retries, fits. */
export const SIGN_UP_IP_LIMIT: Limit = { limit: 300, windowSeconds: HOUR };

export const LOGIN_EMAIL_LIMIT: Limit = { limit: 10, windowSeconds: FIFTEEN_MINUTES };
/** A class logging in together, typos included, fits. */
export const LOGIN_IP_LIMIT: Limit = { limit: 300, windowSeconds: HOUR };

export const PASSWORD_RESET_EMAIL_LIMIT: Limit = { limit: 3, windowSeconds: HOUR };
/**
 * Kept at 30: every request sends an email from the project's mailbox, a whole class rarely
 * resets at once, and this cap stops one network from draining the email quota.
 */
export const PASSWORD_RESET_IP_LIMIT: Limit = { limit: 30, windowSeconds: HOUR };

export const PASSWORD_UPDATE_USER_LIMIT: Limit = { limit: 10, windowSeconds: HOUR };

export const RESEND_EMAIL_LIMIT: Limit = { limit: 3, windowSeconds: HOUR };

/**
 * Emailed-code checks (sign-up and reset codes share it): 5 per address per 15 minutes. A resend
 * does not reset it, so asking for new codes never buys more guesses.
 */
export const CODE_ATTEMPTS: Limit = { limit: 5, windowSeconds: FIFTEEN_MINUTES };
/** Every code check from one network counts (right codes too): a class entering codes together fits. */
export const CODE_ATTEMPTS_IP: Limit = { limit: 300, windowSeconds: HOUR };

/**
 * At most one email a minute to an address, shared by sign-up, resend and reset (one key for
 * all three, because Supabase's own per-address limit counts every email it sends). Our own
 * refusal depends only on this counter, never on whether an account exists.
 */
export const EMAIL_SEND_COOLDOWN: Limit = { limit: 1, windowSeconds: 60 };

/** The cooldown's key. `email` must already be normalised (trimmed, lowercase). */
export const emailSendKey = (email: string) => `email-send:${email}`;

/**
 * One minute after the server mints a recovery session for an address (openSessionWithoutEmail),
 * the provider refuses a recovery email to it (ruling P11). Hit ONLY at mint time and read with
 * `peek` by every email-sending use-case, so its window always starts at the mint itself (a hit
 * inside the email-send window would not restart that window).
 */
export const RECOVERY_MINTED_COOLDOWN: Limit = { limit: 1, windowSeconds: 60 };

/** The minted-recovery key. `email` must already be normalised (trimmed, lowercase). */
export const recoveryMintedKey = (email: string) => `recovery-minted:${email}`;
