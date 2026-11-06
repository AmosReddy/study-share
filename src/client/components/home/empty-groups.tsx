import { Button } from "@/client/components/ui/button";

/** `/` for a signed-in person with no groups. Both actions arrive in the next step, so they are visibly off. */
export function EmptyGroups() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 pt-6 lg:pt-16">
      <h1 className="text-3xl font-semibold">
        <span className="marker px-0.5">Your groups</span> will live here
      </h1>
      <p className="max-w-prose text-muted-foreground">
        A group is a class or a study circle with its own library of notes and papers. You are not in any yet.
      </p>
      <div className="flex w-full flex-col gap-3 sm:flex-row">
        <Button type="button" disabled className="h-11 flex-1 px-5 text-base sm:flex-none">
          Create a group
        </Button>
        <Button type="button" variant="outline" disabled className="h-11 flex-1 px-5 text-base sm:flex-none">
          Join with a code
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Coming in the next step</p>
    </div>
  );
}
