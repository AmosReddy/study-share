import type { Limit } from "../use-case-kit";

export type { Limit } from "../use-case-kit";

const HOUR = 60 * 60;

/** Starting an upload: 15 an hour per person (key `file-prepare:user:<userId>`). */
export const FILE_PREPARE_USER_LIMIT: Limit = { limit: 15, windowSeconds: HOUR };
