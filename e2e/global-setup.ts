import type { FullConfig } from "@playwright/test";

/**
 * Runs once the server is up, and stops the whole run unless that server is in test
 * mode. The test-only outbox route exists only when SERVICES_MODE=fake; on any other
 * server it is a 404, and no sign-up or reset test may run against it.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("Browser tests stopped: no baseURL is configured.");

  const guard = new URL("/api/test/outbox?email=guard@example.test", baseURL);
  let status: number;
  try {
    status = (await fetch(guard)).status;
  } catch (error) {
    throw new Error(`Browser tests stopped: could not reach ${baseURL} (${String(error)}).`);
  }
  if (status === 404) {
    throw new Error(
      `Browser tests stopped: the server at ${baseURL} is not in test mode (SERVICES_MODE=fake). ` +
        "Refusing to run sign-up and reset tests against it.",
    );
  }
}
