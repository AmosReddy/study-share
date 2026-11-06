/**
 * Verifies that every external service is reachable with the credentials in
 * .env.local. Run with: npm run check:services
 *
 * It goes through the same ports and composition root as the app, so it also
 * proves the wiring works. Prints PASS or FAIL per service and exits non-zero
 * if any fails. Error output is limited to the error's name and message so
 * credentials are not printed.
 */
import { pingDatabase } from "@/server/db/ping";
import { EnvError, getServerEnv } from "@/server/env";
import { getEmailSender, getFileStorage } from "@/server/services";

async function checkStorage(): Promise<void> {
  const storage = getFileStorage();
  const key = `healthcheck/${Date.now()}.txt`;
  const body = `check ${key}`;
  try {
    await storage.put(key, body, "text/plain");

    const info = await storage.head(key);
    if (info?.sizeBytes !== body.length) throw new Error("Stored size did not match what was uploaded");

    const bytes = await storage.get(key);
    if (!bytes || new TextDecoder().decode(bytes) !== body) {
      throw new Error("Downloaded content did not match what was uploaded");
    }

    // Prove a signed download link works too, since the app hands these to browsers.
    const url = await storage.createDownloadUrl({ key, expiresInSeconds: 60 });
    const response = await fetch(url);
    if (!response.ok || (await response.text()) !== body) throw new Error(`Signed download failed (${response.status})`);
  } finally {
    // Always try to clean up, even when a check failed.
    await storage.delete(key).catch(() => {});
  }
  if ((await storage.head(key)) !== null) throw new Error("Deleted file is still there");
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error";
}

async function main(): Promise<void> {
  try {
    getServerEnv();
  } catch (error) {
    console.log(`FAIL  environment  ${error instanceof EnvError ? error.message : describeError(error)}`);
    process.exit(1);
  }

  const checks: [string, () => Promise<void>][] = [
    ["database", pingDatabase],
    ["file storage", checkStorage],
    ["email (SMTP login)", () => getEmailSender().verify()],
  ];

  let failed = false;
  for (const [name, run] of checks) {
    try {
      await run();
      console.log(`PASS  ${name}`);
    } catch (error) {
      failed = true;
      console.log(`FAIL  ${name}  ${describeError(error)}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

void main();
