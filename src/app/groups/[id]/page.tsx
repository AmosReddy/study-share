import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FileLibrary } from "@/client/components/files/file-library";
import { Skeleton } from "@/client/components/ui/skeleton";
import { requireFileDeps } from "@/server/files/request-deps";
import { listFiles, type FileQuery } from "@/server/files/use-cases";

export default function LibraryPage({ params, searchParams }: PageProps<"/groups/[id]">) {
  return (
    <Suspense fallback={<LibrarySkeleton />}>
      <Library params={params} searchParams={searchParams} />
    </Suspense>
  );
}

type SearchParams = Awaited<PageProps<"/groups/[id]">["searchParams"]>;

/** The first value of an address parameter (`?a=1&a=2` gives "1"), or undefined. */
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * What the address asks of the list. Only the page cursor for now; the search box and the filters
 * of the next slice add their parameters here and nowhere else (listFiles already takes them).
 */
function queryFrom(params: SearchParams): FileQuery {
  const cursor = first(params.cursor);
  return cursor ? { cursor } : {};
}

const NOTICES = ["uploaded", "deleted"] as const;

/**
 * The Library tab. The layout has already checked that the person may see the group; the list
 * answers null for anyone who may not, and that is the same not-found page.
 */
async function Library({ params, searchParams }: Pick<PageProps<"/groups/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const query = await searchParams;
  const deps = await requireFileDeps(id);
  const list = await listFiles(deps, id, queryFrom(query));
  if (!list) notFound();
  const notice = NOTICES.find((name) => name === first(query.notice));

  return (
    <FileLibrary
      groupId={id}
      files={list.items}
      nextCursor={list.nextCursor}
      later={Boolean(first(query.cursor))}
      {...(notice ? { notice } : {})}
    />
  );
}

function LibrarySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
