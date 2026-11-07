/**
 * Used by the live probe script only: deletes the test users it created and reports
 * honestly. "0 left" is only ever said when every deletion was confirmed and the
 * leftover scan completed; any failure to delete, to list, or a cut-off scan counts as
 * "left" with a warning that names only a user id, never an address.
 */
export type DeleteOutcome = "deleted" | "gone" | "failed";

export type CleanUpResult = { deleted: number; left: number; warnings: string[]; summary: string };

export async function cleanUpUsers(options: {
  /** Ids recorded when the users were created. */
  knownIds: Iterable<string>;
  /** Finds tagged users that were not recorded (a sign-up still in flight, say). `complete` is false if it gave up early. */
  scan: () => Promise<{ ids: string[]; complete: boolean }>;
  deleteUser: (id: string) => Promise<DeleteOutcome>;
}): Promise<CleanUpResult> {
  let deleted = 0;
  let left = 0;
  const warnings: string[] = [];
  const attempted = new Set<string>();

  async function remove(id: string) {
    if (attempted.has(id)) return;
    attempted.add(id);
    const outcome = await options.deleteUser(id).catch((): DeleteOutcome => "failed");
    if (outcome === "deleted") deleted++;
    else if (outcome === "failed") {
      left++;
      warnings.push(`test user ${id} was not deleted; remove it in the dashboard`);
    }
  }

  for (const id of options.knownIds) await remove(id);

  try {
    const found = await options.scan();
    for (const id of found.ids) await remove(id);
    if (!found.complete) {
      left++;
      warnings.push("the user scan stopped at its page limit, so leftovers cannot be ruled out; check the dashboard");
    }
  } catch {
    left++;
    warnings.push("could not list users to check for leftovers; look for test addresses tagged check in the dashboard");
  }

  return { deleted, left, warnings, summary: `Clean-up: ${deleted} test user(s) deleted, ${left} left.` };
}
