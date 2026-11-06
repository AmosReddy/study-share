import "server-only";

export type HealthResult = {
  httpStatus: 200 | 503;
  body: { status: "ok" | "degraded"; db: "ok" | "error" };
};

/**
 * Pings the database and reports a result that is safe to show publicly:
 * on failure the error is dropped from the response, so no connection details
 * leak. It is written to the server log instead, with any URLs removed, so
 * a failing check can still be diagnosed.
 */
export async function checkHealth(pingDatabase: () => Promise<void>): Promise<HealthResult> {
  try {
    await pingDatabase();
    return { httpStatus: 200, body: { status: "ok", db: "ok" } };
  } catch (error) {
    console.error("Health check failed:", describeForLog(error));
    return { httpStatus: 503, body: { status: "degraded", db: "error" } };
  }
}

function describeForLog(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  return `${error.name}: ${error.message}`.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url removed>");
}
