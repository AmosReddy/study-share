import { connection } from "next/server";
import { setFakeGroupFormConfig } from "@/server/adapters/fake-group-store";
import { DEFAULT_FORM_CONFIG, parseFormConfig, type FormConfig } from "@/shared/form-config";

/**
 * Test mode only: sets the upload form of the group `groupId` to `config` (a form configuration, see
 * src/shared/form-config.ts), so browser tests can model a group whose owner has designed its own
 * form. Body: JSON `{ groupId, config }`. 404 when there is no such group; 400 when `config` is not
 * a valid configuration (the store would quietly use the default form, which would hide a mistake
 * in a test); and in any other mode this route does not exist.
 */
export async function POST(request: Request) {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });

  const body: unknown = await request.json().catch(() => null);
  const { groupId, config } = (typeof body === "object" && body !== null ? body : {}) as { groupId?: unknown; config?: unknown };
  if (typeof groupId !== "string") return new Response("Not found", { status: 404 });
  const isDefault = JSON.stringify(config) === JSON.stringify(DEFAULT_FORM_CONFIG);
  if (!isDefault && parseFormConfig(config) === DEFAULT_FORM_CONFIG) return new Response("Invalid form configuration", { status: 400 });
  if (!setFakeGroupFormConfig(groupId, config as FormConfig)) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 204 });
}
