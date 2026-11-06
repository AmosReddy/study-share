import "server-only";

/**
 * Supabase project ids that hold REAL user data. The id is the first part of the
 * project's web address (https://<id>.supabase.co). It is not a secret: it is
 * already sent to every visitor's browser.
 *
 * src/server/env.ts uses this list to stop a dev or preview deployment from ever
 * touching production data, and to stop production from running on dev data,
 * whatever APP_ENV says. Update it if the production project is ever replaced.
 */
export const PRODUCTION_PROJECT_REFS: readonly string[] = ["zgzkqxetwrvjujlkjbmz"];
