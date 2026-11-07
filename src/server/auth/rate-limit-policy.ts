/** How many tries are allowed in a window. The window length is in seconds. */
export type Limit = { limit: number; windowSeconds: number };

const HOUR = 60 * 60;
const FIFTEEN_MINUTES = 15 * 60;

export const SIGN_UP_EMAIL_LIMIT: Limit = { limit: 5, windowSeconds: HOUR };
/** Generous, so one college Wi-Fi network is not locked out. */
export const SIGN_UP_IP_LIMIT: Limit = { limit: 30, windowSeconds: HOUR };

export const LOGIN_EMAIL_LIMIT: Limit = { limit: 10, windowSeconds: FIFTEEN_MINUTES };
export const LOGIN_IP_LIMIT: Limit = { limit: 100, windowSeconds: HOUR };

export const PASSWORD_RESET_EMAIL_LIMIT: Limit = { limit: 3, windowSeconds: HOUR };
export const PASSWORD_RESET_IP_LIMIT: Limit = { limit: 30, windowSeconds: HOUR };

export const PASSWORD_UPDATE_USER_LIMIT: Limit = { limit: 10, windowSeconds: HOUR };

export const RESEND_EMAIL_LIMIT: Limit = { limit: 3, windowSeconds: HOUR };

/**
 * Emailed-code checks (sign-up and reset codes share it): 5 per address per 15 minutes. A resend
 * does not reset it, so asking for new codes never buys more guesses.
 */
export const CODE_ATTEMPTS: Limit = { limit: 5, windowSeconds: FIFTEEN_MINUTES };
export const CODE_ATTEMPTS_IP: Limit = { limit: 30, windowSeconds: HOUR };

/**
 * At most one email a minute to an address, shared by sign-up, resend and reset (one key for
 * all three, because Supabase's own per-address limit counts every email it sends). Our own
 * refusal depends only on this counter, never on whether an account exists.
 */
export const EMAIL_SEND_COOLDOWN: Limit = { limit: 1, windowSeconds: 60 };

/** The cooldown's key. `email` must already be normalised (trimmed, lowercase). */
export const emailSendKey = (email: string) => `email-send:${email}`;
