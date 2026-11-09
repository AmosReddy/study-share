import Link from "next/link";
import { Button } from "@/client/components/ui/button";

/** The two ways into a group, as links styled as buttons: Create a group and Join with a code. */
export function GroupActions() {
  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row">
      <Button asChild className="h-11 px-5 text-base">
        <Link href="/groups/new">Create a group</Link>
      </Button>
      <Button asChild variant="outline" className="h-11 px-5 text-base">
        {/* TODO(Task 11): prefetch again once /join exists; until then it answers 404. */}
        <Link href="/join" prefetch={false}>
          Join with a code
        </Link>
      </Button>
    </div>
  );
}

/** `/` for a signed-in person with no groups. */
export function EmptyGroups() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 pt-6 lg:pt-16">
      <h1 className="text-3xl font-semibold">
        <span className="marker px-0.5">Your groups</span> will live here
      </h1>
      <p className="max-w-prose text-muted-foreground">
        A group is a class or a study circle with its own library of notes and papers. You are not in any yet.
      </p>
      <GroupActions />
    </div>
  );
}
