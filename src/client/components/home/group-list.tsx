import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { SidebarGroup } from "@/client/components/app-shell/group-sidebar";
import { GroupActions } from "./empty-groups";

/** `/` for a signed-in person in at least one group: the groups, then the two ways into another. */
export function GroupList({ groups }: { groups: SidebarGroup[] }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 pt-6 lg:pt-16">
      <h1 className="text-3xl font-semibold">
        <span className="marker px-0.5">Your groups</span>
      </h1>
      <ul className="flex flex-col gap-2">
        {groups.map((group) => (
          <li key={group.id} className="min-w-0">
            <Link
              href={`/groups/${group.id}`}
              // TODO(Task 10): prefetch again once the group page exists; until then it answers 404.
              prefetch={false}
              className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg border bg-card px-4 py-3 text-base font-medium hover:bg-muted"
            >
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{group.name}</span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      <GroupActions />
    </div>
  );
}
