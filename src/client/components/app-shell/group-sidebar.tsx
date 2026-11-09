import Link from "next/link";
import { cn } from "@/client/lib/utils";

export type SidebarGroup = { id: string; name: string };

type GroupSidebarProps = {
  groups: SidebarGroup[];
  activeGroupId?: string;
  /** Called when one of its links is followed (the phone sheet closes itself with it). */
  onNavigate?: () => void;
};

const actionClass =
  "flex min-h-11 items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50 outline-none";

export function GroupSidebar({ groups, activeGroupId, onNavigate }: GroupSidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="font-heading px-4 pt-5 pb-3 text-lg font-semibold">
        <span className="marker px-0.5">study-share</span>
      </p>

      <nav aria-label="Groups" className="min-h-0 flex-1 overflow-y-auto px-2">
        {groups.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">You are not in any groups yet.</p>
        ) : null}
        <ul className="flex flex-col gap-0.5">
          {groups.map((group) => {
            const active = group.id === activeGroupId;
            return (
              <li key={group.id} className="min-w-0">
                <Link
                  href={`/groups/${group.id}`}
                  // TODO(Task 10): prefetch again once the group page exists; until then it answers 404.
                  prefetch={false}
                  title={group.name}
                  aria-current={active ? "page" : undefined}
                  onNavigate={onNavigate}
                  className={cn(
                    "flex min-h-11 min-w-0 items-center rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent",
                    active && "bg-sidebar-accent font-medium",
                  )}
                >
                  <span className={cn("block min-w-0 truncate", active && "marker")}>{group.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-col gap-2 border-t p-3">
        <Link href="/groups/new" onNavigate={onNavigate} className={actionClass}>
          New group
        </Link>
        {/* TODO(Task 11): prefetch again once /join exists; until then it answers 404. */}
        <Link href="/join" prefetch={false} onNavigate={onNavigate} className={actionClass}>
          Join a group
        </Link>
      </div>
    </div>
  );
}
