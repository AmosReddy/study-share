import { cn } from "@/client/lib/utils";

export type SidebarGroup = { id: string; name: string };

type GroupSidebarProps = {
  groups: SidebarGroup[];
  activeGroupId?: string;
};

export function GroupSidebar({ groups, activeGroupId }: GroupSidebarProps) {
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
                <a
                  href={`#group-${group.id}`}
                  title={group.name}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block min-w-0 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent",
                    active && "bg-sidebar-accent font-medium",
                  )}
                >
                  <span className={cn("inline-block max-w-full truncate align-top", active && "marker")}>{group.name}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-col gap-2 border-t p-3">
        <button
          type="button"
          disabled
          className="min-h-11 rounded-md border px-3 py-2 text-left text-sm text-muted-foreground disabled:cursor-not-allowed"
        >
          New group
        </button>
        <button
          type="button"
          disabled
          className="min-h-11 rounded-md border px-3 py-2 text-left text-sm text-muted-foreground disabled:cursor-not-allowed"
        >
          Join a group
        </button>
      </div>
    </div>
  );
}
