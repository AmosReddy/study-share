import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { GroupTabs } from "@/client/components/groups/group-tabs";
import { Skeleton } from "@/client/components/ui/skeleton";
import { can } from "@/server/permissions";
import { SignedInFrame } from "../../_components/signed-in-frame";
import { loadGroupPage } from "./load-group";

/** One title for every group address, so it never says whether a group exists or what it is called. */
export const metadata: Metadata = { title: "Group | study-share" };

export default function GroupLayout({ params, children }: LayoutProps<"/groups/[id]">) {
  return (
    <Suspense fallback={<GroupSkeleton />}>
      <GroupFrame params={params}>{children}</GroupFrame>
    </Suspense>
  );
}

/**
 * The shell with the group's name and description and its tabs. Anyone who may not see the group
 * gets the same not-found page as an address that leads nowhere.
 */
async function GroupFrame({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const { id } = await params;
  const page = await loadGroupPage(id);
  if (!page) notFound();
  const { user, group, membership } = page;

  return (
    <SignedInFrame user={user} activeGroupId={group.id} title={group.name}>
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 lg:gap-6">
        <header data-testid="group-header" className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-2xl leading-tight font-semibold lg:text-3xl" title={group.name}>
            {group.name}
          </h1>
          {group.description ? (
            <p className="line-clamp-3 text-muted-foreground [overflow-wrap:anywhere]">{group.description}</p>
          ) : null}
        </header>
        <GroupTabs groupId={group.id} showSettings={can(user, "group.edit", { membership })} />
        {/* Room at the bottom for the phone tab bar and the safe area under it. */}
        <div data-testid="group-content" className="min-w-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </div>
      </div>
    </SignedInFrame>
  );
}

function GroupSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex min-h-dvh flex-col gap-6 p-4 lg:pl-80">
      <Skeleton className="h-11 w-full max-w-md" />
      <Skeleton className="h-9 w-3/4 max-w-md" />
      <Skeleton className="h-24 w-full max-w-3xl" />
    </div>
  );
}
