import { PRODUCTION_PROJECT_REFS } from "@/server/production-projects";

/**
 * The database the integration tests run against, or undefined when none is set (they are then
 * skipped locally). In CI a missing URL fails loudly, and a URL naming a production project is
 * refused everywhere: these tests write to auth.users and must never touch real user data.
 */
export function testDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  if (!url && process.env.CI) {
    throw new Error("TEST_DATABASE_URL must be set in CI");
  }
  if (url && PRODUCTION_PROJECT_REFS.some((ref) => url.includes(ref))) {
    throw new Error("TEST_DATABASE_URL points at a production project. Refusing to run database tests.");
  }
  return url;
}
