import { connection, type NextRequest } from "next/server";
import { requireGroupDeps } from "@/server/groups/request-deps";
import { joinGroup } from "@/server/groups/use-cases";

/**
 * Test mode only: joins the signed-in person to the group behind `key` (an invite token or a
 * group code), with `password` for a password group, through the same joinGroup use-case the
 * invite page uses, and answers its result as JSON (never the password). Browser tests use it to
 * put a second person in a group. In any other mode it does not exist.
 */
export async function POST(request: NextRequest) {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });

  const body: unknown = await request.json().catch(() => ({}));
  const { key, password } = (body ?? {}) as { key?: unknown; password?: unknown };
  const deps = await requireGroupDeps("/");
  const result = await joinGroup(deps, {
    key: typeof key === "string" ? key : "",
    ...(typeof password === "string" ? { password } : {}),
  });
  if (result.ok) return Response.json({ ok: true, groupId: result.data.groupId });
  return Response.json({
    ok: false,
    ...(result.formError ? { formError: result.formError } : {}),
    ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
  });
}
