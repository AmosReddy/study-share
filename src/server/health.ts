import "server-only";

export type HealthResult = {
  httpStatus: 200 | 503;
  body: { status: "ok" | "degraded"; db: "ok" | "error" };
};

/**
 * Pings the database and reports a result that is safe to show publicly:
 * on failure the error itself is dropped, so no connection details leak.
 */
export async function checkHealth(pingDatabase: () => Promise<void>): Promise<HealthResult> {
  try {
    await pingDatabase();
    return { httpStatus: 200, body: { status: "ok", db: "ok" } };
  } catch {
    return { httpStatus: 503, body: { status: "degraded", db: "error" } };
  }
}
