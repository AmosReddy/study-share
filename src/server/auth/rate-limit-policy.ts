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
