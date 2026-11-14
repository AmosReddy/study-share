import { connection } from "next/server";
import { resetFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { resetFakeFileStorage } from "@/server/adapters/fake-file-storage";
import { resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { resetFakeMessageStore } from "@/server/adapters/fake-message-store";
import { resetFakeResourceStore } from "@/server/adapters/fake-resource-store";

/**
 * Test mode only: empties the fake auth store (users, sessions, codes and their expiry,
 * Google codes, outbox, the profile terms records, and the failing sign-out and repair switches)
 * the fake group store (groups and memberships), the fake resource store (shared files) and the
 * fake file storage (stored files and upload and download tokens),
 * so browser tests that share the one fake Google account can run again on the same
 * server. In any other mode it does not exist.
 */
export async function POST() {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });
  resetFakeAuthStore();
  resetFakeGroupStore();
  resetFakeResourceStore();
  resetFakeMessageStore();
  resetFakeFileStorage();
  return new Response(null, { status: 204 });
}
