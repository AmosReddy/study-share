import { connection, type NextRequest } from "next/server";
import { FAKE_STORAGE_PATH, checkFakeUpload, readFakeDownload } from "@/server/adapters/fake-file-storage";

/**
 * Test mode only: the fake file storage's address. The upload and download URLs made by the fake
 * FileStorage (createFakeFileStorage) point here, with a one-time token in the query:
 *
 *   PUT  /api/test/storage/<key>?token=...   stores the body if the token, key, content type and
 *                                            size all match what the URL was made for (else 403)
 *   GET  /api/test/storage/<key>?token=...   serves the file inline (PDF and common images only,
 *                                            the real adapter's rule) or as a download
 *
 * In any other mode it does not exist (404), so a 404 always means "not test mode".
 */

/** The key from the request's path (each part decoded), or null when it is not a clean key. */
function keyOf(request: NextRequest): string | null {
  const path = request.nextUrl.pathname;
  if (!path.startsWith(FAKE_STORAGE_PATH)) return null;
  try {
    const key = path.slice(FAKE_STORAGE_PATH.length).split("/").map(decodeURIComponent).join("/");
    return key === "" ? null : key;
  } catch {
    return null;
  }
}

const refused = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function PUT(request: NextRequest) {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });

  const key = keyOf(request);
  if (key === null) return refused(400);
  const length = request.headers.get("content-length");
  const check = checkFakeUpload({
    key,
    token: request.nextUrl.searchParams.get("token"),
    contentType: request.headers.get("content-type"),
    declaredLength: length !== null && /^\d+$/.test(length) ? Number(length) : null,
  });
  if (!check.ok) return refused(check.status);

  const status = check.accept(new Uint8Array(await request.arrayBuffer()));
  return refused(status);
}

export async function GET(request: NextRequest) {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });

  const key = keyOf(request);
  if (key === null) return refused(400);
  const result = readFakeDownload(key, request.nextUrl.searchParams.get("token"));
  if (result.status !== 200) return refused(result.status);
  return new Response(result.bytes as BodyInit, { status: 200, headers: result.headers });
}
